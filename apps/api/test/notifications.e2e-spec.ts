import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { hashPassword } from './../src/auth/password.js';
import { DatabaseService } from './../src/database/database.service.js';
import {
  branches,
  counters,
  notifications,
  services,
  tenants,
  tickets,
  users,
} from './../src/database/schema.js';
import {
  NotificationsService,
  WHATSAPP_SENDER,
} from './../src/notifications/notifications.service.js';
import {
  SendError,
  type OutgoingMessage,
  type WhatsAppSender,
} from './../src/notifications/whatsapp.js';

// Integration test against the real PostgreSQL and Redis from docker-compose.yml,
// with a fake WhatsApp provider that records messages.

const PASSWORD = 'notify-password';
type Agent = ReturnType<typeof request.agent>;

class FakeSender implements WhatsAppSender {
  readonly name = 'fake';
  sent: OutgoingMessage[] = [];
  // Errors to throw on the next sends, in order.
  failures: Error[] = [];

  send(message: OutgoingMessage) {
    const failure = this.failures.shift();
    if (failure) {
      return Promise.reject(failure);
    }
    this.sent.push(message);
    return Promise.resolve({ id: `fake-${this.sent.length}` });
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('WhatsApp notifications (e2e, real database)', () => {
  const fake = new FakeSender();
  let app: INestApplication<App>;
  let appOff: INestApplication<App>;
  let database: DatabaseService;
  let service: NotificationsService;
  let slug: string;
  let tenantId: string;
  let serviceId: string;
  let counterId: string;
  let admin: Agent;

  const take = (customerPhone?: string, customerName?: string) =>
    request(app.getHttpServer())
      .post(`/tenants/${slug}/tickets`)
      .send({ serviceId, customerPhone, customerName });
  const callNext = () =>
    admin.post(`/tenants/${slug}/counters/${counterId}/call-next`).expect(200);
  const complete = (ticketId: string) =>
    admin.post(`/tenants/${slug}/tickets/${ticketId}/complete`).expect(200);
  const rowsFor = (ticketId: string) =>
    database.db
      .select()
      .from(notifications)
      .where(eq(notifications.ticketId, ticketId));
  const sentTo = (phone: string) => fake.sent.filter((m) => m.to === phone);
  // Waits until the worker has recorded the outcome of every due message.
  const settled = () =>
    waitFor(async () => {
      const rows = await database.db
        .select({
          status: notifications.status,
          next: notifications.nextAttemptAt,
        })
        .from(notifications)
        .where(eq(notifications.tenantId, tenantId));
      return rows.every(
        (r) =>
          r.status !== 'sending' &&
          !(r.status === 'pending' && r.next.getTime() <= Date.now()),
      );
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_SENDER)
      .useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // Same app without the override: WHATSAPP_DRIVER is unset, so off.
    appOff = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    await appOff.init();

    database = app.get(DatabaseService);
    service = app.get(NotificationsService);
    const db = database.db;
    slug = `notify-${randomUUID().slice(0, 8)}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ slug, name: 'Salon Uji' })
      .returning();
    tenantId = tenant.id;
    const [branch] = await db
      .insert(branches)
      .values({ tenantId, name: 'Main' })
      .returning();
    const [svc] = await db
      .insert(services)
      .values({
        tenantId,
        branchId: branch.id,
        name: 'Haircut',
        ticketPrefix: 'A',
      })
      .returning();
    serviceId = svc.id;
    const [counter] = await db
      .insert(counters)
      .values({ tenantId, branchId: branch.id, name: 'Counter 01' })
      .returning();
    counterId = counter.id;
    await db.insert(users).values({
      tenantId,
      email: `admin@${slug}.test`,
      name: 'Admin',
      passwordHash: await hashPassword(PASSWORD),
      role: 'admin',
    });
    admin = request.agent(app.getHttpServer());
    await admin
      .post(`/tenants/${slug}/auth/login`)
      .send({ email: `admin@${slug}.test`, password: PASSWORD })
      .expect(200);
  });

  afterAll(async () => {
    if (tenantId) {
      await database.db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await app.close();
    await appOff.close();
  });

  it('is off without a configured driver: no field, phone not kept', async () => {
    const off = () => request(appOff.getHttpServer());
    const overview = await off().get(`/tenants/${slug}`).expect(200);
    expect(overview.body.whatsapp).toBe(false);

    const created = await off()
      .post(`/tenants/${slug}/tickets`)
      .send({ serviceId, customerPhone: '081200000000' })
      .expect(201);
    expect(created.body.whatsapp).toBeNull();
    const [row] = await database.db
      .select({ phone: tickets.customerPhone })
      .from(tickets)
      .where(eq(tickets.id, created.body.id));
    expect(row.phone).toBeNull();
    // Leave the line as the rest of the test expects it.
    await database.db.delete(tickets).where(eq(tickets.id, created.body.id));
  });

  it('notifies customers as the line moves, once each', async () => {
    const overview = await request(app.getHttpServer())
      .get(`/tenants/${slug}`)
      .expect(200);
    expect(overview.body.whatsapp).toBe(true);

    // Invalid numbers: rejected by the DTO, or by normalisation.
    for (const phone of ['nomor saya', '0-0-0-0-0-0']) {
      const res = await take(phone).expect(400);
      expect(JSON.stringify(res.body.message)).toContain(
        'Nomor WhatsApp tidak valid',
      );
    }

    // Line of six, near threshold 3 (WHATSAPP_NEAR_AHEAD default).
    const t1 = (await take('0811-1111-1111', 'Ani').expect(201)).body;
    const t2 = (await take().expect(201)).body; // no number
    const t3 = (await take('+62 813 3333 3333').expect(201)).body;
    const t4 = (await take('6281444444444').expect(201)).body;
    const t5 = (await take('081555555555').expect(201)).body;
    const t6 = (await take('081666666666').expect(201)).body;
    expect(t1.whatsapp).toBe('••••1111');
    expect(t2.whatsapp).toBeNull();
    // Stored normalised.
    const [stored] = await database.db
      .select({ phone: tickets.customerPhone })
      .from(tickets)
      .where(eq(tickets.id, t3.id));
    expect(stored.phone).toBe('6281333333333');

    // Taken with 3 or fewer ahead: no "near" message later.
    for (const t of [t1, t3, t4]) {
      expect(await rowsFor(t.id)).toMatchObject([
        { kind: 'near', status: 'skipped' },
      ]);
    }
    expect(await rowsFor(t5.id)).toEqual([]);

    // A001 called: Ani is told where to go; A005 now has 3 ahead.
    await callNext();
    await waitFor(() => fake.sent.length === 2);
    await settled();
    expect(sentTo('6281111111111')).toEqual([
      {
        to: '6281111111111',
        kind: 'called',
        text: 'Halo Ani, nomor antrean A001 sekarang dipanggil. Silakan menuju Counter 01 di Salon Uji.',
        params: ['A001', 'Counter 01', 'Salon Uji'],
      },
    ]);
    expect(sentTo('6281555555555')).toMatchObject([
      { kind: 'near', params: ['A005', 'Salon Uji', '3'] },
    ]);
    expect(await rowsFor(t1.id)).toContainEqual(
      expect.objectContaining({
        kind: 'called',
        status: 'sent',
        attempts: 1,
        providerMessageId: 'fake-1',
      }),
    );

    // A002 (no number) called: only A006 is newly near.
    await complete(t1.id);
    await callNext();
    await waitFor(() => fake.sent.length === 3);
    await settled();
    expect(sentTo('6281666666666')).toMatchObject([
      { kind: 'near', params: ['A006', 'Salon Uji', '3'] },
    ]);
    // A005 was not told again.
    expect(sentTo('6281555555555')).toHaveLength(1);

    // A003 called while the provider is down: retried later, then sent.
    fake.failures.push(new SendError('Fonnte HTTP 502', true));
    await complete(t2.id);
    await callNext();
    await waitFor(async () => {
      const rows = await rowsFor(t3.id);
      return rows.some(
        (r) =>
          r.kind === 'called' && r.status === 'pending' && r.attempts === 1,
      );
    });
    const [pending] = (await rowsFor(t3.id)).filter((r) => r.kind === 'called');
    expect(pending).toMatchObject({
      attempts: 1,
      lastError: 'Fonnte HTTP 502',
    });
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(
      Date.now() + 20_000,
    );
    expect(sentTo('6281333333333')).toEqual([]);
    // Make the retry due now instead of in 30 s.
    await database.db
      .update(notifications)
      .set({ nextAttemptAt: new Date() })
      .where(eq(notifications.id, pending.id));
    service.kick();
    await waitFor(() => sentTo('6281333333333').length === 1);
    await settled();
    expect(await rowsFor(t3.id)).toContainEqual(
      expect.objectContaining({ kind: 'called', status: 'sent', attempts: 2 }),
    );

    // A004 called but the number is rejected: failed, not retried.
    fake.failures.push(new SendError('Fonnte: target invalid', false));
    await complete(t3.id);
    await callNext();
    await waitFor(async () =>
      (await rowsFor(t4.id)).some((r) => r.status === 'failed'),
    );
    expect(sentTo('6281444444444')).toEqual([]);

    // A message that no longer applies is skipped, not sent.
    await database.db.insert(notifications).values({
      tenantId,
      ticketId: t6.id,
      kind: 'called',
      phone: '6281666666666',
    });
    service.kick();
    await waitFor(async () =>
      (await rowsFor(t6.id)).some(
        (r) => r.kind === 'called' && r.status === 'skipped',
      ),
    );
    expect(sentTo('6281666666666')).toHaveLength(1);

    // Admin dashboard counts today's messages.
    const stats = await admin.get(`/tenants/${slug}/stats`).expect(200);
    expect(stats.body.notifications).toEqual({
      sent: 4,
      failed: 1,
      pending: 0,
    });

    // Exactly one row per ticket and kind.
    const all = await database.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, tenantId)));
    const keys = all.map((r) => `${r.ticketId}:${r.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reports notifications as off on the stats endpoint without a driver', async () => {
    const agent = request.agent(appOff.getHttpServer());
    await agent
      .post(`/tenants/${slug}/auth/login`)
      .send({ email: `admin@${slug}.test`, password: PASSWORD })
      .expect(200);
    const stats = await agent.get(`/tenants/${slug}/stats`).expect(200);
    expect(stats.body.notifications).toBeNull();
  });
});
