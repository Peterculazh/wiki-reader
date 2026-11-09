import { NestFactory } from '@nestjs/core';
import { ApiModule, configureApi } from './api.module.js';

async function bootstrap() {
  const app = configureApi(await NestFactory.create(ApiModule));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
