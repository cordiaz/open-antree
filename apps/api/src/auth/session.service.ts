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
    await this.redis.client.set(
      key(token),
      JSON.stringify(session),
      'EX',
      this.ttlSeconds,
    );
    return token;
  }

  async get(token: string): Promise<Session | null> {
    const value = await this.redis.client.get(key(token));
    return value ? (JSON.parse(value) as Session) : null;
  }

  async destroy(token: string): Promise<void> {
    await this.redis.client.del(key(token));
  }
}

function key(token: string): string {
  return `session:${createHash('sha256').update(token).digest('hex')}`;
}
