import { NestFactory } from '@nestjs/core';
import { ArchiverModule } from './archiver.module.js';

async function bootstrap() {
  const app = await NestFactory.create(ArchiverModule);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
