import { createHmac, timingSafeEqual } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app.config';
import { SignatureVerifier } from '../../domain/ports';

@Injectable()
export class HmacSignatureVerifier implements SignatureVerifier {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isKnownProvider(provider: unknown): boolean {
    return typeof provider === 'string' && !!this.config.callbackSecrets[provider.toUpperCase()];
  }

  // HMAC-SHA256 (hex) of the RAW request body, sent in the x-signature header
  verify(provider: string, rawBody: Buffer | undefined, signature: string | undefined): boolean {
    const secret = this.config.callbackSecrets[String(provider).toUpperCase()];
    if (!secret || !rawBody || !signature) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const given = Buffer.from(String(signature));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}