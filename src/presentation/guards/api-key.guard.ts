import { timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/app.config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const given = Buffer.from(String(req.get('x-api-key') ?? ''));
    const expected = Buffer.from(this.config.internalApiKey);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Missing or invalid API key' });
    }
    return true;
  }
}