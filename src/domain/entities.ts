import { LoanStatus, PaymentStatus, Provider } from './enums';

// All money inside the domain is INTEGER CENTS (no floating-point errors)
export interface Loan {
  id: number;
  borrowerName: string;
  currency: string;
  principalCents: number;
  balanceCents: number;
  pendingCents: number; // reserved by in-flight payments
  status: LoanStatus;
}

export interface Payment {
  id: number;
  loanId: number;
  provider: Provider;
  transactionId: string;
  providerReference: string | null;
  msisdn: string | null;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  failureReason: string | null;
  attempts: number;
  createdAt: Date;
  appliedAt: Date | null;
}

export interface NewPayment {
  loanId: number;
  provider: Provider;
  transactionId: string;
  msisdn: string;
  amountCents: number;
  currency: string;
}

export interface LedgerEntry {
  paymentId: number;
  loanId: number;
  amountCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  createdAt?: Date;
}