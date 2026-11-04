import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../domain/errors';
import {
  LEDGER_REPOSITORY, LOAN_REPOSITORY, LedgerRepository, LoanRepository,
  PAYMENT_REPOSITORY, PaymentFilter, PaymentRepository,
} from '../domain/ports';

@Injectable()
export class PaymentQueries {
  constructor(
    @Inject(LOAN_REPOSITORY) private readonly loans: LoanRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(LEDGER_REPOSITORY) private readonly ledger: LedgerRepository,
  ) {}

  async getLoan(id: number) {
    const loan = await this.loans.findById(id);
    if (!loan) throw new DomainError('LOAN_NOT_FOUND', 'Loan not found');
    return { loan, ledger: await this.ledger.listByLoan(id, 10) };
  }

  async getPayment(id: number) {
    const p = await this.payments.findById(id);
    if (!p) throw new DomainError('PAYMENT_NOT_FOUND', 'Payment not found');
    return p;
  }

  listPayments(filter: PaymentFilter) {
    return this.payments.list(filter);
  }
}