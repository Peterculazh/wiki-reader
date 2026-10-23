import { Module } from '@nestjs/common';
import { IngesterService } from './ingester.service.js';

@Module({
  imports: [],
  providers: [IngesterService],
})
export class IngesterModule {}
