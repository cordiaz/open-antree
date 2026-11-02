import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  counters,
  notifications,
  tenants,
  tickets,
} from '../database/schema.js';
import { renderMessage } from './messages.js';
import { SendError, type WhatsAppSender } from './whatsapp.js';

type Ticket = typeof tickets.$inferSelect;
// The database or an open transaction.
type Executor = Pick<DatabaseService['db'], 'select' | 'insert'>;
type Notification = typeof notifications.$inferSelect;

export const WHATSAPP_SENDER = Symbol('WHATSAPP_SENDER');

// How often the worker looks for due messages besides being woken up on
// enqueue (retries, and messages another instance enqueued).
const POLL_MS = 5_000;
const BATCH = 10;
// A claimed message whose worker died is picked up again after this.
const LOCK_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
// A "you're being called" message arriving later than this is just noise.
const CALLED_STALE_MS = 15 * 60_000;

// Queues WhatsApp messages for customers who left a number, and delivers
// them in the background. Several API instances can run the worker at once:
// rows are claimed with FOR UPDATE SKIP LOCKED.
@Injectable()
export class NotificationsService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(NotificationsService.name);
  // Customers get a "near" message once this many tickets or fewer are ahead.
  readonly nearAhead: number;
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private pendingKick = false;
  private stopped = false;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
    @Inject(WHATSAPP_SENDER) private readonly sender: WhatsAppSender | null,
  ) {
    this.nearAhead = Number(config.get('WHATSAPP_NEAR_AHEAD') ?? 3);
  }

  private get db() {
    return this.database.db;
  }

  get enabled() {
    return this.sender !== null;
  }

  onApplicationBootstrap() {
    if (!this.sender) {
      return;
    }
    this.logger.log(`WhatsApp notifications via "${this.sender.name}"`);
    this.timer = setInterval(() => this.kick(), POLL_MS);
    this.timer.unref();
    this.kick();
  }

  async beforeApplicationShutdown() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.running;
  }

  // A ticket was taken. If it's already near the front there's no point in a
  // "near" message later, so record it as skipped.
  async ticketCreated(ticket: Ticket, ahead: number) {
    if (!this.sender || !ticket.customerPhone || ahead > this.nearAhead) {
      return;
    }
    await this.db
      .insert(notifications)
      .values({
        tenantId: ticket.tenantId,
        ticketId: ticket.id,
        kind: 'near',
        phone: ticket.customerPhone,
        status: 'skipped',
        lastError: 'Sudah dekat saat mengambil nomor',
      })
      .onConflictDoNothing();
  }

  // A ticket was called: tell its customer, and the line moved up one, so
  // tell whoever is now near the front. Pass the transaction that called the
  // ticket so the messages commit with it, then kick() after the commit.
  async ticketCalled(called: Ticket, db: Executor = this.db) {
    if (!this.sender) {
      return;
    }
    const front = await db
      .select({ id: tickets.id, phone: tickets.customerPhone })
      .from(tickets)
      .where(
        and(
          eq(tickets.serviceId, called.serviceId),
          eq(tickets.serviceDate, called.serviceDate),
          eq(tickets.status, 'waiting'),
        ),
      )
      .orderBy(asc(tickets.number))
      .limit(this.nearAhead + 1);

    const rows = [
      ...(called.customerPhone
        ? [
            {
              ticketId: called.id,
              phone: called.customerPhone,
              kind: 'called' as const,
            },
          ]
        : []),
      ...front
        .filter((t) => t.phone)
        .map((t) => ({
          ticketId: t.id,
          phone: t.phone!,
          kind: 'near' as const,
        })),
    ];
    if (rows.length === 0) {
      return;
    }
    await db
      .insert(notifications)
      .values(rows.map((row) => ({ ...row, tenantId: called.tenantId })))
      .onConflictDoNothing();
  }

  // Message counts for the admin dashboard, for tickets of one day.
  async summary(branchId: string, serviceDate: string) {
    const rows = await this.db
      .select({
        status: notifications.status,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(notifications)
      .innerJoin(tickets, eq(tickets.id, notifications.ticketId))
      .where(
        and(
          eq(tickets.branchId, branchId),
          eq(tickets.serviceDate, serviceDate),
        ),
      )
      .groupBy(notifications.status);
    const count = (...statuses: Notification['status'][]) =>
      rows
        .filter((r) => statuses.includes(r.status))
        .reduce((sum, r) => sum + r.count, 0);
    return {
      sent: count('sent'),
      failed: count('failed'),
      pending: count('pending', 'sending'),
    };
  }

  // Runs the worker now, or right after the current run.
  kick() {
    if (!this.sender || this.stopped) {
      return;
    }
    if (this.running) {
      this.pendingKick = true;
      return;
    }
    this.running = this.drain()
      .catch((error: unknown) =>
        this.logger.error(`Notification worker failed: ${String(error)}`),
      )
      .finally(() => {
        this.running = null;
        if (this.pendingKick) {
          this.pendingKick = false;
          this.kick();
        }
      });
  }

  // Delivers due messages until none are left.
  async drain() {
    while (!this.stopped) {
      const batch = await this.claim();
      if (batch.length === 0) {
        return;
      }
      await Promise.all(batch.map((n) => this.deliver(n)));
    }
  }

  private claim() {
    const due = this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        or(
          and(
            eq(notifications.status, 'pending'),
            lte(notifications.nextAttemptAt, sql`now()`),
          ),
          and(
            eq(notifications.status, 'sending'),
            lt(notifications.lockedUntil, sql`now()`),
          ),
        ),
      )
      .orderBy(asc(notifications.nextAttemptAt))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    return this.db
      .update(notifications)
      .set({
        status: 'sending',
        attempts: sql`${notifications.attempts} + 1`,
        lockedUntil: sql`now() + make_interval(secs => ${LOCK_SECONDS})`,
      })
      .where(inArray(notifications.id, due))
      .returning();
  }

  private async deliver(notification: Notification) {
    const finish = (values: Partial<Notification>) =>
      this.db
        .update(notifications)
        .set({ lockedUntil: null, ...values })
        .where(
          and(
            eq(notifications.id, notification.id),
            eq(notifications.status, 'sending'),
          ),
        );

    try {
      const [row] = await this.db
        .select({
          ticket: tickets,
          tenantName: tenants.name,
          counterName: counters.name,
        })
        .from(tickets)
        .innerJoin(tenants, eq(tenants.id, tickets.tenantId))
        .leftJoin(counters, eq(counters.id, tickets.counterId))
        .where(eq(tickets.id, notification.ticketId));
      const skip = this.irrelevant(notification, row.ticket);
      if (skip) {
        await finish({ status: 'skipped', lastError: skip });
        return;
      }
      const ahead =
        notification.kind === 'near' ? await this.ahead(row.ticket) : 0;
      const { text, params } = renderMessage({
        kind: notification.kind,
        code: row.ticket.code,
        tenantName: row.tenantName,
        customerName: row.ticket.customerName,
        ahead,
        counterName: row.counterName,
      });
      const { id } = await this.sender!.send({
        to: notification.phone,
        kind: notification.kind,
        text,
        params,
      });
      await finish({
        status: 'sent',
        sentAt: new Date(),
        providerMessageId: id,
        lastError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry =
        error instanceof SendError
          ? error.retryable && notification.attempts < MAX_ATTEMPTS
          : notification.attempts < MAX_ATTEMPTS;
      this.logger.warn(
        `WhatsApp ${notification.kind} for ticket ${notification.ticketId} failed (attempt ${notification.attempts}${retry ? ', will retry' : ''}): ${message}`,
      );
      await finish(
        retry
          ? {
              status: 'pending',
              lastError: message,
              nextAttemptAt: new Date(
                Date.now() + RETRY_BASE_MS * 2 ** (notification.attempts - 1),
              ),
            }
          : { status: 'failed', lastError: message },
      );
    }
  }

  // Why the message no longer makes sense, or null to send it.
  private irrelevant(notification: Notification, ticket: Ticket) {
    if (notification.kind === 'near') {
      return ticket.status === 'waiting' ? null : 'Tiket sudah tidak menunggu';
    }
    if (ticket.status !== 'called') {
      return 'Tiket sudah tidak dalam status dipanggil';
    }
    if (
      ticket.calledAt &&
      Date.now() - ticket.calledAt.getTime() > CALLED_STALE_MS
    ) {
      return 'Terlambat: tiket dipanggil lebih dari 15 menit lalu';
    }
    return null;
  }

  // Same rule as the customer page: waiting tickets before it in its line.
  private async ahead(ticket: Ticket) {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(tickets)
      .where(
        and(
          eq(tickets.serviceId, ticket.serviceId),
          eq(tickets.serviceDate, ticket.serviceDate),
          eq(tickets.status, 'waiting'),
          lt(tickets.number, ticket.number),
        ),
      );
    return count;
  }
}
