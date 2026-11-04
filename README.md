# Loan Payments API

A NestJS/TypeScript service for initiating loan repayments through MTN MoMo or Airtel Money, receiving signed payment notifications, and applying successful payments to a MySQL loan balance. The API also exposes loan and payment details for a Next.js server-side frontend.

This repository contains a runnable reference implementation. The provider adapters and callback contract must be validated against the merchant account, country, API version, and webhook-signature rules used in a real deployment; the mock mode is for local development only.

## What the service does

- Creates one `PENDING` payment record before contacting a provider and reserves the amount against the loan.
- Sends an MTN or Airtel collection request using the generated transaction ID as the provider reference/idempotency key.
- Receives a normalized, HMAC-SHA256-signed payment callback and validates its shape and signature.
- Settles each payment once, atomically updating the payment, loan balance, reservation, ledger, and loan event.
- Stores callbacks before processing them so a worker can retry after a transient database/process failure.
- Reconciles old pending requests by asking the provider for their current status.
- Provides authenticated loan/payment read endpoints and an OpenAPI page for development.

Amounts are represented as integer cents in the application and `DECIMAL(15,2)` in MySQL. The implementation is intended for payment amounts up to `1,000,000,000,000` major units, matching request validation.

## Project structure and flow

```text
src/
  domain/             Entities, statuses, money and settlement rules, ports
  application/        Initiate, receive, settle, query, and reconcile use cases
  infrastructure/
    database/         MySQL repositories and transaction/unit-of-work
    providers/        MTN/Airtel HTTP gateways and provider registry
    security/         Callback HMAC verifier
  presentation/
    controllers/      HTTP routes
    dto/              Request validation and OpenAPI response types
    guards/           API-key and callback-signature guards
    jobs/             Periodic reconciliation worker
database/
  migrations/         Initial MySQL schema
  seed.sql            Optional local demo loan
test/                 Node.js settlement tests
```

For a payment request, `POST /api/loans/:loanId/payments` starts a MySQL transaction, locks the loan row, verifies the currency and available balance, inserts a pending payment, increases `pending_amount`, and writes a `PAYMENT_REQUESTED` loan event. It then commits before making network calls to the provider, so slow provider requests do not hold database locks.

The provider request is attempted up to three times with exponential delays and the same transaction ID each time. A definitive provider rejection changes the payment to `FAILED` and releases the reservation. A timeout or temporary provider failure is ambiguous—the provider might have received the request—so the API leaves the payment `PENDING`, returns `dispatch: "UNCERTAIN"`, and lets a callback or reconciliation settle it.

For a successful callback, the service locks the payment then the loan, verifies the callback amount/currency against the original request, inserts a unique ledger row, deducts the applied amount, releases the reservation, marks the payment `SUCCESS`, and records a loan event in one MySQL transaction. Any failure rolls all those writes back. Failed payments leave the balance unchanged, record the failure reason, and release the reserved amount. A success is never downgraded by a later conflicting failure. If a late success arrives after another payment has consumed part of the balance, the service applies only the remaining balance and records the unapplied overpayment in the loan event; it does not initiate a refund.

## Database schema

Apply [`database/migrations/001_initial_schema.sql`](database/migrations/001_initial_schema.sql) to an empty MySQL 8.4 database. It creates:

| Table | Purpose |
|---|---|
| `loans` | Loan principal, current balance, reserved pending amount, and status |
| `payments` | Provider transaction, amount, payer, status, attempts, and provider timestamps; unique on `(provider, transaction_id)` |
| `loan_ledger` | Applied balance changes; unique on `payment_id` to prevent double application |
| `loan_events` | Audit trail for requests and settlement outcomes |
| `callback_events` | Durable callback payloads and processing outcomes, including callbacks recovered after a crash |

All tables use InnoDB. The service relies on transactions and `SELECT ... FOR UPDATE` row locks; do not use a storage engine that does not support them. The initial migration is idempotent for a new/compatible database, but `CREATE TABLE IF NOT EXISTS` does not upgrade an existing table. Use reviewed, versioned migrations for later schema changes.

