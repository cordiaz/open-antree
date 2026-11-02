import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { hashPassword } from './../src/auth/password.js';
import { DatabaseService } from './../src/database/database.service.js';
import {
  branches,
  counters,
  services,
  tenants,
  users,
} from './../src/database/schema.js';
import { RedisService } from './../src/redis/redis.service.js';

// Integration test against the real PostgreSQL and Redis. Two API instances
// run side by side to prove events cross instances through Redis pub/sub.

const PASSWORD = 'events-password';

type Fixture = {
  slug: string;
  tenantId: string;
  branchId: string;
  serviceId: string;
  counterId: string;
};

type Stream = {
  status: number;
  contentType: string | null;
  events: { type: string; ticketId?: string; branchId?: string }[];
  ended: boolean;
  close: () => void;
};

describe('Realtime events (e2e, real Redis)', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let urlA: string;
  let database: DatabaseService;
  let redis: RedisService;
  let main: Fixture;
  let other: Fixture;

  async function startApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0);
    return app;
  }

  async function createTenant(): Promise<Fixture> {
    const db = database.db;
    const slug = `events-${randomUUID().slice(0, 8)}`;
    const [tenant] = await db
      .insert(tenants)
      .values({ slug, name: 'Events Test' })
      .returning();
    const [branch] = await db
      .insert(branches)
      .values({ tenantId: tenant.id, name: 'Main' })
      .returning();
    const [service] = await db
      .insert(services)
      .values({
        tenantId: tenant.id,
        branchId: branch.id,
        name: 'Haircut',
        ticketPrefix: 'A',
      })
      .returning();
    const [counter] = await db
      .insert(counters)
      .values({ tenantId: tenant.id, branchId: branch.id, name: 'Counter 01' })
      .returning();
    await db.insert(users).values({
      tenantId: tenant.id,
      email: `admin@${slug}.test`,
      name: 'Admin',
      passwordHash: await hashPassword(PASSWORD),
      role: 'admin',
    });
    return {
      slug,
      tenantId: tenant.id,
      branchId: branch.id,
      serviceId: service.id,
      counterId: counter.id,
    };
  }

  // Reads the SSE stream in the background and collects `queue` events.
  async function openStream(slug: string, baseUrl = urlA): Promise<Stream> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/tenants/${slug}/events`, {
      signal: controller.signal,
    });
    const stream: Stream = {
      status: response.status,
      contentType: response.headers.get('content-type'),
      events: [],
      ended: false,
      close: () => controller.abort(),
    };
    if (!response.ok || !response.body) {
      return stream;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            stream.ended = true;
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = block
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (block.startsWith('event: queue') && data) {
              stream.events.push(JSON.parse(data.slice(6)));
            }
          }
        }
      } catch {
        // Aborted by close().
      }
    })();
    return stream;
  }

  const subscribers = async (tenantId: string) => {
    const [, count] = (await redis.client.pubsub(
      'NUMSUB',
      `queue-events:${tenantId}`,
    )) as [string, number];
    return Number(count);
  };

  async function waitFor(check: () => boolean | Promise<boolean>, ms = 3000) {
    const deadline = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error('Timed out waiting');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  beforeAll(async () => {
    appA = await startApp();
    appB = await startApp();
    urlA = `http://127.0.0.1:${(appA.getHttpServer().address() as AddressInfo).port}`;
    database = appA.get(DatabaseService);
    redis = appA.get(RedisService);
    main = await createTenant();
    other = await createTenant();
  });

  afterAll(async () => {
    for (const f of [main, other].filter(Boolean)) {
      await database.db.delete(tenants).where(eq(tenants.id, f.tenantId));
    }
    await appA.close();
    await appB.close();
  });

  it('returns 404 for an unknown tenant', async () => {
    const stream = await openStream('does-not-exist');
    expect(stream.status).toBe(404);
  });

  it('delivers changes made on another instance, and only to that tenant', async () => {
    const mainStream = await openStream(main.slug);
    const otherStream = await openStream(other.slug);
    expect(mainStream.status).toBe(200);
    expect(mainStream.contentType).toMatch(/text\/event-stream/);
    // Make sure both channels are subscribed before changing anything.
    await waitFor(async () => (await subscribers(main.tenantId)) >= 1);
    await waitFor(async () => (await subscribers(other.tenantId)) >= 1);

    // All changes go through instance B; the streams are on instance A.
    const b = () => request(appB.getHttpServer());
    const created = await b()
      .post(`/tenants/${main.slug}/tickets`)
      .send({ serviceId: main.serviceId })
      .expect(201);
    await waitFor(() =>
      mainStream.events.some(
        (e) => e.type === 'ticket.created' && e.ticketId === created.body.id,
      ),
    );

    const admin = request.agent(appB.getHttpServer());
    await admin
      .post(`/tenants/${main.slug}/auth/login`)
      .send({ email: `admin@${main.slug}.test`, password: PASSWORD })
      .expect(200);
    await admin
      .post(`/tenants/${main.slug}/counters/${main.counterId}/call-next`)
      .expect(200);
    await admin
      .post(`/tenants/${main.slug}/tickets/${created.body.id}/complete`)
      .expect(200);
    await admin
      .patch(`/tenants/${main.slug}/admin/services/${main.serviceId}`)
      .send({ avgServiceMinutes: 20 })
      .expect(200);

    await waitFor(() => mainStream.events.length >= 4);
    expect(mainStream.events.map((e) => e.type)).toEqual([
      'ticket.created',
      'ticket.called',
      'ticket.updated',
      'config.updated',
    ]);
    expect(mainStream.events.every((e) => e.branchId === main.branchId)).toBe(
      true,
    );
    // Events carry ids only, never customer data.
    expect(Object.keys(mainStream.events[0]).sort()).toEqual([
      'at',
      'branchId',
      'ticketId',
      'type',
    ]);

    // The other tenant's stream saw none of it.
    expect(otherStream.events).toEqual([]);

    mainStream.close();
    otherStream.close();
  });

  it('releases the Redis subscription when the last client disconnects', async () => {
    const first = await openStream(main.slug);
    const second = await openStream(main.slug);
    await waitFor(async () => (await subscribers(main.tenantId)) === 1);

    // One Redis subscription per process, however many browsers are connected.
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await subscribers(main.tenantId)).toBe(1);

    second.close();
    await waitFor(async () => (await subscribers(main.tenantId)) === 0);
  });

  it('ends open streams on shutdown instead of hanging the process', async () => {
    const app = await startApp();
    const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const stream = await openStream(main.slug, url);
    await waitFor(async () => (await subscribers(main.tenantId)) >= 1);

    // Without closing streams first, close() waits for clients to leave.
    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(2000);
    await waitFor(() => stream.ended);
  });
});
