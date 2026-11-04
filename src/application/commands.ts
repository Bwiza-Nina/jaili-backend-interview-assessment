import { PaymentStatus, Provider } from '../domain/enums';

export interface InitiatePaymentCommand {
  loanId: number;
  provider: Provider;
  msisdn: string;
  amountCents: number;
  currency: string;
}

export interface ApplyStatusCommand {
  provider: Provider;
  transactionId: string;
  status: PaymentStatus;
  amountCents?: number;
  currency?: string;
  timestamp?: string;
  reason?: string;
}

export interface ApplyResult {
  result: 'APPLIED' | 'DUPLICATE' | 'IGNORED' | 'NOOP';
  status: PaymentStatus;
}

export type Dispatch = 'SENT' | 'REJECTED' | 'UNCERTAIN';