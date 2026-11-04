import { Loan, LedgerEntry, NewPayment, Payment } from './entities';
import { PaymentStatus, Provider, LoanStatus } from './enums';

export const UNIT_OF_WORK = 'UNIT_OF_WORK';
export const LOAN_REPOSITORY = 'LOAN_REPOSITORY';
export const PAYMENT_REPOSITORY = 'PAYMENT_REPOSITORY';
export const LEDGER_REPOSITORY = 'LEDGER_REPOSITORY';
export const CALLBACK_EVENT_REPOSITORY = 'CALLBACK_EVENT_REPOSITORY';
export const PAYMENT_GATEWAYS = 'PAYMENT_GATEWAYS';
export const SIGNATURE_VERIFIER = 'SIGNATURE_VERIFIER';
export const HEALTH_CHECK = 'HEALTH_CHECK';

export interface LoanRepository {
  findById(id: number): Promise<Loan | null>;
  lockById(id: number): Promise<Loan | null>; // SELECT ... FOR UPDATE (inside a transaction)
  addPending(id: number, cents: number): Promise<void>;
  saveBalances(id: number, b: { balanceCents: number; pendingCents: number; status: LoanStatus }): Promise<void>;
}

export interface PaymentFilter { loanId?: number; status?: PaymentStatus; limit: number; offset: number }

export interface PaymentRepository {
  insert(p: NewPayment): Promise<number>;
  lockByProviderTxn(provider: Provider, transactionId: string): Promise<Payment | null>;
  markSuccess(id: number, providerTs: Date | null): Promise<void>;
  markFailed(id: number, reason: string, providerTs: Date | null): Promise<void>;
  recordDispatch(provider: Provider, transactionId: string, providerReference: string | null): Promise<void>;
  findStalePending(olderThanMinutes: number, limit: number): Promise<{ provider: Provider; transactionId: string; currency: string }[]>;
  findById(id: number): Promise<Payment | null>;
  list(f: PaymentFilter): Promise<{ data: Payment[]; total: number }>;
}

export interface LedgerRepository {
  insert(e: LedgerEntry): Promise<void>;
  listByLoan(loanId: number, limit: number): Promise<LedgerEntry[]>;
}

export interface LoanEventRepository {
  add(e: { loanId: number; paymentId: number | null; type: string; note?: string | null }): Promise<void>;
}

export interface StoredCallbackEvent { id: number; payload: any }

export interface CallbackEventRepository {
  insert(provider: string, transactionId: string, payloadJson: string): Promise<number>;
  mark(id: number, outcome: string, processed: boolean, error?: string | null): Promise<void>;
  findReprocessable(limit: number): Promise<StoredCallbackEvent[]>;
}

// Everything that must succeed or fail TOGETHER
export interface TxContext {
  loans: LoanRepository;
  payments: PaymentRepository;
  ledger: LedgerRepository;
  events: LoanEventRepository;
}

export interface UnitOfWork {
  run<T>(work: (tx: TxContext) => Promise<T>): Promise<T>;
}

export interface PaymentRequest { transactionId: string; amount: string; currency: string; msisdn: string }
export interface ProviderStatus { status: PaymentStatus; reason?: string }

export interface PaymentGateway {
  readonly provider: Provider;
  requestPayment(r: PaymentRequest): Promise<{ providerReference: string }>;
  getStatus(transactionId: string, currency: string): Promise<ProviderStatus>;
}

export interface PaymentGatewayResolver {
  resolve(provider: Provider): PaymentGateway;
}

export interface SignatureVerifier {
  isKnownProvider(provider: unknown): boolean;
  verify(provider: string, rawBody: Buffer | undefined, signature: string | undefined): boolean;
}

export interface HealthCheck { ping(): Promise<boolean> }