import { NestFactory } from '@nestjs/core';
import { LiveModule, configureLive } from './live.module.js';

async function bootstrap() {
  const app = configureLive(await NestFactory.create(LiveModule));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
