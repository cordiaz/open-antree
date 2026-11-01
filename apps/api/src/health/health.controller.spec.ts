import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../redis/redis.service.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const database = { ping: vi.fn() };
  const redis = { ping: vi.fn() };
  let controller: HealthController;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DatabaseService, useValue: database },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok when database and redis respond', async () => {
    database.ping.mockResolvedValue(undefined);
    redis.ping.mockResolvedValue(undefined);

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('throws 503 naming the dependency that is down', async () => {
    database.ping.mockResolvedValue(undefined);
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await controller.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: 'error',
      checks: { database: 'up', redis: 'down' },
    });
  });
});