### Existing UUID-schema database returns HTTP 500

The current API expects numeric auto-increment IDs. If a database was initialized by an earlier UUID-based version, `GET /health` may still return `200` even though payment requests fail with a MySQL error such as `Field 'id' doesn't have a default value`. Health checks database connectivity, not table compatibility.

Do not rerun the initial migration expecting it to alter existing tables: `CREATE TABLE IF NOT EXISTS` leaves them unchanged. First take a verified backup and inspect the schema and data. For a local/demo database with numeric loan IDs and no rows in `payments`, `loan_ledger`, `loan_events`, or `callback_events`, the data-preserving one-time conversion is in [`database/maintenance/upgrade-legacy-uuid-schema.sql`](database/maintenance/upgrade-legacy-uuid-schema.sql). Confirm those four tables are empty before running it; stop the API during the change:

```sh
docker compose stop api
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
  < database/maintenance/upgrade-legacy-uuid-schema.sql
docker compose start api
```

It preserves the loan row and changes the IDs/foreign keys to the format expected by this API. **Do not run it on a fresh schema, on a database with payment history, or in production without a reviewed migration plan.** For other legacy data, write and verify a tailored migration that preserves and maps every existing identifier.

## Run locally

Requirements: Node.js 20+, npm, Docker with Docker Compose, and a MySQL 8.4 server if not using Compose.

1. Copy `.env.example` to `.env`. Replace every example password and secret with unique random values before starting. Keep `.env` out of source control.
2. Start the database and wait for its health check:

   ```sh
   docker compose up -d db
   docker compose ps
   ```

3. Apply the schema, and optionally insert the demo loan with ID `1`:

   ```sh
   docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
     < database/init/001_initial_schema.sql
   docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" "$MYSQL_DATABASE"' \
     < database/seed.sql
   ```

   The seed is for a fresh local database only. It creates an active RWF loan with a principal of `100000.00` and an outstanding balance of `80000.00`.

4. Start the API container:

   ```sh
   docker compose up -d --build api
   docker compose logs -f api
   ```

   The API listens on port `3000` by default. Local Compose binds MySQL to `127.0.0.1:3306`; the API is published on the host port set by `PORT` (default `3000`).

Alternatively, run the API from source after starting MySQL and applying the migration:

```sh
npm ci
set -a
. ./.env
set +a
npm run build
npm start
```

For local source execution, set `DB_HOST=127.0.0.1` in `.env` because the `db` hostname is only available to containers on the Compose network. Set `PROVIDER_MOCK=true` to exercise the API without provider credentials. Mock mode returns a provider reference but does not automatically settle a payment; send a signed callback to simulate the provider.

Check `GET http://localhost:3000/health` for API/database health. When `SWAGGER_ENABLED=true`, interactive OpenAPI documentation is available at `http://localhost:3000/docs`. Swagger defaults off in production.

## Configuration and secrets

