import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hashPassword } from '../auth/password.js';
import { tenants, users } from './schema.js';

// Creates a staff account. The password is read from the USER_PASSWORD
// environment variable so it doesn't end up in shell history:
//   USER_PASSWORD='...' pnpm user:create --tenant salon-mawar \
//     --email budi@example.com --name "Budi" --role operator
const { values } = parseArgs({
  options: {
    tenant: { type: 'string' },
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
  },
});
const password = process.env.USER_PASSWORD;

if (
  !values.tenant ||
  !values.email ||
  !values.name ||
  (values.role !== 'admin' && values.role !== 'operator') ||
  !password
) {
  console.error(
    'Usage: USER_PASSWORD=<password> pnpm user:create --tenant <slug> --email <email> --name <name> --role admin|operator',
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error('USER_PASSWORD must be at least 8 characters.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

try {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, values.tenant));
  if (!tenant) {
    console.error(`Tenant "${values.tenant}" not found.`);
    process.exitCode = 1;
  } else {
    const [user] = await db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email: values.email.trim().toLowerCase(),
        name: values.name,
        passwordHash: await hashPassword(password),
        role: values.role,
      })
      .returning({ id: users.id, email: users.email, role: users.role });
    console.log(`Created ${user.role} ${user.email} for ${tenant.slug}.`);
  }
} catch (error) {
  // 23505 = unique_violation on (tenant_id, email).
  if ((error as { cause?: { code?: string } }).cause?.code === '23505') {
    console.error(`${values.email} already exists for ${values.tenant}.`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await pool.end();
}
