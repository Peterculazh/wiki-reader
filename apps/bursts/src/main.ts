import { NestFactory } from '@nestjs/core';
import { BurstsModule } from './bursts.module.js';

async function bootstrap() {
  const app = await NestFactory.create(BurstsModule);
  app.enableShutdownHooks();
  await app.listen(process.env.port ?? 3000);
}
await bootstrap();