The application fails fast if any of these are missing: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `INTERNAL_API_KEY`, `MTN_CALLBACK_SECRET`, or `AIRTEL_CALLBACK_SECRET`.

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT` | Runtime environment and listen port |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection |
| `DB_SSL` | Enables TLS for the MySQL connection when set to `true` |
| `DB_SSL_CA` | Optional path to the trusted database CA certificate (mount it into the container when needed) |
| `INTERNAL_API_KEY` | `x-api-key` for internal loan/payment routes |
| `MTN_CALLBACK_SECRET`, `AIRTEL_CALLBACK_SECRET` | HMAC secrets for the normalized callback endpoint |
| `PROVIDER_MOCK` | `true` uses mock payment requests/statuses; set `false` for provider HTTP integrations |
| `PUBLIC_CALLBACK_BASE_URL` | Public HTTPS API origin, without a trailing slash, used to construct `/api/callbacks/payments` |
| `MTN_BASE_URL`, `MTN_API_USER`, `MTN_API_KEY`, `MTN_SUBSCRIPTION_KEY`, `MTN_TARGET_ENV` | MTN MoMo collection adapter settings |
| `AIRTEL_BASE_URL`, `AIRTEL_CLIENT_ID`, `AIRTEL_CLIENT_SECRET`, `AIRTEL_COUNTRY` | Airtel Money adapter settings |
| `WORKER_INTERVAL_MS`, `PENDING_TIMEOUT_MIN` | Reconciliation polling interval and age threshold |
| `SWAGGER_ENABLED` | Enables `/docs`; leave disabled in production |
| `CHAOS_FAIL_ONCE` | Development-only test hook (`1` simulates one pre-commit settlement failure; ignored in production) |

Use a secret manager or orchestrator-provided secrets in production. Do not commit `.env`, bake credentials into Docker images, return them to the browser, or include them in logs. Rotate credentials and callback secrets through a planned deployment. Give the database account only the permissions the service needs, and do not expose MySQL publicly.

## HTTP API

Internal routes require the header `x-api-key: <INTERNAL_API_KEY>`. Provider callbacks instead require `x-signature`, the lowercase hexadecimal HMAC-SHA256 of the exact raw HTTP body using the secret assigned to the named provider. The API has a global request limit of 600 requests per minute per IP; tune it for the deployment.

### Initiate a loan payment

`POST /api/loans/{loanId}/payments`

```http
POST /api/loans/1/payments
Content-Type: application/json
x-api-key: <INTERNAL_API_KEY>
```

```json
{
  "provider": "MTN",
  "msisdn": "250788000000",
  "amount": 20000,
  "currency": "RWF"
}
```

`provider` is `MTN` or `AIRTEL`; amount must be positive with at most two decimal places. The currency must match the loan. A successful/ambiguous initiation returns HTTP `202`:

```json
{
  "transactionId": "generated-uuid",
  "status": "PENDING",
  "dispatch": "SENT"
}
```

`dispatch` is `SENT` when the provider accepted the request and `UNCERTAIN` when retries timed out or otherwise ended without a definitive result. The transaction remains pending until reconciled. A definitive provider refusal is stored as failed and returns `502`.

To initiate through Airtel instead, send the same request shape with `"provider": "AIRTEL"`:

```sh
curl -i http://localhost:3000/api/loans/1/payments \
  -H "Content-Type: application/json" \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -d '{"provider":"AIRTEL","msisdn":"250788000000","amount":20000,"currency":"RWF"}'
```

### Provider callback

`POST /api/callbacks/payments`

The service expects this normalized JSON shape; it uses `transactionId` (camel case) and a nested `data` object:

```json
{
  "provider": "MTN",
  "transactionId": "generated-uuid",
  "data": {
    "amount": 20000,
    "currency": "RWF",
    "status": "SUCCESS",
    "timestamp": "2026-11-04T13:05:00Z"
  }
}
```

Allowed statuses are `PENDING`, `SUCCESS`, and `FAILED`. A failed notification can include `reason`. Repeated successful callbacks return HTTP `200` with `result: "DUPLICATE"` and do not apply the loan balance twice. Callback event data is stored before settlement; if settlement fails, the API returns `500` and marks the event for retry. A background worker also retries unprocessed callback records, including records left in `RECEIVED` if the process stopped before it could mark them.

For a local mock callback, save the exact payload bytes as `callback.json` and calculate its signature with the corresponding secret:

```sh
set -a
. ./.env
set +a
SIGNATURE="$(node -e 'let body="";process.stdin.on("data",d=>body+=d).on("end",()=>process.stdout.write(require("crypto").createHmac("sha256",process.argv[1]).update(body).digest("hex")))' "$MTN_CALLBACK_SECRET" < callback.json)"
curl -i http://localhost:3000/api/callbacks/payments \
  -H "Content-Type: application/json" \
  -H "x-signature: $SIGNATURE" \
  --data-binary @callback.json
