import { LedgerEntry, Loan, Payment } from '../domain/entities';
import { fromCents } from '../domain/money';

export const toPaymentView = (p: Payment) => ({
  id: p.id,
  loanId: p.loanId,
  provider: p.provider,
  transactionId: p.transactionId,
  providerReference: p.providerReference,
  amount: fromCents(p.amountCents),
  currency: p.currency,
  status: p.status,
  failureReason: p.failureReason,
  attempts: p.attempts,
  createdAt: p.createdAt,
  appliedAt: p.appliedAt,
});

export const toLoanView = (l: Loan) => ({
  id: l.id,
  borrowerName: l.borrowerName,
  currency: l.currency,
  principal: fromCents(l.principalCents),
  balance: fromCents(l.balanceCents),
  pendingAmount: fromCents(l.pendingCents),
  status: l.status,
});

export const toLedgerView = (e: LedgerEntry) => ({
  paymentId: e.paymentId,
  amount: fromCents(e.amountCents),
  balanceBefore: fromCents(e.balanceBeforeCents),
  balanceAfter: fromCents(e.balanceAfterCents),
  createdAt: e.createdAt,
});