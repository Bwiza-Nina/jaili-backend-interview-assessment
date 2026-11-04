import { Loan, LedgerEntry, NewPayment, Payment } from '../../domain/entities';
import { LoanStatus, PaymentStatus, Provider } from '../../domain/enums';
import { fromCents, toCents } from '../../domain/money';
import {
  CallbackEventRepository, LedgerRepository, LoanEventRepository, LoanRepository,
  PaymentFilter, PaymentRepository, StoredCallbackEvent,
} from '../../domain/ports';

// A pool OR a connection inside a transaction: repositories don't care which
export interface Db { query(sql: string, params?: any[]): Promise<any> }

async function select(db: Db, sql: string, params: any[] = []): Promise<any[]> {
  const [rows] = await db.query(sql, params);
  return rows;
}
async function execute(db: Db, sql: string, params: any[] = []): Promise<{ insertId: number; affectedRows: number }> {
  const [res] = await db.query(sql, params);
  return res;
}

const mapLoan = (r: any): Loan => ({
  id: Number(r.id),
  borrowerName: r.borrower_name,
  currency: r.currency,
  principalCents: toCents(r.principal),
  balanceCents: toCents(r.balance),
  pendingCents: toCents(r.pending_amount),
  status: r.status as LoanStatus,
});

const mapPayment = (r: any): Payment => ({
  id: Number(r.id),
  loanId: Number(r.loan_id),
  provider: r.provider as Provider,
  transactionId: r.transaction_id,
  providerReference: r.provider_reference,
  msisdn: r.payer_msisdn,
  amountCents: toCents(r.amount),
  currency: r.currency,
  status: r.status as PaymentStatus,
  failureReason: r.failure_reason,
  attempts: r.attempts,
  createdAt: r.created_at,
  appliedAt: r.applied_at,
});

export class MysqlLoanRepository implements LoanRepository {
  constructor(private readonly db: Db) {}

  async findById(id: number) {
    const rows = await select(this.db, 'SELECT * FROM loans WHERE id=?', [id]);
    return rows[0] ? mapLoan(rows[0]) : null;
  }
  async lockById(id: number) {
    const rows = await select(this.db, 'SELECT * FROM loans WHERE id=? FOR UPDATE', [id]);
    return rows[0] ? mapLoan(rows[0]) : null;
  }
  async addPending(id: number, cents: number) {
    await execute(this.db, 'UPDATE loans SET pending_amount = pending_amount + ? WHERE id=?', [fromCents(cents), id]);
  }
  async saveBalances(id: number, b: { balanceCents: number; pendingCents: number; status: LoanStatus }) {
    await execute(this.db, 'UPDATE loans SET balance=?, pending_amount=?, status=? WHERE id=?',
      [fromCents(b.balanceCents), fromCents(b.pendingCents), b.status, id]);
  }
}

export class MysqlPaymentRepository implements PaymentRepository {
  constructor(private readonly db: Db) {}