```

Use the exact original bytes to compute the signature; reformatting JSON after signing changes the HMAC.

#### Step-by-step local smoke test

1. Use the MTN or Airtel initiation request above and copy its `transactionId`. In mock mode the response is `202` with `dispatch: "SENT"`; the loan now has a pending reservation.
2. Put that transaction ID into the callback JSON, set `status` to `SUCCESS`, and send the signed callback. The first response is `200` with `result: "APPLIED"`.
3. Send the exact same bytes and signature again. It should still return `200`, now with `result: "DUPLICATE"`.
4. Fetch `GET /api/loans/1` with the API key. With the optional seed loan and a `20000` payment, the balance should be `"60000.00"` and `pendingAmount` should be `"0.00"`. The ledger has exactly one entry for the payment.

For a failed-payment check, initiate another payment and send its callback with `"status":"FAILED"` and a reason such as `"Insufficient funds"`; the balance is unchanged and the reservation is released.

### Read loan/payment details

All of these endpoints require `x-api-key`.

| Method and path | Description |
|---|---|
| `GET /api/loans/{id}` | Loan balance, reserved amount, status, and latest 10 ledger entries |
| `GET /api/payments?loanId=1&status=PENDING&limit=20&offset=0` | Filtered, paginated payment list |
| `GET /api/payments/{id}` | One payment by database ID |
| `GET /health` | API liveness and MySQL connectivity; returns `503` if MySQL is unavailable |

Money in response views is formatted as decimal strings (for example `"20000.00"`). The payment response includes the provider transaction ID, provider reference, status, failure reason, attempt count, and timestamps.

## HTTP response codes

| Status | Meaning |
|---|---|
| `200` | Read succeeded; callback was applied, duplicated, ignored as conflicting, or was a no-op |
| `202` | Payment request recorded; provider accepted it or its result is uncertain |
| `400` | Malformed JSON or invalid request fields/provider |
| `401` | Missing/invalid internal API key or callback signature |
| `404` | Loan/payment/transaction does not exist |
| `409` | Loan is already paid or callback amount/currency conflicts with the original payment |
| `422` | Currency mismatch or amount exceeds currently available loan balance |
| `502` | Provider definitively rejected a payment request |
| `500` | Unexpected temporary application/database failure; callbacks should be retried |
| `503` | Health check cannot reach MySQL |

## Concurrency, retries, and failure cases

- **Same callback sent multiple times:** each callback is durably recorded. Settlement locks the payment row; the first success writes the ledger/balance, subsequent successes see `SUCCESS` and return `DUPLICATE`. The unique provider transaction and unique ledger payment constraints provide database-level backstops.
- **Provider succeeded but database update failed:** payment, loan, ledger, and loan-event changes share one transaction and roll back together. The callback journal is written separately first. The endpoint returns `500`; provider retries and the worker reprocesses stored callbacks after a short delay. Replaying a callback is idempotent.
- **Two payments arrive for one loan at once:** initiation locks the loan row and computes available balance as `balance - pending_amount`. The first request reserves its amount before releasing the lock; the next request sees the updated reservation and cannot reserve funds already committed to another pending payment.
- **Provider call timed out:** the same transaction ID is reused for the three in-request attempts. If the result remains uncertain, the payment stays pending; do not create an immediate compensating payment. A provider callback or status reconciliation determines the outcome.
- **Callback arrives after the caller/provider timed out:** the payment was persisted before the provider call. If its callback arrives later, it can still find the transaction and settle it. Unknown transactions return `404` and are recorded as non-reprocessable domain errors.
- **Provider definitively declines:** the payment becomes `FAILED`, the reservation is released, the loan balance is unchanged, and the reason is retained. A later success notification can still be accepted; only the remaining loan balance is applied.

The worker runs every `WORKER_INTERVAL_MS` (default 60 seconds). It retries durable callback events and asks providers for the status of pending payments older than `PENDING_TIMEOUT_MIN` (default 5 minutes). A mock provider always reports `PENDING`; test settlement by sending a callback instead.

## MTN/Airtel and Next.js integration

The provider gateways implement a shared interface: `requestPayment(...)` and `getStatus(transactionId, currency)`. With mock mode disabled, the MTN adapter obtains a collection token and submits a request-to-pay with an `X-Reference-Id`, `externalId`, amount, currency, MSISDN payer, and configured callback URL. The Airtel adapter obtains an OAuth token and submits a payment containing subscriber country/currency/MSISDN and transaction ID/amount/currency. Configure Airtel's callback URL using the provider's merchant settings or supported API field for the account. The adapters map known provider status responses to the internal `PENDING`, `SUCCESS`, and `FAILED` states. HTTP `429`, `5xx`, timeouts, and network failures are retryable; other `4xx` responses are treated as definitive rejection.

The callback route above is an application-level normalized contract—not a claim that both providers send that exact body or `x-signature` format by default. Before production, verify provider-specific request fields, OAuth/token lifetime, request idempotency semantics, status values, currency/country headers, webhook authentication, and callback retries against the actual merchant API documentation. Add or configure a provider-specific callback adapter/verifier if a provider signs requests differently. Never disable callback authentication to work around an integration mismatch.

A Next.js application should call this API from a server route handler/server action or other trusted backend, not expose `INTERNAL_API_KEY` to browser JavaScript. For example:

```ts
const response = await fetch(`${process.env.PAYMENTS_API_URL}/api/payments?loanId=${loanId}`, {
  headers: { 'x-api-key': process.env.PAYMENTS_API_KEY! },
  cache: 'no-store',
});
if (!response.ok) throw new Error('Unable to load payment history');
const payments = await response.json();
```

The frontend can poll or refresh the loan/payment read endpoints after the `202` response. Treat `PENDING` as not yet settled; show `SUCCESS` only after a callback or status reconciliation changes the stored record. For production, consider event-driven updates or a frontend-facing backend-for-frontend instead of rapid polling.

## Deployment, logs, monitoring, and recovery

- Build and run the provided multi-stage Docker image. The build and runtime stages use `npm ci` with `package-lock.json`. Run the migration as a separate deployment step before accepting traffic.
- Put the API behind a TLS-terminating reverse proxy/load balancer with a stable HTTPS domain. Point `PUBLIC_CALLBACK_BASE_URL` at that public origin so the configured callback URL is `https://<host>/api/callbacks/payments`. Configure the real provider dashboard to use the same reachable URL. Restrict internal routes to trusted callers; do not publish MySQL or rely on CORS as authentication.
- In production, use a managed/private MySQL service or protected container network, persistent encrypted storage, least-privilege accounts, and secure secret injection. Enable MySQL TLS with `DB_SSL=true`; set `DB_SSL_CA` to a mounted CA certificate when the database certificate is signed by a private CA. The sample Compose passwords/secrets are placeholders, not production values.
- The service writes structured JSON Nest logs and one HTTP log entry per request with request ID, method, path, status, and duration. It does not intentionally log request bodies, API keys, signatures, or provider tokens. Collect logs centrally and alert on elevated `5xx`, provider timeouts, failed reconciliation, database errors, and a growing count/age of pending payments. The built-in `/health` endpoint checks MySQL availability, but this repository does not include a metrics/APM/error-monitoring vendor integration.
- Back up MySQL regularly using consistent snapshots (for InnoDB, `mysqldump --single-transaction` or a managed backup), encrypt backups, store copies off-host, restrict access, and periodically test restores into an isolated database. Keep backup retention aligned with financial-record and privacy requirements. One local Compose backup example is:

  ```sh
  mkdir -p backups
  docker compose exec -T db sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction -uroot "$MYSQL_DATABASE"' \
    > backups/loans-$(date -u +%Y%m%dT%H%M%SZ).sql
  ```

  Restore only after verifying the target database and backup; a restore overwrites existing data. The `backups/` path is git-ignored.
- For a public service address, provision DNS and HTTPS, route the callback path to the API, configure `PUBLIC_CALLBACK_BASE_URL` without a trailing slash, and register the URL with the provider. Keep internal API credentials server-side and protect provider credentials and callback secrets as production secrets.

## Tests

Run the TypeScript build and focused Node.js tests:

```sh
npm ci
npm test
```

The tests cover duplicate success callbacks, rollback and retry after a simulated settlement failure, failed-payment reservation release, conflicting status protection, and late-success overpayment handling. They exercise settlement with an in-memory unit of work; apply the SQL migration and run a provider sandbox/DB integration test before production rollout.
