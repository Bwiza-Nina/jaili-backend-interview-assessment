import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HEALTH_CHECK, HealthCheck } from '../../domain/ports';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_CHECK) private readonly health: HealthCheck) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + database check' })
  async check() {
    if (!(await this.health.ping())) {
      throw new ServiceUnavailableException({ code: 'DB_UNAVAILABLE', message: 'Database unavailable' });
    }
    return { status: 'ok' };
  }
}