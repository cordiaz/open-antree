import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service.js';

export type Session = {
  userId: string;
  tenantId: string;
};

// Sessions live in Redis under a hash of the token, so a Redis dump does not
// contain usable tokens. Logging out deletes the key immediately.
// Each user also has a set of their session keys, so all of a user's sessions
// can be ended at once (e.g. after a password change).
@Injectable()
export class SessionService {
  readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = Number(config.get('SESSION_TTL_HOURS') ?? 12) * 3600;
  }

  async create(session: Session): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const sessionKey = key(token);
    const userKey = userSessionsKey(session.userId);
    await this.redis.client
      .multi()
      .set(sessionKey, JSON.stringify(session), 'EX', this.ttlSeconds)
      .sadd(userKey, sessionKey)
      .expire(userKey, this.ttlSeconds)
      .exec();
    return token;
  }

  async get(token: string): Promise<Session | null> {
    const value = await this.redis.client.get(key(token));
    return value ? (JSON.parse(value) as Session) : null;
  }

  async destroy(token: string): Promise<void> {
    const session = await this.get(token);
    const sessionKey = key(token);
    const pipeline = this.redis.client.multi().del(sessionKey);
    if (session) {
      pipeline.srem(userSessionsKey(session.userId), sessionKey);
    }
    await pipeline.exec();
  }

  // Ends every session of a user, optionally keeping the one making the request.
  async destroyAllForUser(userId: string, exceptToken?: string): Promise<void> {
    const userKey = userSessionsKey(userId);
    const keep = exceptToken ? key(exceptToken) : null;
    const sessionKeys = (await this.redis.client.smembers(userKey)).filter(
      (k) => k !== keep,
    );
    if (sessionKeys.length > 0) {
      await this.redis.client
        .multi()
        .del(...sessionKeys)
        .srem(userKey, ...sessionKeys)
        .exec();
    }
  }
}

function key(token: string): string {
  return `session:${createHash('sha256').update(token).digest('hex')}`;
}

function userSessionsKey(userId: string): string {
  return `user-sessions:${userId}`;
}
