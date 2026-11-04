import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { HealthCheck, TxContext, UnitOfWork } from '../../domain/ports';
import {
  MysqlLedgerRepository, MysqlLoanEventRepository, MysqlLoanRepository, MysqlPaymentRepository,
} from './mysql.repositories';

export const MYSQL_POOL = 'MYSQL_POOL';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class MysqlUnitOfWork implements UnitOfWork, OnApplicationShutdown {
  private readonly logger = new Logger(MysqlUnitOfWork.name);

  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  // BEGIN -> work -> COMMIT. Any error -> ROLLBACK. Deadlocks/lock timeouts are retried.
  async run<T>(work: (tx: TxContext) => Promise<T>, maxAttempts = 3): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const conn = await this.pool.getConnection();
      try {
        await conn.beginTransaction();
        const db = conn as any;
        const tx: TxContext = {
          loans: new MysqlLoanRepository(db),
          payments: new MysqlPaymentRepository(db),
          ledger: new MysqlLedgerRepository(db),
          events: new MysqlLoanEventRepository(db),
        };
        const result = await work(tx);
        await conn.commit();
        return result;
      } catch (err: any) {
        try { await conn.rollback(); } catch { /* ignore */ }
        const retryable = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err?.code);
        if (retryable && attempt < maxAttempts) {
          this.logger.warn(`retrying transaction (${err.code}) attempt=${attempt}`);
          await sleep(50 * attempt + Math.random() * 50);
          continue;
        }
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Injectable()
export class MysqlHealthCheck implements HealthCheck {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}
  async ping() {
    try { await this.pool.query('SELECT 1'); return true; } catch { return false; }
  }
}