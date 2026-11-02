import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { hashPassword } from './../src/auth/password.js';
import { DatabaseService } from './../src/database/database.service.js';
import {
  branches,
  counters,
  services,
  tenants,
  tickets,
  users,
} from './../src/database/schema.js';
import { serviceDateFor } from './../src/queue/service-date.js';

// Integration test against the real PostgreSQL and Redis from docker-compose.yml.
// Tickets are inserted with fixed timestamps so every number can be checked.

const PASSWORD = 'reports-password';
const TIMEZONE = 'Asia/Jakarta';
type Agent = ReturnType<typeof request.agent>;

// Wall-clock time in Jakarta (UTC+7, no daylight saving time).
const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

describe('Reports (e2e, real database)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let slug: string;
  let tenantId: string;
  let otherTenantId: string;
  let north: { id: string; name: string };
  let admin: Agent;
  let operator: Agent;

  const api = () => request(app.getHttpServer());
  const report = (query = '') =>
    admin.get(`/tenants/${slug}/admin/reports${query}`);

  async function loginAgent(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post(`/tenants/${slug}/auth/login`)
      .send({ email, password: PASSWORD })
      .expect(200);
    return agent;
  }

  async function createTenant(name: string) {
    const db = database.db;
    const tenantSlug = `reports-${randomUUID().slice(0, 8)}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ slug: tenantSlug, name, timezone: TIMEZONE })
      .returning();
    return tenant;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    const db = database.db;

    const tenant = await createTenant('Reports Test');
    slug = tenant.slug;
    tenantId = tenant.id;
    const [main, northBranch] = await db
      .insert(branches)
      .values([
        { tenantId, name: 'Main' },
        { tenantId, name: 'North' },
      ])
      .returning();
    north = { id: northBranch.id, name: northBranch.name };
    const [haircut, coloring, northService] = await db
      .insert(services)
      .values([
        { tenantId, branchId: main.id, name: 'Haircut', ticketPrefix: 'A' },
        { tenantId, branchId: main.id, name: 'Coloring', ticketPrefix: 'B' },
        { tenantId, branchId: north.id, name: 'Nails', ticketPrefix: 'N' },
      ])
      .returning();
    const [counter1, counter2, northCounter] = await db
      .insert(counters)
      .values([
        { tenantId, branchId: main.id, name: 'Counter 01' },
        { tenantId, branchId: main.id, name: 'Counter 02' },
        { tenantId, branchId: north.id, name: 'North 01' },
      ])
      .returning();
    const passwordHash = await hashPassword(PASSWORD);
    await db.insert(users).values([
      {
        tenantId,
        email: `admin@${slug}.test`,
        name: 'Admin',
        passwordHash,
        role: 'admin',
      },
      {
        tenantId,
        email: `operator@${slug}.test`,
        name: 'Operator',
        passwordHash,
        role: 'operator',
      },
    ]);

    const ticket = (
      service: typeof haircut,
      serviceDate: string,
      number: number,
    ) => ({
      tenantId,
      branchId: service.branchId,
      serviceId: service.id,
      serviceDate,
      number,
      code: `${service.ticketPrefix}${number}`,
    });
    const d1 = '2026-03-01';
    const d3 = '2026-03-03';
    await db.insert(tickets).values([
      // Day 1: completed (wait 10, service 20), skipped (wait 20), still waiting.
      {
        ...ticket(haircut, d1, 1),
        counterId: counter1.id,
        status: 'completed',
        createdAt: at(d1, '09:00'),
        calledAt: at(d1, '09:10'),
        servedAt: at(d1, '09:11'),
        completedAt: at(d1, '09:31'),
      },
      {
        ...ticket(haircut, d1, 2),
        counterId: counter1.id,
        status: 'skipped',
        createdAt: at(d1, '09:30'),
        calledAt: at(d1, '09:50'),
        completedAt: at(d1, '09:53'),
      },
      {
        ...ticket(coloring, d1, 1),
        status: 'waiting',
        createdAt: at(d1, '14:05'),
      },
      // Day 2 is empty.
      // Day 3: completed without "start" (service counts from the call), and
      // one ticket at the North branch.
      {
        ...ticket(coloring, d3, 1),
        counterId: counter2.id,
        status: 'completed',
        createdAt: at(d3, '10:00'),
        calledAt: at(d3, '10:06'),
        completedAt: at(d3, '10:36'),
      },
      {
        ...ticket(northService, d3, 1),
        counterId: northCounter.id,
        status: 'completed',
        createdAt: at(d3, '11:00'),
        calledAt: at(d3, '11:04'),
        servedAt: at(d3, '11:04'),
        completedAt: at(d3, '11:14'),
      },
      // Outside the range below.
      {
        ...ticket(haircut, '2026-03-04', 1),
        status: 'waiting',
        createdAt: at('2026-03-04', '09:00'),
      },
    ]);

    // Another tenant's ticket on the same day must never be counted.
    const other = await createTenant('Other');
    otherTenantId = other.id;
    const [otherBranch] = await db
      .insert(branches)
      .values({ tenantId: other.id, name: 'Main' })
      .returning();
    const [otherService] = await db
      .insert(services)
      .values({
        tenantId: other.id,
        branchId: otherBranch.id,
        name: 'Other',
        ticketPrefix: 'A',
      })
      .returning();
    await db.insert(tickets).values({
      tenantId: other.id,
      branchId: otherBranch.id,
      serviceId: otherService.id,
      serviceDate: d1,
      number: 1,
      code: 'A1',
      createdAt: at(d1, '09:00'),
    });

    admin = await loginAgent(`admin@${slug}.test`);
    operator = await loginAgent(`operator@${slug}.test`);
  });

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId].filter(Boolean)) {
      await database.db.delete(tenants).where(eq(tenants.id, id));
    }
    await app.close();
  });

  it('is admin-only', async () => {
    await api().get(`/tenants/${slug}/admin/reports`).expect(401);
    await operator.get(`/tenants/${slug}/admin/reports`).expect(403);
  });

  it('summarises a date range across all branches', async () => {
    const { body } = await report('?from=2026-03-01&to=2026-03-03').expect(200);
    expect(body).toMatchObject({
      from: '2026-03-01',
      to: '2026-03-03',
      timezone: TIMEZONE,
      branch: null,
      summary: {
        total: 5,
        completed: 3,
        skipped: 1,
        unfinished: 1,
        avgWaitMinutes: 10, // (10 + 20 + 6 + 4) / 4
        avgServiceMinutes: 20, // (20 + 30 + 10) / 3
      },
    });

    // Every day of the range, including the empty one.
    expect(body.daily).toEqual([
      {
        date: '2026-03-01',
        total: 3,
        completed: 1,
        skipped: 1,
        unfinished: 1,
        avgWaitMinutes: 15,
        avgServiceMinutes: 20,
      },
      {
        date: '2026-03-02',
        total: 0,
        completed: 0,
        skipped: 0,
        unfinished: 0,
        avgWaitMinutes: null,
        avgServiceMinutes: null,
      },
      {
        date: '2026-03-03',
        total: 2,
        completed: 2,
        skipped: 0,
        unfinished: 0,
        avgWaitMinutes: 5,
        avgServiceMinutes: 20,
      },
    ]);

    expect(
      body.byService.map((s: { ticketPrefix: string; total: number }) => [
        s.ticketPrefix,
        s.total,
      ]),
    ).toEqual([
      ['A', 2],
      ['B', 2],
      ['N', 1],
    ]);
    expect(body.byService[1]).toMatchObject({
      name: 'Coloring',
      completed: 1,
      unfinished: 1,
      avgServiceMinutes: 30,
    });

    expect(body.byCounter).toMatchObject([
      { name: 'Counter 01', total: 2, completed: 1, skipped: 1 },
      { name: 'Counter 02', total: 1, completed: 1, avgServiceMinutes: 30 },
      { name: 'North 01', total: 1, completed: 1, avgServiceMinutes: 10 },
    ]);

    // Hours are in the tenant's timezone, not the server's.
    const hours = Object.fromEntries(
      body.byHour
        .filter((h: { total: number }) => h.total > 0)
        .map((h: { hour: number; total: number }) => [h.hour, h.total]),
    );
    expect(body.byHour).toHaveLength(24);
    expect(hours).toEqual({ 9: 2, 10: 1, 11: 1, 14: 1 });
  });

  it('filters by branch', async () => {
    const { body } = await report(
      `?from=2026-03-01&to=2026-03-03&branchId=${north.id}`,
    ).expect(200);
    expect(body.branch).toEqual(north);
    expect(body.summary).toMatchObject({ total: 1, completed: 1 });
    expect(body.byService).toHaveLength(1);
    expect(body.byCounter).toMatchObject([{ name: 'North 01' }]);
  });

  it('defaults to the last 7 days in the tenant timezone', async () => {
    const { body } = await report().expect(200);
    const today = serviceDateFor(TIMEZONE);
    expect(body.to).toBe(today);
    expect(body.daily).toHaveLength(7);
    expect(body.daily[6].date).toBe(today);
    expect(body.from).toBe(body.daily[0].date);
  });

  it('rejects invalid ranges', async () => {
    for (const query of [
      '?from=2026-02-30',
      '?from=03-01-2026',
      '?from=2026-03-05&to=2026-03-01',
      '?from=2026-01-01&to=2026-06-01',
      '?branchId=nope',
      '?extra=1',
    ]) {
      await report(query).expect(400);
    }
    await report('?from=2026-01-01&to=2026-04-02').expect(200); // 92 days
    await report(`?branchId=${randomUUID()}`).expect(404);
  });
});
