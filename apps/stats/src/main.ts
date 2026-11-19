import { NestFactory } from '@nestjs/core';
import { StatsModule } from './stats.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(StatsModule);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
