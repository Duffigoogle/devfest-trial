# CloudMart — Payment Service (`@cloudmart/payment-service`)

The **Payment Service** handles simulated PaymentIntent creation, idempotency enforcement, deterministic payment charge simulation, HMAC-SHA256 webhook signature verification, and simulated refunds.

> **Security & Simulation Constraint**: Payment processing is **100% simulated**. No real Stripe/Adyen API credentials or external network payment gateway calls are used, and no credentials or secrets are hardcoded in source files.

## 1. Domain Responsibilities & Boundaries
- **Owns (`payment_db`)**: `payment_transactions`, `payment_idempotency_keys`, `refunds`, `outbox_events`, `processed_events`.
- **Does NOT Own**: Catalog inventory counts, shopping cart state, order line items, or customer email/SMS notifications.
- **Database Isolation**: Connects exclusively to `payment_db` via the dedicated `svc_payment` role (`DATABASE_URL`).

## 2. Environment Configuration

| Variable | Required | Default (Dev) | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `test`, `staging`, `production`) |
| `PORT` | No | `3004` | HTTP REST server listening port |
| `DATABASE_URL` | **Yes (Prod)** | — | PostgreSQL connection URL for `payment_db` (from Secret Manager) |
| `PAYMENT_WEBHOOK_SECRET` | **Yes (Prod)** | — | HMAC signing secret (min 16 chars in `staging`/`production`, injected via Secret Manager) |
| `PAYMENT_SIMULATION_ENABLED` | No | `true` | Enables deterministic simulated payment token evaluation |

## 3. Documented APIs & Simulated Payment Tokens

### 3.1 Simulated Payment Tokens (`POST /api/v1/payments/simulate`)
- `tok_sim_success` -> Transitions transaction to `SUCCEEDED` and publishes `payment.succeeded`.
- `tok_sim_decline_insufficient_funds` -> Transitions transaction to `FAILED` and publishes `payment.failed`.
- `tok_sim_decline_expired_card` -> Transitions transaction to `FAILED` and publishes `payment.failed`.
- `tok_sim_decline_fraud_suspected` -> Transitions transaction to `FAILED` and publishes `payment.failed`.

### 3.2 HTTP REST Endpoints
- `GET /healthz` — Kubernetes liveness probe.
- `GET /readyz` — Kubernetes readiness probe.
- `POST /api/v1/payments/simulate` — Simulates a payment charge using a validated `SimulatePaymentDto` (`orderId`, `simulatedPaymentToken`, `idempotencyKey`).
- `POST /api/v1/payments/webhook` — Verifies `x-payment-signature` (constant-time HMAC-SHA256) and processes payment outcomes (`401 Unauthorized` on invalid signature).
- `GET /api/v1/payments/order/:orderId` — Retrieves the payment transaction ledger entry for an order (`404 Not Found` if missing).
- `POST /api/v1/payments/:orderId/refund` — Executes a simulated refund on a `SUCCEEDED` transaction (`409 Conflict` if not in `SUCCEEDED` state).

### 3.3 Cloud Pub/Sub Event Contracts
- **Subscribes to (`cloudmart.inventory.events`)**:
  - `inventory.reserved`: Creates a simulated `PaymentIntent` (`INTENT_CREATED`) and publishes `payment.intent_created`.
- **Publishes to (`cloudmart.payments.events`)**:
  - `payment.intent_created`
  - `payment.succeeded`
  - `payment.failed`

## 4. Running Tests

```bash
node --test apps/payment-service/test/payment.spec.mjs
```
