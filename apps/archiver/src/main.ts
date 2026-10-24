import { NestFactory } from '@nestjs/core';
import { ArchiverModule } from './archiver.module.js';

async function bootstrap() {
  const app = await NestFactory.create(ArchiverModule);
  await app.listen(process.env.port ?? 3000);
}
await bootstrap();
