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
  tenants,
  users,
} from './../src/database/schema.js';

// Integration test against the real PostgreSQL and Redis from docker-compose.yml.

const PASSWORD = 'correct-horse';

type Fixture = { slug: string; tenantId: string; counterId: string };

describe('Auth (e2e, real database)', () => {
  let app: INestApplication<App>;
  let database: DatabaseService;
  let a: Fixture;
  let b: Fixture;

  const api = () => request(app.getHttpServer());
  const login = (slug: string, email: string, password = PASSWORD) =>
    api().post(`/tenants/${slug}/auth/login`).send({ email, password });
  const sessionCookie = (response: request.Response) =>
    ([] as string[])
      .concat(response.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('antree_session='))!;

  async function createTenant(): Promise<Fixture> {
    const db = database.db;
    const slug = `auth-${randomUUID().slice(0, 8)}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ slug, name: 'Auth Test' })
      .returning();
    const [branch] = await db
      .insert(branches)
      .values({ tenantId: tenant.id, name: 'Main' })
      .returning();
    const [counter] = await db
      .insert(counters)
      .values({ tenantId: tenant.id, branchId: branch.id, name: 'Counter 01' })
      .returning();
    const passwordHash = await hashPassword(PASSWORD);
    await db.insert(users).values([
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
    ]);
    return { slug, tenantId: tenant.id, counterId: counter.id };
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

  it('rejects wrong passwords and unknown emails with the same message', async () => {
    const wrong = await login(a.slug, `admin@${a.slug}.test`, 'nope').expect(
      401,
    );
    const unknown = await login(a.slug, `ghost@${a.slug}.test`).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('logs in (email is case-insensitive) with an HttpOnly session cookie', async () => {
    const response = await login(
      a.slug,
      `ADMIN@${a.slug.toUpperCase()}.test`,
    ).expect(200);
    expect(response.body).toMatchObject({
      email: `admin@${a.slug}.test`,
      role: 'admin',
      tenant: { slug: a.slug },
    });
    expect(response.body.passwordHash).toBeUndefined();

    const cookie = sessionCookie(response);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await api()
      .get(`/tenants/${a.slug}/auth/me`)
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.role).toBe('admin');
  });

  it('requires a session for staff endpoints', async () => {
    await api().get(`/tenants/${a.slug}/auth/me`).expect(401);
    await api().get(`/tenants/${a.slug}/counters/${a.counterId}`).expect(401);
    await api()
      .post(`/tenants/${a.slug}/counters/${a.counterId}/call-next`)
      .expect(401);
    await api().get(`/tenants/${a.slug}/stats`).expect(401);
    await api()
      .get(`/tenants/${a.slug}/stats`)
      .set('Cookie', 'antree_session=forged-token')
      .expect(401);
    // Customer endpoints stay public.
    await api().get(`/tenants/${a.slug}/queue`).expect(200);
  });

  it('limits operators to counters and lets admins see stats', async () => {
    const operator = sessionCookie(
      await login(a.slug, `operator@${a.slug}.test`).expect(200),
    );
    const admin = sessionCookie(
      await login(a.slug, `admin@${a.slug}.test`).expect(200),
    );

    await api()
      .get(`/tenants/${a.slug}/counters/${a.counterId}`)
      .set('Cookie', operator)
      .expect(200);
    await api()
      .get(`/tenants/${a.slug}/stats`)
      .set('Cookie', operator)
      .expect(403);
    await api()
      .get(`/tenants/${a.slug}/stats`)
      .set('Cookie', admin)
      .expect(200);
    // Admins can operate counters too.
    await api()
      .get(`/tenants/${a.slug}/counters/${a.counterId}`)
      .set('Cookie', admin)
      .expect(200);
  });

  it('does not accept one tenant’s session on another tenant', async () => {
    const adminA = sessionCookie(
      await login(a.slug, `admin@${a.slug}.test`).expect(200),
    );
    await api()
      .get(`/tenants/${b.slug}/counters/${b.counterId}`)
      .set('Cookie', adminA)
      .expect(403);
    await api()
      .get(`/tenants/${b.slug}/stats`)
      .set('Cookie', adminA)
      .expect(403);
    // Logging in to tenant B with tenant A's account fails.
    await login(b.slug, `admin@${a.slug}.test`).expect(401);
  });

  it('invalidates the session on logout, even if the cookie is replayed', async () => {
    const cookie = sessionCookie(
      await login(a.slug, `operator@${a.slug}.test`).expect(200),
    );
    await api()
      .post(`/tenants/${a.slug}/auth/logout`)
      .set('Cookie', cookie)
      .expect(204);
    await api()
      .get(`/tenants/${a.slug}/auth/me`)
      .set('Cookie', cookie)
      .expect(401);
  });

  it('rejects sessions of deactivated users immediately', async () => {
    const cookie = sessionCookie(
      await login(b.slug, `operator@${b.slug}.test`).expect(200),
    );
    await database.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.email, `operator@${b.slug}.test`));
    await api()
      .get(`/tenants/${b.slug}/auth/me`)
      .set('Cookie', cookie)
      .expect(401);
    await login(b.slug, `operator@${b.slug}.test`).expect(401);
  });

  it('locks an account after 5 failed attempts', async () => {
    const email = `admin@${b.slug}.test`;
    for (let i = 0; i < 5; i++) {
      await login(b.slug, email, 'wrong').expect(401);
    }
    // Even the correct password is refused while locked.
    const locked = await login(b.slug, email).expect(429);
    expect(locked.body.message).toMatch(/15 menit/);
  });
});
