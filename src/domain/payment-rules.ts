import { PaymentStatus } from './enums';

export type Settlement = 'NOOP' | 'DUPLICATE' | 'IGNORED' | 'APPLY';

/**
 * Decides what to do with an incoming status.
 *  - PENDING callback            -> nothing to do
 *  - same status again           -> duplicate (2nd/3rd identical callback)
 *  - already SUCCESS + FAILED    -> ignore: a success is NEVER downgraded
 *  - otherwise                   -> apply the change
 */
export function decideSettlement(current: PaymentStatus, incoming: PaymentStatus): Settlement {
  if (incoming === PaymentStatus.PENDING) return 'NOOP';
  if (current === incoming) return 'DUPLICATE';
  if (current === PaymentStatus.SUCCESS) return 'IGNORED';
  return 'APPLY';
}

// Balance can never go below zero; an overpayment is not applied
export function settleAgainstBalance(balanceCents: number, paymentCents: number) {
  const appliedCents = Math.min(paymentCents, balanceCents);
  return { appliedCents, balanceAfterCents: balanceCents - appliedCents };
}

export function releasePending(pendingCents: number, paymentCents: number): number {
  return Math.max(pendingCents - paymentCents, 0);
}