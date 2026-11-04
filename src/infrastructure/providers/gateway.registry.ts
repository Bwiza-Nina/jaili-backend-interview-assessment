import { Injectable } from '@nestjs/common';
import { Provider } from '../../domain/enums';
import { PaymentGateway, PaymentGatewayResolver } from '../../domain/ports';
import { AirtelGateway } from './airtel.gateway';
import { MtnGateway } from './mtn.gateway';

@Injectable()
export class GatewayRegistry implements PaymentGatewayResolver {
  private readonly map: Record<Provider, PaymentGateway>;

  constructor(mtn: MtnGateway, airtel: AirtelGateway) {
    this.map = { [Provider.MTN]: mtn, [Provider.AIRTEL]: airtel };
  }

  resolve(provider: Provider): PaymentGateway {
    return this.map[provider];
  }
}