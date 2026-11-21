import { NestFactory } from '@nestjs/core';
import { StatsModule } from './stats.module.js';
import { ValidationPipe } from '@nestjs/common';
import { configureApp } from './configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create(StatsModule);
  app.enableShutdownHooks();
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
