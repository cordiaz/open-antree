import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

// Demo data matching the apps/web mockups (tenant "salon-mawar").
// Idempotent: the demo tenant is deleted (cascading to its rows) and recreated.
// Run with `pnpm db:seed`.

const DEMO_SLUG = 'salon-mawar';
const TIMEZONE = 'Asia/Jakarta';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// YYYY-MM-DD in the tenant's timezone.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(
  new Date(),
);
const ticketCode = (prefix: string, number: number) =>
  `${prefix}${String(number).padStart(3, '0')}`;

try {
  await db.transaction(async (tx) => {
    await tx.delete(schema.tenants).where(eq(schema.tenants.slug, DEMO_SLUG));

    const [tenant] = await tx
      .insert(schema.tenants)
      .values({ slug: DEMO_SLUG, name: 'Salon Mawar', timezone: TIMEZONE })
      .returning();
    const tenantId = tenant.id;

    const [branch] = await tx
      .insert(schema.branches)
      .values({ tenantId, name: 'Jakarta' })
      .returning();
    const branchId = branch.id;

    const [haircut, coloring] = await tx
      .insert(schema.services)
      .values([
        {
          tenantId,
          branchId,
          name: 'Haircut',
          ticketPrefix: 'A',
          avgServiceMinutes: 15,
        },
        {
          tenantId,
          branchId,
          name: 'Hair Coloring',
          ticketPrefix: 'B',
          avgServiceMinutes: 60,
        },
        {
          tenantId,
          branchId,
          name: 'Hair Treatment',
          ticketPrefix: 'C',
          avgServiceMinutes: 30,
        },
      ])
      .returning();

    const [counter1, counter2] = await tx
      .insert(schema.counters)
      .values([
        { tenantId, branchId, name: 'Counter 01' },
        { tenantId, branchId, name: 'Counter 02' },
        { tenantId, branchId, name: 'Counter 03' },
      ])
      .returning();

    const base = { tenantId, branchId, serviceDate: today };
    const now = new Date();

    await tx.insert(schema.tickets).values([
      // A001-A021 already served today.
      ...Array.from({ length: 21 }, (_, i) => ({
        ...base,
        serviceId: haircut.id,
        counterId: counter1.id,
        number: i + 1,
        code: ticketCode('A', i + 1),
        status: 'completed' as const,
        completedAt: now,
      })),
      // A022 is being served at Counter 01.
      {
        ...base,
        serviceId: haircut.id,
        counterId: counter1.id,
        number: 22,
        code: ticketCode('A', 22),
        status: 'serving' as const,
        calledAt: now,
        servedAt: now,
      },
      // A023-A026 are waiting.
      ...[23, 24, 25, 26].map((number) => ({
        ...base,
        serviceId: haircut.id,
        number,
        code: ticketCode('A', number),
        status: 'waiting' as const,
      })),
      {
        ...base,
        serviceId: coloring.id,
        counterId: counter2.id,
        number: 1,
        code: ticketCode('B', 1),
        status: 'serving' as const,
        calledAt: now,
        servedAt: now,
      },
    ]);
  });

  console.log(`Seeded demo tenant "${DEMO_SLUG}" for ${today}.`);
} finally {
  await pool.end();
}
