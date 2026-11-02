import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  branches,
  counters,
  services,
  tenants,
  tickets,
} from '../database/schema.js';
import { CallNextDto, CreateTicketDto } from './dto.js';
import { serviceDateFor, ticketCode } from './service-date.js';

type Tenant = typeof tenants.$inferSelect;
type Ticket = typeof tickets.$inferSelect;
type TicketStatus = Ticket['status'];

// A ticket a counter is currently handling.
const ACTIVE_STATUSES: TicketStatus[] = ['called', 'serving'];

export type TicketAction = 'start' | 'complete' | 'skip';

// For user-facing error messages.
const ACTION_LABEL: Record<TicketAction, string> = {
  start: 'mulai dilayani',
  complete: 'diselesaikan',
  skip: 'dilewati',
};
const STATUS_LABEL: Record<TicketStatus, string> = {
  waiting: 'menunggu',
  called: 'dipanggil',
  serving: 'sedang dilayani',
  completed: 'selesai',
  skipped: 'dilewati',
  cancelled: 'dibatalkan',
};

const TRANSITIONS: Record<
  TicketAction,
  { from: TicketStatus[]; to: TicketStatus; stamp: keyof Ticket }
> = {
  start: { from: ['called'], to: 'serving', stamp: 'servedAt' },
  complete: {
    from: ['called', 'serving'],
    to: 'completed',
    stamp: 'completedAt',
  },
  skip: { from: ['called'], to: 'skipped', stamp: 'completedAt' },
};

