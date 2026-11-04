import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app.config';
import { PaymentStatus, Provider } from '../../domain/enums';
import { PaymentGateway, PaymentRequest, ProviderStatus } from '../../domain/ports';
import { callProvider } from './http-client';

@Injectable()
export class AirtelGateway implements PaymentGateway {
  readonly provider = Provider.AIRTEL;
  private token: { value: string | null; exp: number } = { value: null, exp: 0 };

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get c() { return this.config.providers.airtel; }

  private async getToken(): Promise<string> {
    if (this.token.value && Date.now() < this.token.exp - 30000) return this.token.value;
    const { data } = await callProvider(`${this.c.baseUrl}/auth/oauth2/token`, {
      method: 'POST',
      body: { client_id: this.c.clientId, client_secret: this.c.clientSecret, grant_type: 'client_credentials' },
    });
    this.token = { value: data.access_token, exp: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return this.token.value;
  }

  async requestPayment(r: PaymentRequest) {
    if (this.config.providers.mock) return { providerReference: `MOCK-${r.transactionId}` };
    const token = await this.getToken();
    await callProvider(`${this.c.baseUrl}/merchant/v1/payments/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Country': this.c.country, 'X-Currency': r.currency },
      body: {
        reference: 'Loan repayment',
        subscriber: { country: this.c.country, currency: r.currency, msisdn: r.msisdn.replace('+', '') },
        transaction: { amount: Number(r.amount), country: this.c.country, currency: r.currency, id: r.transactionId },
      },
    });
    return { providerReference: r.transactionId };
  }

  async getStatus(transactionId: string): Promise<ProviderStatus> {
    if (this.config.providers.mock) return { status: PaymentStatus.PENDING };
    const token = await this.getToken();
    const { data } = await callProvider(`${this.c.baseUrl}/standard/v1/payments/${transactionId}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Country': this.c.country, 'X-Currency': 'RWF' },
    });
    const code = data?.data?.transaction?.status; // TS = success, TF = failed, else in progress
    return { status: code === 'TS' ? PaymentStatus.SUCCESS : code === 'TF' ? PaymentStatus.FAILED : PaymentStatus.PENDING };
  }
}