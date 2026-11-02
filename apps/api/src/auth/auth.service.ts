import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { tenants, users } from '../database/schema.js';
import { RedisService } from '../redis/redis.service.js';
import { DUMMY_HASH, verifyPassword } from './password.js';
import { SessionService } from './session.service.js';

export type Role = (typeof users.$inferSelect)['role'];

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenant: { id: string; slug: string; name: string };
};

// Failed logins per account before it is locked for LOCK_SECONDS.
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly sessions: SessionService,
  ) {}

  async login(slug: string, email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const failuresKey = `login-failures:${slug}:${normalizedEmail}`;

    const failures = Number(await this.redis.client.get(failuresKey));
    if (failures >= MAX_FAILURES) {
      throw new HttpException(
        'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [row] = await this.database.db
      .select({ user: users, tenant: tenants })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(tenants.slug, slug), eq(users.email, normalizedEmail)));

    // Always run the hash check so response time doesn't reveal whether the
    // account exists.
    const valid = await verifyPassword(
      password,
      row?.user.passwordHash ?? DUMMY_HASH,
    );
    if (!row || !valid || !row.user.isActive) {
      await this.redis.client
        .multi()
        .incr(failuresKey)
        .expire(failuresKey, LOCK_SECONDS)
        .exec();
      throw new UnauthorizedException('Email atau password salah');
    }

    await this.redis.client.del(failuresKey);
    const token = await this.sessions.create({
      userId: row.user.id,
      tenantId: row.tenant.id,
    });
    return { token, user: toAuthUser(row.user, row.tenant) };
  }

  // Resolves a session token to an active user, or null.
  async userForToken(token: string): Promise<AuthUser | null> {
    const session = await this.sessions.get(token);
    if (!session) {
      return null;
    }
    const [row] = await this.database.db
      .select({ user: users, tenant: tenants })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(
        and(
          eq(users.id, session.userId),
          eq(users.tenantId, session.tenantId),
          eq(users.isActive, true),
        ),
      );
    return row ? toAuthUser(row.user, row.tenant) : null;
  }

  logout(token: string): Promise<void> {
    return this.sessions.destroy(token);
  }
}

function toAuthUser(
  user: typeof users.$inferSelect,
  tenant: typeof tenants.$inferSelect,
): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
  };
}
