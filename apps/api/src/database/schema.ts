import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Every tenant-owned table carries tenant_id so queries can always be scoped
// to one tenant without joining up the hierarchy.

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable('tenants', {
  id: id(),
  // Used in public URLs, e.g. /salon-mawar/queue.
  slug: varchar('slug', { length: 63 }).notNull().unique(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Jakarta'),
  createdAt: createdAt(),
});

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('branches_tenant_id_idx').on(t.tenantId)],
);

export const services = pgTable(
  'services',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Prefix for ticket codes, e.g. "A" -> A001, A002, ...
    ticketPrefix: varchar('ticket_prefix', { length: 4 }).notNull(),
    // Used to estimate waiting time.
    avgServiceMinutes: integer('avg_service_minutes').notNull().default(15),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('services_tenant_id_idx').on(t.tenantId),
    uniqueIndex('services_branch_prefix_uq').on(t.branchId, t.ticketPrefix),
  ],
);

export const counters = pgTable(
  'counters',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('counters_tenant_id_idx').on(t.tenantId),
    uniqueIndex('counters_branch_name_uq').on(t.branchId, t.name),
  ],
);

export const ticketStatus = pgEnum('ticket_status', [
  'waiting',
  'called',
  'serving',
  'completed',
  'skipped',
  'cancelled',
]);

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    counterId: uuid('counter_id').references(() => counters.id, {
      onDelete: 'set null',
    }),
    // Numbering restarts every day per service; serviceDate is in the tenant's timezone.
    serviceDate: date('service_date').notNull(),
    number: integer('number').notNull(),
    // Display code, e.g. "A023".
    code: varchar('code', { length: 16 }).notNull(),
    status: ticketStatus('status').notNull().default('waiting'),
    customerName: text('customer_name'),
    customerPhone: varchar('customer_phone', { length: 32 }),
    createdAt: createdAt(),
    calledAt: timestamp('called_at', { withTimezone: true }),
    servedAt: timestamp('served_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tickets_service_date_number_uq').on(
      t.serviceId,
      t.serviceDate,
      t.number,
    ),
    // Operator queue: waiting tickets of a branch for today, oldest first.
    index('tickets_branch_date_status_idx').on(
      t.branchId,
      t.serviceDate,
      t.status,
    ),
    index('tickets_tenant_id_idx').on(t.tenantId),
  ],
);

export const userRole = pgEnum('user_role', ['admin', 'operator']);

// Staff accounts. Customers don't log in.
export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Stored lower-cased; unique within a tenant.
    email: varchar('email', { length: 254 }).notNull(),
    name: text('name').notNull(),
    // scrypt hash, see src/auth/password.ts.
    passwordHash: text('password_hash').notNull(),
    role: userRole('role').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email)],
);
