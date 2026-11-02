import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import {
  branches,
  counters,
  services,
  tenants,
} from './../src/database/schema.js';

// Integration test against the real PostgreSQL from docker-compose.yml
// (DATABASE_URL in .env). Each run creates its own tenants and deletes them after.

type Fixture = {
  slug: string;
  tenantId: string;
  haircutId: string;
  coloringId: string;
  counter1Id: string;
  counter2Id: string;
};

describe('Queue (e2e, real database)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let main: Fixture;
  let other: Fixture;

  async function createTenant(): Promise<Fixture> {
    const db = database.db;
    const slug = `test-${randomUUID().slice(0, 8)}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ slug, name: 'Test Tenant' })
      .returning();
    const [branch] = await db
      .insert(branches)
      .values({ tenantId: tenant.id, name: 'Main' })
      .returning();
    const [haircut, coloring] = await db
      .insert(services)
      .values([
        {
          tenantId: tenant.id,
          branchId: branch.id,
          name: 'Haircut',
          ticketPrefix: 'A',
          avgServiceMinutes: 10,
        },
        {
          tenantId: tenant.id,
          branchId: branch.id,
          name: 'Coloring',
          ticketPrefix: 'B',
          avgServiceMinutes: 60,
        },
      ])
      .returning();
    const [counter1, counter2] = await db
      .insert(counters)
      .values([
        { tenantId: tenant.id, branchId: branch.id, name: 'Counter 01' },
        { tenantId: tenant.id, branchId: branch.id, name: 'Counter 02' },
      ])
      .returning();
    return {
      slug,
      tenantId: tenant.id,
      haircutId: haircut.id,
      coloringId: coloring.id,
      counter1Id: counter1.id,
      counter2Id: counter2.id,
    };
  }

  const api = () => request(app.getHttpServer());
  const takeTicket = (f: Fixture, serviceId: string) =>
    api().post(`/tenants/${f.slug}/tickets`).send({ serviceId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    main = await createTenant();
    other = await createTenant();
  });

  afterAll(async () => {
    for (const f of [main, other].filter(Boolean)) {
      await database.db.delete(tenants).where(eq(tenants.id, f.tenantId));
    }
    await app.close();
  });

  it('returns 404 for an unknown tenant', async () => {
    await api().get('/tenants/does-not-exist/queue').expect(404);
  });

  it('describes the tenant with its branches, services and counters', async () => {
    const { body } = await api().get(`/tenants/${main.slug}`).expect(200);
    expect(body.slug).toBe(main.slug);
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].services.map((s: any) => s.ticketPrefix)).toEqual([
      'A',
      'B',
    ]);
    expect(body.branches[0].counters).toHaveLength(2);
  });

  it('rejects invalid ticket requests', async () => {
    await api()
      .post(`/tenants/${main.slug}/tickets`)
      .send({ serviceId: 'not-a-uuid' })
      .expect(400);
    await api()
      .post(`/tenants/${main.slug}/tickets`)
      .send({ serviceId: main.haircutId, admin: true })
      .expect(400);
    await api()
      .post(`/tenants/${main.slug}/tickets`)
      .send({ serviceId: main.haircutId, customerPhone: 'call me' })
      .expect(400);
    // A real service, but it belongs to another tenant.
    await takeTicket(main, other.haircutId).expect(404);
  });

  it('numbers tickets per service without duplicates under concurrency', async () => {
    const first = await takeTicket(main, main.haircutId).expect(201);
    expect(first.body.code).toBe('A001');
    expect(first.body.status).toBe('waiting');
    expect(first.body.ahead).toBe(0);

    const burst = await Promise.all(
      Array.from({ length: 10 }, () => takeTicket(main, main.haircutId)),
    );
    const codes = burst
      .map((r) => r.body.code)
      .sort((x: string, y: string) => x.localeCompare(y));
    expect(codes).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `A${String(i + 2).padStart(3, '0')}`,
      ),
    );

    const coloring = await takeTicket(main, main.coloringId).expect(201);
    expect(coloring.body.code).toBe('B001');

    const last = burst.find((r) => r.body.code === 'A011')!;
    expect(last.body.ahead).toBe(10);
    expect(last.body.estimatedWaitMinutes).toBe(100);
  });

  it('shows the public queue board', async () => {
    const { body } = await api().get(`/tenants/${main.slug}/queue`).expect(200);
    const haircut = body.services.find((s: any) => s.ticketPrefix === 'A');
    expect(haircut.waiting).toBe(11);
    expect(haircut.estimatedWaitMinutes).toBe(110);
    expect(haircut.nowServing).toEqual([]);
  });

  it('runs the operator flow: call, conflict, start, complete', async () => {
    const counterUrl = `/tenants/${main.slug}/counters/${main.counter1Id}`;

    const called = await api().post(`${counterUrl}/call-next`).expect(200);
    expect(called.body.ticket.code).toBe('A001');
    expect(called.body.ticket.status).toBe('called');
    expect(called.body.ticket.counter).toBe('Counter 01');

    // The counter must finish its current ticket before calling another.
    await api().post(`${counterUrl}/call-next`).expect(409);

    const ticketUrl = `/tenants/${main.slug}/tickets/${called.body.ticket.id}`;
    await api().post(`${ticketUrl}/start`).expect(200);
    const done = await api().post(`${ticketUrl}/complete`).expect(200);
    expect(done.body.status).toBe('completed');
    expect(done.body.completedAt).not.toBeNull();

    // Completing twice is a state conflict, not a success.
    await api().post(`${ticketUrl}/complete`).expect(409);

    const board = await api().get(counterUrl).expect(200);
    expect(board.body.current).toBeNull();
    // FIFO: the waiting line follows ticket numbers, even for the concurrent burst.
    expect(board.body.waiting.map((t: any) => t.code)).toEqual([
      ...Array.from(
        { length: 10 },
        (_, i) => `A${String(i + 2).padStart(3, '0')}`,
      ),
      'B001',
    ]);
  });

  it('lets two counters call at the same time without sharing a ticket', async () => {
    const [a, b] = await Promise.all([
      api().post(`/tenants/${main.slug}/counters/${main.counter1Id}/call-next`),
      api().post(`/tenants/${main.slug}/counters/${main.counter2Id}/call-next`),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.ticket.code).not.toBe(b.body.ticket.code);

    const board = await api().get(`/tenants/${main.slug}/queue`).expect(200);
    const haircut = board.body.services.find(
      (s: any) => s.ticketPrefix === 'A',
    );
    expect(
      haircut.nowServing
        .map((t: any) => t.counter)
        .sort((x: string, y: string) => x.localeCompare(y)),
    ).toEqual(['Counter 01', 'Counter 02']);

    await api()
      .post(`/tenants/${main.slug}/tickets/${a.body.ticket.id}/skip`)
      .expect(200);
    await api()
      .post(`/tenants/${main.slug}/tickets/${b.body.ticket.id}/complete`)
      .expect(200);
  });

  it('can call a specific service only', async () => {
    const { body } = await api()
      .post(`/tenants/${main.slug}/counters/${main.counter1Id}/call-next`)
      .send({ serviceId: main.coloringId })
      .expect(200);
    expect(body.ticket.code).toBe('B001');
    await api()
      .post(`/tenants/${main.slug}/tickets/${body.ticket.id}/complete`)
      .expect(200);
  });

  it('returns ticket null when nobody is waiting', async () => {
    const { body } = await api()
      .post(`/tenants/${other.slug}/counters/${other.counter1Id}/call-next`)
      .expect(200);
    expect(body).toEqual({ ticket: null });
  });

  it('never exposes or changes another tenant’s tickets', async () => {
    const ticket = await takeTicket(main, main.haircutId).expect(201);
    const foreign = `/tenants/${other.slug}/tickets/${ticket.body.id}`;
    await api().get(foreign).expect(404);
    await api().post(`${foreign}/complete`).expect(404);
    await api()
      .post(`/tenants/${other.slug}/counters/${main.counter1Id}/call-next`)
      .expect(404);
  });
});
