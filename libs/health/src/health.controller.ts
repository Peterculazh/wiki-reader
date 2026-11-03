import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  /** The process is up and its event loop answers. A failure restarts the pod. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /**
   * Same as `live`, on purpose. Readiness decides whether a Service sends a pod
   * traffic, and nothing sends these apps traffic: they pull from Kafka. Nest
   * only starts listening once every onModuleInit is done (clients connected,
   * subscriptions running), so answering at all already means "started". A
   * broker check here would only mark every pod unready during a Kafka outage,
   * which the clients ride out by reconnecting anyway.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([]);
  }
}
