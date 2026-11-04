CREATE TABLE IF NOT EXISTS loans (
    id CHAR(36) NOT NULL,
    borrower_name VARCHAR(255) NOT NULL,
    currency CHAR(3) NOT NULL,
    principal DECIMAL(19, 4) NOT NULL,
    balance DECIMAL(19, 4) NOT NULL,
    pending_amount DECIMAL(19, 4) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_loans_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payments (
    id CHAR(36) NOT NULL,
    loan_id CHAR(36) NOT NULL,
    provider ENUM('MTN', 'AIRTEL') NOT NULL,
    transaction_id VARCHAR(191) NOT NULL,
    payer_msisdn VARCHAR(32) NULL,
    amount DECIMAL(19, 4) NOT NULL,
    currency CHAR(3) NOT NULL,
    status ENUM('PENDING', 'SUCCESS', 'FAILED') NOT NULL,
    provider_reference VARCHAR(191) NULL,
    failure_reason TEXT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    provider_timestamp DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    applied_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_payments_provider_transaction (provider, transaction_id),
    KEY idx_payments_loan_created (loan_id, created_at),
    KEY idx_payments_status_created (status, created_at),
    CONSTRAINT fk_payments_loan
        FOREIGN KEY (loan_id) REFERENCES loans (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS loan_ledger (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    loan_id CHAR(36) NOT NULL,
    payment_id CHAR(36) NOT NULL,
    amount DECIMAL(19, 4) NOT NULL,
    balance_before DECIMAL(19, 4) NOT NULL,
    balance_after DECIMAL(19, 4) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_loan_ledger_payment (payment_id),
    KEY idx_loan_ledger_loan_created (loan_id, created_at),
    CONSTRAINT fk_loan_ledger_loan
        FOREIGN KEY (loan_id) REFERENCES loans (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_loan_ledger_payment
        FOREIGN KEY (payment_id) REFERENCES payments (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS loan_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    loan_id CHAR(36) NOT NULL,
    payment_id CHAR(36) NULL,
    `type` VARCHAR(64) NOT NULL,
    note TEXT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_loan_events_loan_created (loan_id, created_at),
    KEY idx_loan_events_payment_created (payment_id, created_at),
    CONSTRAINT fk_loan_events_loan
        FOREIGN KEY (loan_id) REFERENCES loans (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_loan_events_payment
        FOREIGN KEY (payment_id) REFERENCES payments (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS callback_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    provider ENUM('MTN', 'AIRTEL') NOT NULL,
    transaction_id VARCHAR(191) NOT NULL,
    payload LONGTEXT NOT NULL,
    received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    outcome VARCHAR(32) NULL,
    processed TINYINT(1) NOT NULL DEFAULT 0,
    error TEXT NULL,
    PRIMARY KEY (id),
    KEY idx_callback_events_provider_transaction (provider, transaction_id),
    KEY idx_callback_events_processed_received (processed, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
