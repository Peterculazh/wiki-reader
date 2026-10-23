import { NestFactory } from '@nestjs/core';
import { IngesterModule } from './ingester.module.js';

async function bootstrap() {
  const app = await NestFactory.create(IngesterModule);
  await app.listen(process.env.port ?? 3000);
}
await bootstrap();
