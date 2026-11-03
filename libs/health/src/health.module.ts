import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

/** `GET /health/live` and `GET /health/ready`, for Kubernetes probes */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
