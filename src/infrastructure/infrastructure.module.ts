import { Module } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as mysql from 'mysql2/promise';
import { APP_CONFIG, AppConfig } from '../config/app.config';
import {
  CALLBACK_EVENT_REPOSITORY, HEALTH_CHECK, LEDGER_REPOSITORY, LOAN_REPOSITORY,
  PAYMENT_GATEWAYS, PAYMENT_REPOSITORY, SIGNATURE_VERIFIER, UNIT_OF_WORK,
} from '../domain/ports';
import {
  MysqlCallbackEventRepository, MysqlLedgerRepository, MysqlLoanRepository, MysqlPaymentRepository,
} from './database/mysql.repositories';
import { MYSQL_POOL, MysqlHealthCheck, MysqlUnitOfWork } from './database/mysql-unit-of-work';
import { AirtelGateway } from './providers/airtel.gateway';
import { GatewayRegistry } from './providers/gateway.registry';
import { MtnGateway } from './providers/mtn.gateway';
import { HmacSignatureVerifier } from './security/hmac-signature.verifier';

@Module({
  providers: [
    {
      provide: MYSQL_POOL,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => mysql.createPool({
        ...c.db,
        ssl: c.dbTls.enabled
          ? {
            rejectUnauthorized: true,
            ...(c.dbTls.caPath ? { ca: readFileSync(c.dbTls.caPath) } : {}),
          }
          : undefined,
        waitForConnections: true,
        connectionLimit: 10,
        timezone: 'Z',
      }),
    },
    { provide: LOAN_REPOSITORY, inject: [MYSQL_POOL], useFactory: (p: any) => new MysqlLoanRepository(p) },
    { provide: PAYMENT_REPOSITORY, inject: [MYSQL_POOL], useFactory: (p: any) => new MysqlPaymentRepository(p) },
    { provide: LEDGER_REPOSITORY, inject: [MYSQL_POOL], useFactory: (p: any) => new MysqlLedgerRepository(p) },
    { provide: CALLBACK_EVENT_REPOSITORY, inject: [MYSQL_POOL], useFactory: (p: any) => new MysqlCallbackEventRepository(p) },
    { provide: UNIT_OF_WORK, useClass: MysqlUnitOfWork },
    { provide: HEALTH_CHECK, useClass: MysqlHealthCheck },
    MtnGateway,
    AirtelGateway,
    { provide: PAYMENT_GATEWAYS, useClass: GatewayRegistry },
    { provide: SIGNATURE_VERIFIER, useClass: HmacSignatureVerifier },
  ],
  exports: [
    UNIT_OF_WORK, LOAN_REPOSITORY, PAYMENT_REPOSITORY, LEDGER_REPOSITORY,
    CALLBACK_EVENT_REPOSITORY, PAYMENT_GATEWAYS, SIGNATURE_VERIFIER, HEALTH_CHECK,
  ],
})
export class InfrastructureModule {}