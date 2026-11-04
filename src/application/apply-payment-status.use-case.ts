import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app.config';
import { DomainError } from '../domain/errors';
import { LoanStatus, PaymentStatus } from '../domain/enums';
import { fromCents } from '../domain/money';
import { decideSettlement, releasePending, settleAgainstBalance } from '../domain/payment-rules';
import { UNIT_OF_WORK, UnitOfWork } from '../domain/ports';
import { ApplyResult, ApplyStatusCommand } from './commands';

/**
 * Used by callbacks, reconciliation and reprocessing.
 * IDEMPOTENT: calling it 1 or 100 times with the same input has the same effect.
 */
@Injectable()
export class ApplyPaymentStatusUseCase {
  private readonly logger = new Logger(ApplyPaymentStatusUseCase.name);
  private chaosUsed = false;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  execute(cmd: ApplyStatusCommand): Promise<ApplyResult> {
    return this.uow.run(async (tx) => {
      // Lock order is ALWAYS payment -> loan (prevents deadlocks)
      const payment = await tx.payments.lockByProviderTxn(cmd.provider, cmd.transactionId);
      if (!payment) {
        throw new DomainError('UNKNOWN_TRANSACTION', 'No payment request exists for this transaction');
      }
      if (
        (cmd.amountCents !== undefined && cmd.amountCents !== payment.amountCents) ||
        (cmd.currency !== undefined && cmd.currency !== payment.currency)
      ) {
        throw new DomainError('AMOUNT_MISMATCH', 'Callback amount/currency does not match the original request');
      }

      const decision = decideSettlement(payment.status, cmd.status);
      if (decision === 'NOOP' || decision === 'DUPLICATE') {
        return { result: decision, status: payment.status };
      }
      if (decision === 'IGNORED') {
        this.logger.warn(`ignored conflicting ${cmd.status} callback for SUCCESS payment txn=${cmd.transactionId}`);
        return { result: 'IGNORED', status: payment.status };
      }

      const loan = await tx.loans.lockById(payment.loanId);
      const wasPending = payment.status === PaymentStatus.PENDING;
      const pendingAfter = wasPending ? releasePending(loan.pendingCents, payment.amountCents) : loan.pendingCents;
      const providerTs = cmd.timestamp ? new Date(cmd.timestamp) : null;

      if (cmd.status === PaymentStatus.SUCCESS) {
        const { appliedCents, balanceAfterCents } = settleAgainstBalance(loan.balanceCents, payment.amountCents);

        // UNIQUE(payment_id): the DB itself refuses a double application
        await tx.ledger.insert({
          loanId: loan.id,
          paymentId: payment.id,
          amountCents: appliedCents,
          balanceBeforeCents: loan.balanceCents,
          balanceAfterCents,
        });
        await tx.loans.saveBalances(loan.id, {
          balanceCents: balanceAfterCents,
          pendingCents: pendingAfter,
          status: balanceAfterCents === 0 ? LoanStatus.PAID_OFF : LoanStatus.ACTIVE,
        });
        await tx.payments.markSuccess(payment.id, providerTs);
        await tx.events.add({
          loanId: loan.id,
          paymentId: payment.id,
          type: 'PAYMENT_SUCCESS',
          note: appliedCents < payment.amountCents
            ? `Overpayment ${fromCents(payment.amountCents - appliedCents)} not applied` : null,
        });

        // Test hook: proves a failure before commit leaves everything untouched
        if (this.config.chaosFailOnce && !this.chaosUsed) {
          this.chaosUsed = true;
          throw new Error('Simulated DB failure before commit');
        }
      } else {
        // FAILED: balance untouched, reserved amount released, reason stored
        const reason = (cmd.reason || 'Declined by provider').slice(0, 255);
        await tx.loans.saveBalances(loan.id, {
          balanceCents: loan.balanceCents,
          pendingCents: pendingAfter,
          status: loan.status,
        });
        await tx.payments.markFailed(payment.id, reason, providerTs);
        await tx.events.add({ loanId: loan.id, paymentId: payment.id, type: 'PAYMENT_FAILED', note: reason });
      }
      return { result: 'APPLIED', status: cmd.status };
    });
  }
}