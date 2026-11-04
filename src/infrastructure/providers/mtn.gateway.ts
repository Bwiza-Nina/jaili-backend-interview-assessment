import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/app.config';
import { PaymentStatus, Provider } from '../../domain/enums';
import { PaymentGateway, PaymentRequest, ProviderStatus } from '../../domain/ports';
import { callProvider } from './http-client';

@Injectable()
export class MtnGateway implements PaymentGateway {
  readonly provider = Provider.MTN;
  private token: { value: string | null; exp: number } = { value: null, exp: 0 };

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private get c() { return this.config.providers.mtn; }

  private async getToken(): Promise<string> {
    if (this.token.value && Date.now() < this.token.exp - 30000) return this.token.value;
    const basic = Buffer.from(`${this.c.apiUser}:${this.c.apiKey}`).toString('base64');
    const { data } = await callProvider(`${this.c.baseUrl}/collection/token/`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Ocp-Apim-Subscription-Key': this.c.subscriptionKey },
    });
    this.token = { value: data.access_token, exp: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return this.token.value;
  }

  // transactionId is a UUID and doubles as MTN's X-Reference-Id (idempotency key)
  async requestPayment(r: PaymentRequest) {
    if (this.config.providers.mock) return { providerReference: `MOCK-${r.transactionId}` };
    const token = await this.getToken();
    await callProvider(`${this.c.baseUrl}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Reference-Id': r.transactionId,
        'X-Target-Environment': this.c.targetEnv,
        'X-Callback-Url': `${this.config.providers.callbackBase}/api/callbacks/payments`,
        'Ocp-Apim-Subscription-Key': this.c.subscriptionKey,
      },
      body: {
        amount: r.amount,
        currency: r.currency,
        externalId: r.transactionId,
        payer: { partyIdType: 'MSISDN', partyId: r.msisdn.replace('+', '') },
        payerMessage: 'Loan repayment',
        payeeNote: 'Loan repayment',
      },
    });
    return { providerReference: r.transactionId };
  }

  async getStatus(transactionId: string, _currency: string): Promise<ProviderStatus> {
    if (this.config.providers.mock) return { status: PaymentStatus.PENDING };
    const token = await this.getToken();
    const { data } = await callProvider(`${this.c.baseUrl}/collection/v1_0/requesttopay/${transactionId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Target-Environment': this.c.targetEnv,
        'Ocp-Apim-Subscription-Key': this.c.subscriptionKey,
      },
    });
    const status = data.status === 'SUCCESSFUL' ? PaymentStatus.SUCCESS
      : data.status === 'FAILED' ? PaymentStatus.FAILED : PaymentStatus.PENDING;
    return { status, reason: typeof data.reason === 'string' ? data.reason : data.reason?.message };
  }
}