import {
  BadRequestException, CanActivate, ExecutionContext, Inject, Injectable, RawBodyRequest, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SIGNATURE_VERIFIER, SignatureVerifier } from '../../domain/ports';

// Runs BEFORE validation: authenticity of the callback is checked on the RAW body
@Injectable()
export class CallbackSignatureGuard implements CanActivate {
  constructor(@Inject(SIGNATURE_VERIFIER) private readonly verifier: SignatureVerifier) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const provider = req.body?.provider;
    if (!this.verifier.isKnownProvider(provider)) {
      throw new BadRequestException({ code: 'INVALID_PROVIDER', message: 'provider must be MTN or AIRTEL' });
    }
    if (!this.verifier.verify(provider, req.rawBody, req.get('x-signature'))) {
      throw new UnauthorizedException({ code: 'INVALID_SIGNATURE', message: 'Signature verification failed' });
    }
    return true;
  }
}