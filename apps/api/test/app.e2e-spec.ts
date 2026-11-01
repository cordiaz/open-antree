import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { DatabaseService } from './../src/database/database.service.js';
import { RedisService } from './../src/redis/redis.service.js';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
    process.env.REDIS_URL ??= 'redis://localhost:6379';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseService)
      .useValue({ ping: () => Promise.resolve() })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve() })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  afterEach(async () => {
    await app.close();
  });
});
