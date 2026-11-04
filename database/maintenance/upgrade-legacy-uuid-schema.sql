-- One-time upgrade for the earlier UUID-based local schema.
-- Back up first. This conversion requires payments, loan_ledger, loan_events,
-- and callback_events to be empty, and numeric loan IDs (for example "1").
-- Do not apply to a fresh schema or a database containing payment history.

ALTER TABLE payments DROP FOREIGN KEY fk_payments_loan;
ALTER TABLE loan_ledger
  DROP FOREIGN KEY fk_loan_ledger_loan,
  DROP FOREIGN KEY fk_loan_ledger_payment;
ALTER TABLE loan_events
  DROP FOREIGN KEY fk_loan_events_loan,
  DROP FOREIGN KEY fk_loan_events_payment;

ALTER TABLE loans
  MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE payments
  MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  MODIFY loan_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE loan_ledger
  MODIFY loan_id BIGINT UNSIGNED NOT NULL,
  MODIFY payment_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE loan_events
  MODIFY loan_id BIGINT UNSIGNED NOT NULL,
  MODIFY payment_id BIGINT UNSIGNED NULL;

ALTER TABLE callback_events
  MODIFY payload JSON NOT NULL,
  MODIFY outcome VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
  MODIFY error VARCHAR(500) NULL;

ALTER TABLE payments
  ADD CONSTRAINT fk_payments_loan
    FOREIGN KEY (loan_id) REFERENCES loans (id);

ALTER TABLE loan_ledger
  ADD CONSTRAINT fk_loan_ledger_loan
    FOREIGN KEY (loan_id) REFERENCES loans (id),
  ADD CONSTRAINT fk_loan_ledger_payment
    FOREIGN KEY (payment_id) REFERENCES payments (id);

ALTER TABLE loan_events
  ADD CONSTRAINT fk_loan_events_loan
    FOREIGN KEY (loan_id) REFERENCES loans (id),
  ADD CONSTRAINT fk_loan_events_payment
    FOREIGN KEY (payment_id) REFERENCES payments (id);
