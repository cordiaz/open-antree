import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hashPassword } from '../auth/password.js';
import * as schema from './schema.js';

// Demo data matching the apps/web mockups (tenant "salon-mawar").
// Idempotent: the demo tenant is deleted (cascading to its rows) and recreated.
// Run with `pnpm db:seed`.

const DEMO_SLUG = 'salon-mawar';
// Development only. Override with SEED_PASSWORD.
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'antree-demo';
const TIMEZONE = 'Asia/Jakarta';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

// YYYY-MM-DD in the tenant's timezone.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(
  new Date(),
);
const ticketCode = (prefix: string, number: number) =>
  `${prefix}${String(number).padStart(3, '0')}`;

// Days of finished history before today, for the reports page.
const HISTORY_DAYS = 13;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
// Asia/Jakarta has no daylight saving time, so its offset is fixed.
const localTime = (date: string, minuteOfDay: number) =>
  new Date(Date.parse(`${date}T00:00:00+07:00`) + minuteOfDay * 60_000);
// Small deterministic PRNG so every seed produces the same history.
let state = 20_260_101;
const random = () => {
  state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
  return state / 2 ** 31;
};
const between = (min: number, max: number) =>
  Math.round(min + random() * (max - min));

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

    const [haircut, coloring, treatment] = await tx
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

    const [counter1, counter2, counter3] = await tx
      .insert(schema.counters)
      .values([
        { tenantId, branchId, name: 'Counter 01' },
        { tenantId, branchId, name: 'Counter 02' },
        { tenantId, branchId, name: 'Counter 03' },
      ])
      .returning();

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await tx.insert(schema.users).values([
      {
        tenantId,
        email: 'admin@salon-mawar.test',
        name: 'Admin Salon Mawar',
        passwordHash,
        role: 'admin',
      },
      {
        tenantId,
        email: 'operator@salon-mawar.test',
        name: 'Operator Salon Mawar',
        passwordHash,
        role: 'operator',
      },
    ]);

    // Finished days: busier on weekends and around 11:00 and 16:00, a few
    // no-shows (skipped) and the odd ticket left waiting at closing time.
    const plans = [
      {
        service: haircut,
        perDay: [16, 26],
        counters: [counter1.id, counter3.id],
      },
      { service: coloring, perDay: [3, 7], counters: [counter2.id] },
      {
        service: treatment,
        perDay: [4, 9],
        counters: [counter3.id, counter2.id],
      },
    ];
    const history: (typeof schema.tickets.$inferInsert)[] = [];
    for (let back = HISTORY_DAYS; back >= 1; back--) {
      const date = addDays(today, -back);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const busy = weekday === 0 || weekday === 6 ? 1.4 : 1;
      for (const { service, perDay, counters: serviceCounters } of plans) {
        const count = Math.round(between(perDay[0], perDay[1]) * busy);
        // Opening hours 09:00-18:00, arrivals bunched around the peaks.
        const arrivals = Array.from({ length: count }, () => {
          const peak = random() < 0.5 ? 11 * 60 : 16 * 60;
          const spread = (random() + random() + random() - 1.5) * 150;
          return Math.min(18 * 60 - 1, Math.max(9 * 60, peak + spread));
        }).sort((a, b) => a - b);
        arrivals.forEach((arrival, i) => {
          const peakHour =
            Math.abs(arrival - 11 * 60) < 60 ||
            Math.abs(arrival - 16 * 60) < 60;
          const wait = between(3, peakHour ? 28 : 14);
          const length = Math.max(
            5,
            Math.round(service.avgServiceMinutes * (0.7 + random() * 0.6)),
          );
          const roll = random();
          const ticket = {
            tenantId,
            branchId,
            serviceId: service.id,
            serviceDate: date,
            number: i + 1,
            code: ticketCode(service.ticketPrefix, i + 1),
            createdAt: localTime(date, arrival),
          };
          if (i === count - 1 && roll < 0.15) {
            history.push({ ...ticket, status: 'waiting' });
            return;
          }
          const counterId =
            serviceCounters[random() < 0.75 ? 0 : serviceCounters.length - 1];
          const calledAt = localTime(date, arrival + wait);
          if (roll > 0.92) {
            history.push({
              ...ticket,
              counterId,
              status: 'skipped',
              calledAt,
              completedAt: localTime(date, arrival + wait + 3),
            });
            return;
          }
          history.push({
            ...ticket,
            counterId,
            status: 'completed',
            calledAt,
            servedAt: localTime(date, arrival + wait + 1),
            completedAt: localTime(date, arrival + wait + 1 + length),
          });
        });
      }
    }
    await tx.insert(schema.tickets).values(history);

    const base = { tenantId, branchId, serviceDate: today };
    // Spread timestamps over the past few hours so the dashboard's average
    // wait looks realistic; creation order matches ticket numbers.
    const minutesAgo = (minutes: number) =>
      new Date(Date.now() - minutes * 60_000);

    await tx.insert(schema.tickets).values([
      // A001-A021 already served today, each called ~12 minutes after taking it.
      ...Array.from({ length: 21 }, (_, i) => {
        const created = (21 - i) * 6 + 44;
        return {
          ...base,
          serviceId: haircut.id,
          counterId: counter1.id,
          number: i + 1,
          code: ticketCode('A', i + 1),
          status: 'completed' as const,
          createdAt: minutesAgo(created),
          calledAt: minutesAgo(created - 12),
          servedAt: minutesAgo(created - 12),
          completedAt: minutesAgo(created - 18),
        };
      }),
      // A022 is being served at Counter 01.
      {
        ...base,
        serviceId: haircut.id,
        counterId: counter1.id,
        number: 22,
        code: ticketCode('A', 22),
        status: 'serving' as const,
        createdAt: minutesAgo(44),
        calledAt: minutesAgo(30),
        servedAt: minutesAgo(30),
      },
      // A023-A026 are waiting.
      ...[23, 24, 25, 26].map((number) => ({
        ...base,
        serviceId: haircut.id,
        number,
        code: ticketCode('A', number),
        status: 'waiting' as const,
        createdAt: minutesAgo((27 - number) * 5),
      })),
      {
        ...base,
        serviceId: coloring.id,
        counterId: counter2.id,
        number: 1,
        code: ticketCode('B', 1),
        status: 'serving' as const,
        createdAt: minutesAgo(40),
        calledAt: minutesAgo(25),
        servedAt: minutesAgo(25),
      },
    ]);
  });

  console.log(
    `Seeded demo tenant "${DEMO_SLUG}" for ${today} with ${HISTORY_DAYS} days of history.`,
  );
  console.log(
    'Logins: admin@salon-mawar.test / operator@salon-mawar.test' +
      (process.env.SEED_PASSWORD ? '' : ` (password: ${DEMO_PASSWORD})`),
  );
} finally {
  await pool.end();
}
