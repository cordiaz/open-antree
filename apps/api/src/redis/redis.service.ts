import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    // lazyConnect so the API still boots (and reports "down") when Redis is unavailable.
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });
  }

  async ping(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
    await this.client.ping();
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
