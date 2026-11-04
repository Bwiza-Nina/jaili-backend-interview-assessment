export type DomainErrorCode =
  | 'LOAN_NOT_FOUND'
  | 'LOAN_ALREADY_PAID'
  | 'CURRENCY_MISMATCH'
  | 'AMOUNT_EXCEEDS_BALANCE'
  | 'UNKNOWN_TRANSACTION'
  | 'AMOUNT_MISMATCH'
  | 'PAYMENT_NOT_FOUND';

// Business-rule violation. The domain knows nothing about HTTP codes.
export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

// retryable = timeout / network / 5xx / 429
export class ProviderRequestError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}