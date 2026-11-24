# CloudMart — Order Service (`@cloudmart/order-service`)

The **Order Service** owns the customer order lifecycle, immutable line-item price snapshots, checkout idempotency enforcement, and the **Event-Driven Checkout Saga** across Product, Cart, Payment, and Notification services.

## 1. Domain Responsibilities & Boundaries
- **Owns (`order_db`)**: `orders`, `order_items`, `order_saga_state`, `outbox_events`, `processed_events`.
- **Does NOT Own**: Live catalog inventory counts, shopping cart mutations, raw payment ledger entries, or email/SMS delivery.
- **Database Isolation**: Connects exclusively to `order_db` via the dedicated `svc_order` role (`DATABASE_URL`). Locks and snapshots the customer's cart strictly through the documented **Cart Service** API/gRPC interface.

## 2. Environment Configuration

| Variable | Required | Default (Dev) | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `test`, `staging`, `production`) |
| `PORT` | No | `3003` | HTTP REST server listening port |
| `CART_GRPC_URL` | No | `cart-service:50052` | Cart Service gRPC endpoint |
| `CART_SERVICE_URL` | No | `http://localhost:3002` | Cart Service REST endpoint |
| `DATABASE_URL` | **Yes (Prod)** | — | PostgreSQL connection URL for `order_db` (from Secret Manager) |
| `GCP_PROJECT_ID` | No | `cloudmart-local` | Google Cloud project ID for Cloud Pub/Sub and Cloud Trace |

## 3. Documented APIs

### 3.1 HTTP REST Endpoints
- `GET /healthz` — Kubernetes liveness probe.
- `GET /readyz` — Kubernetes readiness probe.
- `POST /api/v1/orders` — Initiates an asynchronous checkout Saga (`202 Accepted`).
  - **Required Header**: `Idempotency-Key` (min 4 characters; returns `400 Bad Request` if missing).
  - **Validated Body (`CreateOrderDto`)**: `userId`, `cartId`, `customerEmail`, `shippingAddress`.
- `GET /api/v1/orders/:id` — Returns current order status, line-item snapshots, `paymentClientSecret`, and `sagaHistory` (`404 Not Found` if missing).
- `GET /api/v1/orders/user/:userId` — Lists all orders belonging to a customer.
- `POST /api/v1/orders/:id/cancel` — Cancels a pending order and publishes `order.cancelled` to trigger compensating stock release (`409 Conflict` if order is already `CONFIRMED`).

### 3.2 Cloud Pub/Sub Event Contracts
- **Publishes to (`cloudmart.orders.events`)**:
  - `order.created`
  - `order.confirmed`
  - `order.cancelled`
- **Subscribes to**:
  - `cloudmart.inventory.events`: `inventory.reserved`, `inventory.insufficient`
  - `cloudmart.payments.events`: `payment.intent_created`, `payment.succeeded`, `payment.failed`

## 4. Running Tests

```bash
node --test apps/order-service/test/order.spec.mjs
```