  async insert(p: NewPayment) {
    const res = await execute(this.db,
      `INSERT INTO payments (loan_id, provider, transaction_id, payer_msisdn, amount, currency, status)
       VALUES (?,?,?,?,?,?, 'PENDING')`,
      [p.loanId, p.provider, p.transactionId, p.msisdn, fromCents(p.amountCents), p.currency]);
    return Number(res.insertId);
  }
  async lockByProviderTxn(provider: Provider, transactionId: string) {
    const rows = await select(this.db,
      'SELECT * FROM payments WHERE provider=? AND transaction_id=? FOR UPDATE', [provider, transactionId]);
    return rows[0] ? mapPayment(rows[0]) : null;
  }
  async markSuccess(id: number, providerTs: Date | null) {
    await execute(this.db,
      `UPDATE payments SET status='SUCCESS', failure_reason=NULL, provider_timestamp=?, applied_at=UTC_TIMESTAMP(3) WHERE id=?`,
      [providerTs, id]);
  }
  async markFailed(id: number, reason: string, providerTs: Date | null) {
    await execute(this.db,
      `UPDATE payments SET status='FAILED', failure_reason=?, provider_timestamp=? WHERE id=?`,
      [reason, providerTs, id]);
  }
  async recordDispatch(provider: Provider, transactionId: string, providerReference: string | null) {
    await execute(this.db,
      'UPDATE payments SET provider_reference=COALESCE(?, provider_reference), attempts=attempts+1 WHERE provider=? AND transaction_id=?',
      [providerReference, provider, transactionId]);
  }
  async findStalePending(olderThanMinutes: number, limit: number) {
    const rows = await select(this.db,
      `SELECT provider, transaction_id, currency FROM payments
       WHERE status='PENDING' AND created_at < (NOW() - INTERVAL ? MINUTE) ORDER BY id LIMIT ?`,
      [olderThanMinutes, limit]);
    return rows.map((r) => ({
      provider: r.provider as Provider,
      transactionId: r.transaction_id as string,
      currency: r.currency as string,
    }));
  }
  async findById(id: number) {
    const rows = await select(this.db, 'SELECT * FROM payments WHERE id=?', [id]);
    return rows[0] ? mapPayment(rows[0]) : null;
  }
  async list(f: PaymentFilter) {
    const where: string[] = [];
    const params: any[] = [];
    if (f.loanId) { where.push('loan_id=?'); params.push(f.loanId); }
    if (f.status) { where.push('status=?'); params.push(f.status); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await select(this.db,
      `SELECT * FROM payments ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, f.limit, f.offset]);
    const [{ total }] = await select(this.db, `SELECT COUNT(*) AS total FROM payments ${w}`, params);
    return { data: rows.map(mapPayment), total: Number(total) };
  }
}

export class MysqlLedgerRepository implements LedgerRepository {
  constructor(private readonly db: Db) {}

  async insert(e: LedgerEntry) {
    await execute(this.db,
      'INSERT INTO loan_ledger (loan_id, payment_id, amount, balance_before, balance_after) VALUES (?,?,?,?,?)',
      [e.loanId, e.paymentId, fromCents(e.amountCents), fromCents(e.balanceBeforeCents), fromCents(e.balanceAfterCents)]);
  }
  async listByLoan(loanId: number, limit: number) {
    const rows = await select(this.db,
      'SELECT * FROM loan_ledger WHERE loan_id=? ORDER BY id DESC LIMIT ?', [loanId, limit]);
    return rows.map((r) => ({
      loanId: Number(r.loan_id),
      paymentId: Number(r.payment_id),
      amountCents: toCents(r.amount),
      balanceBeforeCents: toCents(r.balance_before),
      balanceAfterCents: toCents(r.balance_after),
      createdAt: r.created_at as Date,
    }));
  }
}

export class MysqlLoanEventRepository implements LoanEventRepository {
  constructor(private readonly db: Db) {}

  async add(e: { loanId: number; paymentId: number | null; type: string; note?: string | null }) {
    await execute(this.db, 'INSERT INTO loan_events (loan_id, payment_id, type, note) VALUES (?,?,?,?)',
      [e.loanId, e.paymentId, e.type, e.note ?? null]);
  }
}

export class MysqlCallbackEventRepository implements CallbackEventRepository {
  constructor(private readonly db: Db) {}

  async insert(provider: string, transactionId: string, payloadJson: string) {
    const res = await execute(this.db,
      'INSERT INTO callback_events (provider, transaction_id, payload) VALUES (?,?,?)',
      [provider, transactionId, payloadJson]);
    return Number(res.insertId);
  }
  async mark(id: number, outcome: string, processed: boolean, error: string | null = null) {
    await execute(this.db, 'UPDATE callback_events SET outcome=?, processed=?, error=? WHERE id=?',
      [outcome, processed ? 1 : 0, error ? String(error).slice(0, 500) : null, id]);
  }
  async findReprocessable(limit: number): Promise<StoredCallbackEvent[]> {
    const rows = await select(this.db,
      `SELECT id, payload FROM callback_events
       WHERE processed=0 AND outcome IN ('RECEIVED', 'ERROR') AND received_at < (NOW() - INTERVAL 30 SECOND)
       ORDER BY id LIMIT ?`, [limit]);
    return rows.map((r) => ({
      id: Number(r.id),
      payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    }));
  }
}