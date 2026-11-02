import { NestFactory } from '@nestjs/core';
import { IngesterModule } from './ingester.module.js';

async function bootstrap() {
  const app = await NestFactory.create(IngesterModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
