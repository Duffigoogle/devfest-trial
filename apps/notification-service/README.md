# CloudMart — Notification Service (`@cloudmart/notification-service`)

The **Notification Service** handles asynchronous, idempotent multi-channel customer communications (Email and SMS), template rendering, and delivery audit logging.

## 1. Domain Responsibilities & Boundaries
- **Owns (`notification_db`)**: `notification_templates`, `notification_logs`, `processed_events`.
- **Does NOT Own**: Catalog inventory, shopping carts, order lifecycles, or payment processing. Failures in Notification Service never roll back confirmed orders or payments.
- **Database Isolation**: Connects exclusively to `notification_db` via the dedicated `svc_notification` role (`DATABASE_URL`).

## 2. Environment Configuration

| Variable | Required | Default (Dev) | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `test`, `staging`, `production`) |
| `PORT` | No | `3005` | HTTP REST server listening port |
| `DATABASE_URL` | **Yes (Prod)** | — | PostgreSQL connection URL for `notification_db` (from Secret Manager) |
| `NOTIFICATION_SENDER_EMAIL` | No | `no-reply@cloudmart.example.com` | Validated sender email address |
| `GCP_PROJECT_ID` | No | `cloudmart-local` | Google Cloud project ID for Cloud Pub/Sub and Cloud Trace |

## 3. Documented APIs

### 3.1 HTTP REST Endpoints
- `GET /healthz` — Kubernetes liveness probe.
- `GET /readyz` — Kubernetes readiness probe.
- `GET /api/v1/notifications?recipientUserId=<userId>` — Lists dispatched notification audit logs.
- `GET /api/v1/notifications/order/:orderId` — Lists all notifications dispatched for a specific order.
- `POST /api/v1/notifications/send` — Dispatches a validated manual notification (`SendNotificationDto`) and returns `201 Created` (`400 Bad Request` on invalid email, channel, or template key).

### 3.2 Cloud Pub/Sub Event Contracts
- **Subscribes to (`cloudmart.orders.events`)**:
  - `order.confirmed`: Dispatches `ORDER_CONFIRMED_EMAIL` (deduplicated by `eventId`).
  - `order.cancelled`: Dispatches `ORDER_CANCELLED_EMAIL` with cancellation reason (deduplicated by `eventId`).

## 4. Running Tests

```bash
node --test apps/notification-service/test/notification.spec.mjs
```