// Every lookup below filters on tenantId so one tenant can never read or
// change another tenant's rows, even with a valid id.
@Injectable()
export class QueueService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  async getTenant(slug: string): Promise<Tenant> {
    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug));
    if (!tenant) {
      throw new NotFoundException(`Tenant "${slug}" tidak ditemukan`);
    }
    return tenant;
  }

  async getTenantOverview(slug: string) {
    const tenant = await this.getTenant(slug);
    const [branchRows, serviceRows, counterRows] = await Promise.all([
      this.db
        .select()
        .from(branches)
        .where(
          and(eq(branches.tenantId, tenant.id), eq(branches.isActive, true)),
        )
        .orderBy(asc(branches.createdAt)),
      this.db
        .select()
        .from(services)
        .where(
          and(eq(services.tenantId, tenant.id), eq(services.isActive, true)),
        )
        .orderBy(asc(services.ticketPrefix)),
      this.db
        .select()
        .from(counters)
        .where(
          and(eq(counters.tenantId, tenant.id), eq(counters.isActive, true)),
        )
        .orderBy(asc(counters.name)),
    ]);

    return {
      slug: tenant.slug,
      name: tenant.name,
      timezone: tenant.timezone,
      branches: branchRows.map((branch) => ({
        id: branch.id,
        name: branch.name,
        address: branch.address,
        services: serviceRows
          .filter((service) => service.branchId === branch.id)
          .map((service) => ({
            id: service.id,
            name: service.name,
            ticketPrefix: service.ticketPrefix,
            avgServiceMinutes: service.avgServiceMinutes,
          })),
        counters: counterRows
          .filter((counter) => counter.branchId === branch.id)
          .map((counter) => ({ id: counter.id, name: counter.name })),
      })),
    };
  }

  // Public queue board for one branch (the tenant's first branch by default).
  async getQueue(slug: string, branchId?: string) {
    const tenant = await this.getTenant(slug);
    const branch = await this.findBranch(tenant.id, branchId);

    const serviceDate = serviceDateFor(tenant.timezone);
    const [serviceRows, openTickets] = await Promise.all([
      this.db
        .select()
        .from(services)
        .where(
          and(eq(services.branchId, branch.id), eq(services.isActive, true)),
        )
        .orderBy(asc(services.ticketPrefix)),
      this.db
        .select({
          serviceId: tickets.serviceId,
          code: tickets.code,
          status: tickets.status,
          counter: counters.name,
        })
        .from(tickets)
        .leftJoin(counters, eq(counters.id, tickets.counterId))
        .where(
          and(
            eq(tickets.branchId, branch.id),
            eq(tickets.serviceDate, serviceDate),
            inArray(tickets.status, ['waiting', ...ACTIVE_STATUSES]),
          ),
        )
        .orderBy(asc(tickets.number)),
    ]);

    return {
      tenant: { slug: tenant.slug, name: tenant.name },
      branch: { id: branch.id, name: branch.name },
      serviceDate,
      services: serviceRows.map((service) => {
        const own = openTickets.filter((t) => t.serviceId === service.id);
        const waiting = own.filter((t) => t.status === 'waiting').length;
        return {
          id: service.id,
          name: service.name,
          ticketPrefix: service.ticketPrefix,
          nowServing: own
            .filter((t) => ACTIVE_STATUSES.includes(t.status))
            .map(({ code, status, counter }) => ({ code, status, counter })),
          waiting,
          // Rough estimate: everyone waiting for this service, one at a time.
          estimatedWaitMinutes: waiting * service.avgServiceMinutes,
        };
      }),
    };
  }

  async createTicket(slug: string, dto: CreateTicketDto) {
    const tenant = await this.getTenant(slug);
    const [service] = await this.db
      .select()
      .from(services)
      .where(
        and(
          eq(services.id, dto.serviceId),
          eq(services.tenantId, tenant.id),
          eq(services.isActive, true),
        ),
      );
    if (!service) {
      throw new NotFoundException('Layanan tidak ditemukan');
    }

    const serviceDate = serviceDateFor(tenant.timezone);
    const ticket = await this.db.transaction(async (tx) => {
      // Serialise numbering per service per day so concurrent requests
      // never compute the same next number.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${service.id}:${serviceDate}`}))`,
      );
      const [{ last }] = await tx
        .select({
          last: sql<number>`coalesce(max(${tickets.number}), 0)`.mapWith(
            Number,
          ),
        })
        .from(tickets)
        .where(
          and(
            eq(tickets.serviceId, service.id),
            eq(tickets.serviceDate, serviceDate),
          ),
        );
      const number = last + 1;
      const [created] = await tx
        .insert(tickets)
        .values({
          tenantId: tenant.id,
          branchId: service.branchId,
          serviceId: service.id,
          serviceDate,
          number,
          code: ticketCode(service.ticketPrefix, number),
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          // Taken after the lock (unlike now(), the transaction start), so
          // created_at order matches number order and call-next stays FIFO.
          createdAt: sql`clock_timestamp()`,
        })
        .returning();
      return created;
    });

    return this.describeTicket(ticket);
  }

  async getTicket(slug: string, ticketId: string) {
    const tenant = await this.getTenant(slug);
    return this.describeTicket(await this.findTicket(tenant.id, ticketId));
  }

  // Operator console: what the counter is handling plus the branch's waiting line.
  async getCounter(slug: string, counterId: string) {
    const tenant = await this.getTenant(slug);
    const counter = await this.findCounter(tenant.id, counterId);
    const serviceDate = serviceDateFor(tenant.timezone);

    const [[current], waiting] = await Promise.all([
      this.db
        .select()
        .from(tickets)
        .where(
          and(
            eq(tickets.counterId, counter.id),
            eq(tickets.serviceDate, serviceDate),
            inArray(tickets.status, ACTIVE_STATUSES),
          ),
        )
        .limit(1),
      this.db
        .select({
          id: tickets.id,
          code: tickets.code,
          service: services.name,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .innerJoin(services, eq(services.id, tickets.serviceId))
        .where(
          and(
            eq(tickets.branchId, counter.branchId),
            eq(tickets.serviceDate, serviceDate),
            eq(tickets.status, 'waiting'),
          ),
        )
        .orderBy(asc(tickets.createdAt), asc(tickets.number))
        .limit(50),
    ]);

    return {
      counter: {
        id: counter.id,
        name: counter.name,
        branchId: counter.branchId,
      },
      current: current ? await this.describeTicket(current) : null,
      waiting,
    };
  }

  // Calls the oldest waiting ticket of the counter's branch to this counter.
  // Returns { ticket: null } when nobody is waiting.
  async callNext(slug: string, counterId: string, dto: CallNextDto = {}) {
    const tenant = await this.getTenant(slug);
    const counter = await this.findCounter(tenant.id, counterId);
    if (dto.serviceId) {
      const [service] = await this.db
        .select({ id: services.id })
        .from(services)
        .where(
          and(
            eq(services.id, dto.serviceId),
            eq(services.branchId, counter.branchId),
          ),
        );
      if (!service) {
        throw new NotFoundException('Layanan tidak ditemukan di cabang ini');
      }
    }

    const serviceDate = serviceDateFor(tenant.timezone);
    const called = await this.db.transaction(async (tx) => {
      // Lock the counter so two clicks on the same counter can't call two tickets.
      await tx
        .select({ id: counters.id })
        .from(counters)
        .where(eq(counters.id, counter.id))
        .for('update');

      const [active] = await tx
        .select({ code: tickets.code })
        .from(tickets)
        .where(
          and(
            eq(tickets.counterId, counter.id),
            eq(tickets.serviceDate, serviceDate),
            inArray(tickets.status, ACTIVE_STATUSES),
          ),
        )
        .limit(1);
      if (active) {
        throw new ConflictException(
          `Loket masih menangani ${active.code}; selesaikan atau lewati dulu`,
        );
      }

      // SKIP LOCKED lets other counters call concurrently without picking the same ticket.
      const [next] = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          and(
            eq(tickets.branchId, counter.branchId),
            eq(tickets.serviceDate, serviceDate),
            eq(tickets.status, 'waiting'),
            dto.serviceId ? eq(tickets.serviceId, dto.serviceId) : undefined,
          ),
        )
        .orderBy(asc(tickets.createdAt), asc(tickets.number))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!next) {
        return null;
      }

      const [updated] = await tx
        .update(tickets)
        .set({ status: 'called', counterId: counter.id, calledAt: new Date() })
        .where(eq(tickets.id, next.id))
        .returning();
      return updated;
    });

    return { ticket: called ? await this.describeTicket(called) : null };
  }

  async transitionTicket(slug: string, ticketId: string, action: TicketAction) {
    const tenant = await this.getTenant(slug);
    const { from, to, stamp } = TRANSITIONS[action];

    // Conditional update: only succeeds if the ticket is still in an allowed state.
    const [updated] = await this.db
      .update(tickets)
      .set({ status: to, [stamp]: new Date() })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.tenantId, tenant.id),
          inArray(tickets.status, from),
        ),
      )
      .returning();

    if (!updated) {
      const existing = await this.findTicket(tenant.id, ticketId);
      throw new ConflictException(
        `Tiket ${existing.code} tidak bisa ${ACTION_LABEL[action]} karena statusnya ${STATUS_LABEL[existing.status]}`,
      );
    }
    return this.describeTicket(updated);
  }

  // Today's figures for the admin dashboard of one branch.
  async getStats(slug: string, branchId?: string) {
    const tenant = await this.getTenant(slug);
    const branch = await this.findBranch(tenant.id, branchId);
    const serviceDate = serviceDateFor(tenant.timezone);

    const [statusRows, [{ averageWaitMinutes }], [{ counterCount }]] =
      await Promise.all([
        this.db
          .select({
            status: tickets.status,
            count: sql<number>`count(*)`.mapWith(Number),
          })
          .from(tickets)
          .where(
            and(
              eq(tickets.branchId, branch.id),
              eq(tickets.serviceDate, serviceDate),
            ),
          )
          .groupBy(tickets.status),
        // Time from taking a ticket to being called, for tickets called today.
        this.db
          .select({
            averageWaitMinutes: sql<
              number | null
            >`round(avg(extract(epoch from ${tickets.calledAt} - ${tickets.createdAt})) / 60)`.mapWith(
              (value) => (value === null ? null : Number(value)),
            ),
          })
          .from(tickets)
          .where(
            and(
              eq(tickets.branchId, branch.id),
              eq(tickets.serviceDate, serviceDate),
              isNotNull(tickets.calledAt),
            ),
          ),
        this.db
          .select({ counterCount: sql<number>`count(*)`.mapWith(Number) })
          .from(counters)
          .where(
            and(eq(counters.branchId, branch.id), eq(counters.isActive, true)),
          ),
      ]);

    const byStatus = (...statuses: TicketStatus[]) =>
      statusRows
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row.count, 0);

    return {
      tenant: { slug: tenant.slug, name: tenant.name },
      branch: { id: branch.id, name: branch.name },
      serviceDate,
      counters: counterCount,
      tickets: {
        waiting: byStatus('waiting'),
        serving: byStatus(...ACTIVE_STATUSES),
        completed: byStatus('completed'),
        skipped: byStatus('skipped', 'cancelled'),
      },
      averageWaitMinutes,
    };
  }

  // The requested branch, or the tenant's first active branch when none is given.
  private async findBranch(tenantId: string, branchId?: string) {
    const [branch] = await this.db
      .select()
      .from(branches)
      .where(
        and(
          eq(branches.tenantId, tenantId),
          eq(branches.isActive, true),
          branchId ? eq(branches.id, branchId) : undefined,
        ),
      )
      .orderBy(asc(branches.createdAt))
      .limit(1);
    if (!branch) {
      throw new NotFoundException('Cabang tidak ditemukan');
    }
    return branch;
  }

  private async findTicket(
    tenantId: string,
    ticketId: string,
  ): Promise<Ticket> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)));
    if (!ticket) {
      throw new NotFoundException('Tiket tidak ditemukan');
    }
    return ticket;
  }

  private async findCounter(tenantId: string, counterId: string) {
    const [counter] = await this.db
      .select()
      .from(counters)
      .where(
        and(
          eq(counters.id, counterId),
          eq(counters.tenantId, tenantId),
          eq(counters.isActive, true),
        ),
      );
    if (!counter) {
      throw new NotFoundException('Loket tidak ditemukan');
    }
    return counter;
  }

  private async describeTicket(ticket: Ticket) {
    const [[service], [counter], [{ ahead }]] = await Promise.all([
      this.db
        .select({
          name: services.name,
          avgServiceMinutes: services.avgServiceMinutes,
        })
        .from(services)
        .where(eq(services.id, ticket.serviceId)),
      ticket.counterId
        ? this.db
            .select({ name: counters.name })
            .from(counters)
            .where(eq(counters.id, ticket.counterId))
        : Promise.resolve([]),
      // People ahead in the same service line; only meaningful while waiting.
      ticket.status === 'waiting'
        ? this.db
            .select({ ahead: sql<number>`count(*)`.mapWith(Number) })
            .from(tickets)
            .where(
              and(
                eq(tickets.serviceId, ticket.serviceId),
                eq(tickets.serviceDate, ticket.serviceDate),
                eq(tickets.status, 'waiting'),
                lt(tickets.number, ticket.number),
              ),
            )
        : Promise.resolve([{ ahead: 0 }]),
    ]);

    return {
      id: ticket.id,
      code: ticket.code,
      status: ticket.status,
      serviceDate: ticket.serviceDate,
      service: { id: ticket.serviceId, name: service.name },
      counter: counter?.name ?? null,
      ahead,
      estimatedWaitMinutes: ahead * service.avgServiceMinutes,
      createdAt: ticket.createdAt,
      calledAt: ticket.calledAt,
      servedAt: ticket.servedAt,
      completedAt: ticket.completedAt,
    };
  }
}
