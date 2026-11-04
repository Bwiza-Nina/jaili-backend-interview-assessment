import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, ProviderRequestError } from '../domain/errors';
import { LoanStatus, PaymentStatus } from '../domain/enums';
import { fromCents } from '../domain/money';
import {
  PAYMENT_GATEWAYS, PAYMENT_REPOSITORY, PaymentGatewayResolver, PaymentRepository, UNIT_OF_WORK, UnitOfWork,
} from '../domain/ports';
import { ApplyPaymentStatusUseCase } from './apply-payment-status.use-case';
import { Dispatch, InitiatePaymentCommand } from './commands';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class InitiatePaymentUseCase {
  private readonly logger = new Logger(InitiatePaymentUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAYS) private readonly gateways: PaymentGatewayResolver,
    private readonly applyStatus: ApplyPaymentStatusUseCase,
  ) {}

  async execute(cmd: InitiatePaymentCommand): Promise<{ transactionId: string; dispatch: Dispatch }> {
    const transactionId = randomUUID(); // doubles as the provider idempotency key

    // 1. DB transaction: validate, reserve money, create PENDING payment, tell the loan system
    await this.uow.run(async (tx) => {
      // Lock the loan row: two simultaneous requests are serialized here
      const loan = await tx.loans.lockById(cmd.loanId);
      if (!loan) throw new DomainError('LOAN_NOT_FOUND', 'Loan does not exist');
      if (loan.status === LoanStatus.PAID_OFF) throw new DomainError('LOAN_ALREADY_PAID', 'Loan is fully paid');
      if (cmd.currency !== loan.currency) {
        throw new DomainError('CURRENCY_MISMATCH', `Loan currency is ${loan.currency}`);
      }
      // Balance minus money already reserved by in-flight payments
      const available = loan.balanceCents - loan.pendingCents;
      if (cmd.amountCents > available) {
        throw new DomainError('AMOUNT_EXCEEDS_BALANCE', `Maximum payable now is ${fromCents(available)}`);
      }

      const paymentId = await tx.payments.insert({
        loanId: loan.id,
        provider: cmd.provider,
        transactionId,
        msisdn: cmd.msisdn,
        amountCents: cmd.amountCents,
        currency: cmd.currency,
      });
      // "Update the loan management system when the payment request is sent"
      await tx.loans.addPending(loan.id, cmd.amountCents);
      await tx.events.add({
        loanId: loan.id,
        paymentId,
        type: 'PAYMENT_REQUESTED',
        note: `${cmd.provider} request for ${fromCents(cmd.amountCents)} ${cmd.currency}`,
      });
    });

    // 2. Network call is OUTSIDE the DB transaction (never hold locks during slow I/O)
    const dispatch = await this.dispatchToProvider(cmd, transactionId);
    return { transactionId, dispatch };
  }

  // Retry with exponential backoff; SAME transactionId each time = provider-side idempotency
  private async dispatchToProvider(cmd: InitiatePaymentCommand, transactionId: string): Promise<Dispatch> {
    const gateway = this.gateways.resolve(cmd.provider);
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { providerReference } = await gateway.requestPayment({
          transactionId,
          amount: fromCents(cmd.amountCents),
          currency: cmd.currency,
          msisdn: cmd.msisdn,
        });
        await this.payments.recordDispatch(cmd.provider, transactionId, providerReference);
        return 'SENT';
      } catch (err) {
        await this.payments.recordDispatch(cmd.provider, transactionId, null);
        const retryable = err instanceof ProviderRequestError ? err.retryable : true;
        this.logger.warn(`provider request failed txn=${transactionId} attempt=${attempt} retryable=${retryable}: ${err.message}`);

        if (!retryable) {
          // Provider definitively refused: mark FAILED and release the reserved amount
          await this.applyStatus.execute({
            provider: cmd.provider,
            transactionId,
            status: PaymentStatus.FAILED,
            reason: String(err.message).slice(0, 200),
          });
          return 'REJECTED';
        }
        if (attempt < maxAttempts) await sleep(500 * 2 ** (attempt - 1));
      }
    }
    // Timeout / 5xx after all retries: we DON'T know if the provider got it.
    // Stay PENDING; the callback or the reconciliation worker will settle it.
    return 'UNCERTAIN';
  }
}