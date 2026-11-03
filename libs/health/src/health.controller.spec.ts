import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from './health.module.js';

describe('HealthModule', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(['/health/live', '/health/ready'])(
    '%s answers 200 ok',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path).expect(200);
      expect(res.body.status).toBe('ok');
    },
  );
});
