import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../redis/redis.service.js';

type CheckStatus = 'up' | 'down';

export type HealthReport = {
  status: 'ok' | 'error';
  checks: {
    database: CheckStatus;
    redis: CheckStatus;
  };
};

@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      toStatus(this.database.ping()),
      toStatus(this.redis.ping()),
    ]);

    const report: HealthReport = {
      status: database === 'up' && redis === 'up' ? 'ok' : 'error',
      checks: { database, redis },
    };

    if (report.status === 'error') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}

async function toStatus(ping: Promise<void>): Promise<CheckStatus> {
  try {
    await ping;
    return 'up';
  } catch {
    return 'down';
  }
}
