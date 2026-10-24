import { Module } from '@nestjs/common';
import { ArchiverService } from './archiver.service.js';

@Module({
  imports: [],
  providers: [ArchiverService],
})
export class ArchiverModule {}
