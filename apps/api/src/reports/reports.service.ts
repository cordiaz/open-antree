import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, between, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  branches,
  counters,
  services,
  tenants,
  tickets,
} from '../database/schema.js';
import {
  addDays,
  daysBetween,
  isCalendarDate,
  serviceDateFor,
} from '../queue/service-date.js';
import { ReportQueryDto } from './dto.js';

// Longest range one report may cover, inclusive.
export const MAX_RANGE_DAYS = 92;
// Range when none is given: the last 7 days including today.
const DEFAULT_RANGE_DAYS = 7;

const minutes = (value: unknown) => (value === null ? null : Number(value));

// Aggregates shared by every breakdown. Averages skip tickets without the
// timestamps involved (avg ignores NULL).
const metrics = {
  total: sql<number>`count(*)`.mapWith(Number),
  completed:
    sql<number>`count(*) filter (where ${tickets.status} = 'completed')`.mapWith(
      Number,
    ),
  skipped:
    sql<number>`count(*) filter (where ${tickets.status} in ('skipped', 'cancelled'))`.mapWith(
      Number,
    ),
  // From taking a ticket to being called.
  avgWaitMinutes: sql<
    number | null
  >`round(avg(extract(epoch from ${tickets.calledAt} - ${tickets.createdAt})) / 60, 1)`.mapWith(
    minutes,
  ),
  // From starting service (or being called, if service was never started)
  // to completion, for completed tickets.
  avgServiceMinutes: sql<
    number | null
  >`round(avg(extract(epoch from ${tickets.completedAt} - coalesce(${tickets.servedAt}, ${tickets.calledAt}))) filter (where ${tickets.status} = 'completed') / 60, 1)`.mapWith(
    minutes,
  ),
};

type Metrics = {
  total: number;
  completed: number;
  skipped: number;
  avgWaitMinutes: number | null;
  avgServiceMinutes: number | null;
};

// Tickets neither completed nor skipped: still in the queue, or left over
// when the day ended.
const withUnfinished = <T extends Metrics>(row: T) => ({
  ...row,
  unfinished: row.total - row.completed - row.skipped,
});

const EMPTY: Metrics = {
  total: 0,
  completed: 0,
  skipped: 0,
  avgWaitMinutes: null,
  avgServiceMinutes: null,
};

// Read-only ticket history for admins, scoped to the admin's tenant.
// Ticket rows only carry ids and timestamps here; no customer data leaves.
@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async getReport(admin: AuthUser, query: ReportQueryDto) {
    const [tenant] = await this.db
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, admin.tenant.id));
    const today = serviceDateFor(tenant.timezone);
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    this.assertRange(from, to);

    let branch: { id: string; name: string } | null = null;
    if (query.branchId) {
      [branch] = await this.db
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(
          and(
            eq(branches.id, query.branchId),
            eq(branches.tenantId, admin.tenant.id),
          ),
        );
      if (!branch) {
        throw new NotFoundException('Cabang tidak ditemukan');
      }
    }

    const scope = and(
      eq(tickets.tenantId, admin.tenant.id),
      between(tickets.serviceDate, from, to),
      branch ? eq(tickets.branchId, branch.id) : undefined,
    );
    // Hour of day in the tenant's timezone. Grouped by position because the
    // timezone is a bound parameter.
    const hour = sql<number>`extract(hour from ${tickets.createdAt} at time zone ${tenant.timezone})::int`;

    const [[summary], daily, byService, byCounter, byHour] = await Promise.all([
      this.db.select(metrics).from(tickets).where(scope),
      this.db
        .select({ date: tickets.serviceDate, ...metrics })
        .from(tickets)
        .where(scope)
        .groupBy(tickets.serviceDate),
      this.db
        .select({
          serviceId: services.id,
          name: services.name,
          ticketPrefix: services.ticketPrefix,
          ...metrics,
        })
        .from(tickets)
        .innerJoin(services, eq(services.id, tickets.serviceId))
        .where(scope)
        .groupBy(services.id)
        .orderBy(desc(sql`count(*)`), asc(services.ticketPrefix)),
      this.db
        .select({
          counterId: counters.id,
          name: counters.name,
          ...metrics,
        })
        .from(tickets)
        .innerJoin(counters, eq(counters.id, tickets.counterId))
        .where(and(scope, isNotNull(tickets.counterId)))
        .groupBy(counters.id)
        .orderBy(asc(counters.name)),
      this.db
        .select({ hour, total: metrics.total })
        .from(tickets)
        .where(scope)
        .groupBy(sql`1`),
    ]);

    // Every day and hour in the range, including the quiet ones.
    const dayRows = new Map(daily.map((row) => [row.date, row]));
    const hourRows = new Map(byHour.map((row) => [row.hour, row.total]));

    return {
      from,
      to,
      timezone: tenant.timezone,
      branch,
      summary: withUnfinished(summary),
      daily: Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => {
        const date = addDays(from, i);
        return withUnfinished({ ...EMPTY, ...dayRows.get(date), date });
      }),
      byService: byService.map(withUnfinished),
      // Tickets a counter called, and what became of them.
      byCounter: byCounter.map(withUnfinished),
      byHour: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        total: hourRows.get(h) ?? 0,
      })),
    };
  }

  private assertRange(from: string, to: string) {
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      throw new BadRequestException('Tanggal tidak valid');
    }
    if (from > to) {
      throw new BadRequestException(
        'Tanggal awal tidak boleh setelah tanggal akhir',
      );
    }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Rentang laporan maksimal ${MAX_RANGE_DAYS} hari`,
      );
    }
  }
}
