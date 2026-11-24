# CloudMart — Cart Service (`@cloudmart/cart-service`)

The **Cart Service** manages customer shopping carts, line-item quantity mutations, subtotal computation, checkout snapshot locking, and event-driven cart lifecycle transitions.

## 1. Domain Responsibilities & Boundaries
- **Owns (`cart_db`)**: `carts`, `cart_items`, `processed_events`.
- **Does NOT Own**: Catalog inventory levels, order persistence, payment transactions, or customer notifications.
- **Database Isolation**: Connects exclusively to `cart_db` via the dedicated `svc_cart` role (`DATABASE_URL`). Never queries `product_db` or `order_db` directly; validates SKUs and authoritative pricing exclusively via the **Product Service** API/gRPC contract.

## 2. Environment Configuration

| Variable | Required | Default (Dev) | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `test`, `staging`, `production`) |
| `PORT` | No | `3002` | HTTP REST server port |
| `GRPC_URL` | No | `0.0.0.0:50052` | gRPC server bind address for Cart snapshot queries |
| `PRODUCT_GRPC_URL` | No | `product-service:50051` | Product Service gRPC endpoint |
| `PRODUCT_SERVICE_URL` | No | `http://localhost:3001` | Product Service REST endpoint |
| `DATABASE_URL` | **Yes (Prod)** | — | PostgreSQL connection URL for `cart_db` (from Secret Manager) |
| `CART_TTL_HOURS` | No | `24` | Active shopping cart expiration window in hours |

## 3. Documented APIs

### 3.1 HTTP REST Endpoints
- `GET /healthz` — Kubernetes liveness probe.
- `GET /readyz` — Kubernetes readiness probe.
- `GET /api/v1/carts/:userId` — Gets or initializes the user's active shopping cart.
- `POST /api/v1/carts/:userId/items` — Validates SKU and stock with Product Service and adds line item (`400 Bad Request` on invalid DTO, `404 Not Found` on missing product, `422 Unprocessable Entity` on insufficient stock, `409 Conflict` if cart is locked for checkout).
- `PATCH /api/v1/carts/:userId/items/:productId` — Updates line-item quantity after re-validating stock with Product Service.
- `DELETE /api/v1/carts/:userId/items/:productId` — Removes a line item from the cart.
- `POST /api/v1/carts/:userId/lock` — Locks the cart (`LOCKED_FOR_CHECKOUT`) and returns an immutable snapshot for **Order Service**.

### 3.2 Synchronous gRPC Interface (`cart.proto`)
- `CartGrpcService.GetAndLockCartSnapshot(GetAndLockCartSnapshotRequest) returns (CartSnapshotResponse)`

### 3.3 Cloud Pub/Sub Event Contracts
- **Subscribes to (`cloudmart.orders.events`)**:
  - `order.confirmed`: Clears cart items and transitions status to `CHECKED_OUT`.
  - `order.cancelled`: Compensating transition — unlocks cart from `LOCKED_FOR_CHECKOUT` back to `ACTIVE`.

## 4. Running Tests

```bash
node --test apps/cart-service/test/cart.spec.mjs
```
