import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { hashPassword } from './../src/auth/password.js';
import { DatabaseService } from './../src/database/database.service.js';
import { branches, tenants, users } from './../src/database/schema.js';

// Integration test against the real PostgreSQL and Redis from docker-compose.yml.

const PASSWORD = 'admin-password';
type Agent = ReturnType<typeof request.agent>;
type Fixture = {
  slug: string;
  tenantId: string;
  branchId: string;
  adminId: string;
  admin: Agent;
  operator: Agent;
};

describe('Admin management (e2e, real database)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let a: Fixture;
  let b: Fixture;

  const api = () => request(app.getHttpServer());

  async function loginAgent(slug: string, email: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post(`/tenants/${slug}/auth/login`)
      .send({ email, password })
      .expect(200);
    return agent;
  }

  async function createTenant(): Promise<Fixture> {
    const db = database.db;
    const slug = `admin-${randomUUID().slice(0, 8)}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ slug, name: 'Admin Test' })
      .returning();
    const [branch] = await db
      .insert(branches)
      .values({ tenantId: tenant.id, name: 'Main' })
      .returning();
    const passwordHash = await hashPassword(PASSWORD);
    const [admin] = await db
      .insert(users)
      .values([
        {
          tenantId: tenant.id,
          email: `admin@${slug}.test`,
          name: 'Admin',
          passwordHash,
          role: 'admin',
        },
        {
          tenantId: tenant.id,
          email: `operator@${slug}.test`,
          name: 'Operator',
          passwordHash,
          role: 'operator',
        },
      ])
      .returning();
    return {
      slug,
      tenantId: tenant.id,
      branchId: branch.id,
      adminId: admin.id,
      admin: await loginAgent(slug, `admin@${slug}.test`, PASSWORD),
      operator: await loginAgent(slug, `operator@${slug}.test`, PASSWORD),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    database = app.get(DatabaseService);
    a = await createTenant();
    b = await createTenant();
  });

  afterAll(async () => {
    for (const f of [a, b].filter(Boolean)) {
      await database.db.delete(tenants).where(eq(tenants.id, f.tenantId));
    }
    await app.close();
  });

  it('is admin-only', async () => {
    for (const path of ['services', 'counters', 'users']) {
      await api().get(`/tenants/${a.slug}/admin/${path}`).expect(401);
      await a.operator.get(`/tenants/${a.slug}/admin/${path}`).expect(403);
      await a.admin.get(`/tenants/${a.slug}/admin/${path}`).expect(200);
      // An admin of tenant A can't manage tenant B.
      await a.admin.get(`/tenants/${b.slug}/admin/${path}`).expect(403);
    }
  });

  it('manages services and reflects them on the customer page', async () => {
    const base = `/tenants/${a.slug}/admin/services`;
    const created = await a.admin
      .post(base)
      .send({
        branchId: a.branchId,
        name: '  Haircut  ',
        ticketPrefix: 'A',
        avgServiceMinutes: 20,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Haircut',
      ticketPrefix: 'A',
      avgServiceMinutes: 20,
      isActive: true,
    });
    const serviceId = created.body.id;

    // Validation and conflicts.
    await a.admin
      .post(base)
      .send({
        branchId: a.branchId,
        name: 'X',
        ticketPrefix: 'a1',
        avgServiceMinutes: 5,
      })
      .expect(400);
    await a.admin
      .post(base)
      .send({
        branchId: a.branchId,
        name: 'Dup',
        ticketPrefix: 'A',
        avgServiceMinutes: 5,
      })
      .expect(409);
    await a.admin
      .post(base)
      .send({
        branchId: b.branchId,
        name: 'Other',
        ticketPrefix: 'B',
        avgServiceMinutes: 5,
      })
      .expect(404);
    await a.admin.patch(`${base}/${serviceId}`).send({}).expect(400);

    const updated = await a.admin
      .patch(`${base}/${serviceId}`)
      .send({ name: 'Potong Rambut', avgServiceMinutes: 25 })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: 'Potong Rambut',
      avgServiceMinutes: 25,
    });

    let overview = await api().get(`/tenants/${a.slug}`).expect(200);
    expect(overview.body.branches[0].services.map((s: any) => s.name)).toEqual([
      'Potong Rambut',
    ]);
    await api()
      .post(`/tenants/${a.slug}/tickets`)
      .send({ serviceId })
      .expect(201);

    // Deactivated: gone for customers, still listed for the admin.
    await a.admin
      .patch(`${base}/${serviceId}`)
      .send({ isActive: false })
      .expect(200);
    overview = await api().get(`/tenants/${a.slug}`).expect(200);
    expect(overview.body.branches[0].services).toEqual([]);
    await api()
      .post(`/tenants/${a.slug}/tickets`)
      .send({ serviceId })
      .expect(404);
    const list = await a.admin.get(base).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].isActive).toBe(false);

    // Tenant B's admin can't touch it through their own tenant.
    await b.admin
      .patch(`/tenants/${b.slug}/admin/services/${serviceId}`)
      .send({ isActive: true })
      .expect(404);
  });

  it('manages counters and protects one that is serving', async () => {
    const services = `/tenants/${a.slug}/admin/services`;
    const counters = `/tenants/${a.slug}/admin/counters`;
    const service = await a.admin
      .post(services)
      .send({
        branchId: a.branchId,
        name: 'Konsultasi',
        ticketPrefix: 'K',
        avgServiceMinutes: 10,
      })
      .expect(201);
    const counter = await a.admin
      .post(counters)
      .send({ branchId: a.branchId, name: 'Loket 1' })
      .expect(201);
    await a.admin
      .post(counters)
      .send({ branchId: a.branchId, name: 'Loket 1' })
      .expect(409);

    const overview = await api().get(`/tenants/${a.slug}`).expect(200);
    expect(overview.body.branches[0].counters.map((c: any) => c.name)).toEqual([
      'Loket 1',
    ]);

    // Call a ticket to the counter, then try to deactivate it.
    await api()
      .post(`/tenants/${a.slug}/tickets`)
      .send({ serviceId: service.body.id })
      .expect(201);
    const called = await a.operator
      .post(`/tenants/${a.slug}/counters/${counter.body.id}/call-next`)
      .send({ serviceId: service.body.id })
      .expect(200);
    await a.admin
      .patch(`${counters}/${counter.body.id}`)
      .send({ isActive: false })
      .expect(409);

    await a.operator
      .post(`/tenants/${a.slug}/tickets/${called.body.ticket.id}/complete`)
      .expect(200);
    await a.admin
      .patch(`${counters}/${counter.body.id}`)
      .send({ name: 'Loket Utama', isActive: false })
      .expect(200);
    await a.operator
      .post(`/tenants/${a.slug}/counters/${counter.body.id}/call-next`)
      .expect(404);
  });

  it('manages staff accounts', async () => {
    const base = `/tenants/${a.slug}/admin/users`;
    const created = await a.admin
      .post(base)
      .send({
        email: 'Siti@Example.com',
        name: 'Siti',
        role: 'operator',
        password: 'first-password',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      email: 'siti@example.com',
      role: 'operator',
      isActive: true,
    });
    expect(created.body.passwordHash).toBeUndefined();

    const list = await a.admin.get(base).expect(200);
    expect(list.body.every((u: any) => u.passwordHash === undefined)).toBe(
      true,
    );

    await a.admin
      .post(base)
      .send({
        email: 'siti@example.com',
        name: 'Siti 2',
        role: 'operator',
        password: 'whatever1',
      })
      .expect(409);
    await a.admin
      .post(base)
      .send({
        email: 'x@example.com',
        name: 'X',
        role: 'operator',
        password: 'short',
      })
      .expect(400);
    await a.admin
      .post(base)
      .send({
        email: 'y@example.com',
        name: 'Y',
        role: 'owner',
        password: 'long-enough',
      })
      .expect(400);

    // The new operator can log in.
    const siti = await loginAgent(a.slug, 'siti@example.com', 'first-password');
    await siti.get(`/tenants/${a.slug}/auth/me`).expect(200);

    // A password reset ends their existing sessions.
    await a.admin
      .patch(`${base}/${created.body.id}`)
      .send({ password: 'second-password' })
      .expect(200);
    await siti.get(`/tenants/${a.slug}/auth/me`).expect(401);
    await api()
      .post(`/tenants/${a.slug}/auth/login`)
      .send({ email: 'siti@example.com', password: 'first-password' })
      .expect(401);
    const siti2 = await loginAgent(
      a.slug,
      'siti@example.com',
      'second-password',
    );

    // Promote, then deactivate.
    const promoted = await a.admin
      .patch(`${base}/${created.body.id}`)
      .send({ role: 'admin' })
      .expect(200);
    expect(promoted.body.role).toBe('admin');
    await siti2.get(`/tenants/${a.slug}/admin/users`).expect(200);
    await a.admin
      .patch(`${base}/${created.body.id}`)
      .send({ isActive: false })
      .expect(200);
    await siti2.get(`/tenants/${a.slug}/auth/me`).expect(401);
  });

  it('stops an admin from locking themselves out', async () => {
    const self = `/tenants/${a.slug}/admin/users/${a.adminId}`;
    await a.admin.patch(self).send({ isActive: false }).expect(400);
    await a.admin.patch(self).send({ role: 'operator' }).expect(400);

    // Changing their own password keeps the current session.
    await a.admin
      .patch(self)
      .send({ password: 'new-admin-password' })
      .expect(200);
    await a.admin.get(`/tenants/${a.slug}/auth/me`).expect(200);
  });
});
