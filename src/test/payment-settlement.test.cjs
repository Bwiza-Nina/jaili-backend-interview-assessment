const assert = require('node:assert/strict');
const test = require('node:test');
const { ApplyPaymentStatusUseCase } = require('../dist/application/apply-payment-status.use-case.js');
const { LoanStatus, PaymentStatus, Provider } = require('../dist/domain/enums.js');

function createHarness({ chaosFailOnce = false } = {}) {
  const state = {
    payment: {
      id: 7,
      loanId: 1,
      provider: Provider.MTN,
      transactionId: 'txn-7',
      amountCents: 2_000,
      currency: 'RWF',
      status: PaymentStatus.PENDING,
    },
    loan: {
      id: 1,
      balanceCents: 5_000,
      pendingCents: 2_000,
      status: LoanStatus.ACTIVE,
    },
    ledger: [],
    events: [],
  };

  const uow = {
    async run(work) {
      const before = structuredClone(state);
      const tx = {
        payments: {
          async lockByProviderTxn() { return structuredClone(state.payment); },
          async markSuccess() { state.payment.status = PaymentStatus.SUCCESS; },
          async markFailed(_id, reason) {
            state.payment.status = PaymentStatus.FAILED;
            state.payment.failureReason = reason;
          },
        },
        loans: {
          async lockById() { return structuredClone(state.loan); },
          async saveBalances(_id, balances) { Object.assign(state.loan, balances); },
        },
        ledger: { async insert(entry) { state.ledger.push(structuredClone(entry)); } },
        events: { async add(event) { state.events.push(structuredClone(event)); } },
      };
      try {
        return await work(tx);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
  };

  return {
    state,
    useCase: new ApplyPaymentStatusUseCase(uow, { chaosFailOnce }),
  };
}

const success = {
  provider: Provider.MTN,
  transactionId: 'txn-7',
  status: PaymentStatus.SUCCESS,
  amountCents: 2_000,
  currency: 'RWF',
};

test('repeated successful callbacks settle a payment once', async () => {
  const { state, useCase } = createHarness();

  assert.equal((await useCase.execute(success)).result, 'APPLIED');
  assert.equal((await useCase.execute(success)).result, 'DUPLICATE');
  assert.equal((await useCase.execute(success)).result, 'DUPLICATE');
  assert.equal(state.loan.balanceCents, 3_000);
  assert.equal(state.loan.pendingCents, 0);
  assert.equal(state.ledger.length, 1);
});

test('a failed transaction rolls back every settlement write and can be retried', async () => {
  const { state, useCase } = createHarness({ chaosFailOnce: true });

  await assert.rejects(useCase.execute(success), /Simulated DB failure before commit/);
  assert.equal(state.payment.status, PaymentStatus.PENDING);
  assert.equal(state.loan.balanceCents, 5_000);
  assert.equal(state.loan.pendingCents, 2_000);
  assert.equal(state.ledger.length, 0);
  assert.equal(state.events.length, 0);

  assert.equal((await useCase.execute(success)).result, 'APPLIED');
  assert.equal(state.loan.balanceCents, 3_000);
  assert.equal(state.ledger.length, 1);
});

test('a failed payment releases the reservation without changing loan balance', async () => {
  const { state, useCase } = createHarness();

  const result = await useCase.execute({
    ...success,
    status: PaymentStatus.FAILED,
    reason: 'Declined',
  });

  assert.equal(result.result, 'APPLIED');
  assert.equal(state.payment.status, PaymentStatus.FAILED);
  assert.equal(state.payment.failureReason, 'Declined');
  assert.equal(state.loan.balanceCents, 5_000);
  assert.equal(state.loan.pendingCents, 0);
  assert.equal(state.ledger.length, 0);
});

test('a failed callback cannot downgrade an already successful payment', async () => {
  const { state, useCase } = createHarness();

  await useCase.execute(success);
  const result = await useCase.execute({ ...success, status: PaymentStatus.FAILED });

  assert.equal(result.result, 'IGNORED');
  assert.equal(state.payment.status, PaymentStatus.SUCCESS);
  assert.equal(state.loan.balanceCents, 3_000);
  assert.equal(state.ledger.length, 1);
});

test('a late success after a prior settlement applies only the remaining loan balance', async () => {
  const { state, useCase } = createHarness();
  state.payment.status = PaymentStatus.FAILED;
  state.loan.balanceCents = 500;
  state.loan.pendingCents = 0;

  const result = await useCase.execute(success);

  assert.equal(result.result, 'APPLIED');
  assert.equal(state.payment.status, PaymentStatus.SUCCESS);
  assert.equal(state.loan.balanceCents, 0);
  assert.equal(state.ledger[0].amountCents, 500);
  assert.match(state.events[0].note, /Overpayment/);
});
