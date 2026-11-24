# CloudMart — Product Service (`@cloudmart/product-service`)

The **Product Service** owns the product catalog, category organization, authoritative pricing, and atomic inventory stock reservation/release for the CloudMart e-commerce platform.

## 1. Domain Responsibilities & Boundaries
- **Owns (`product_db`)**: `categories`, `products`, `inventory_stock`, `stock_reservations`, `outbox_events`, `processed_events`.
- **Does NOT Own**: Customer shopping carts, order lifecycles, payment transactions, or customer notifications.
- **Database Isolation**: Connects exclusively to `product_db` using the dedicated `svc_product` role injected via `DATABASE_URL`. Zero cross-database queries.

## 2. Environment Configuration

| Variable | Required | Default (Dev) | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | No | `development` | Runtime environment (`development`, `test`, `staging`, `production`) |
| `PORT` | No | `3001` | HTTP REST server listening port |
| `GRPC_URL` | No | `0.0.0.0:50051` | gRPC server bind address for synchronous SKU validation |
| `DATABASE_URL` | **Yes (Prod)** | — | PostgreSQL connection URL for `product_db` (from Secret Manager) |
| `GCP_PROJECT_ID` | No | `cloudmart-local` | Google Cloud project ID for Cloud Pub/Sub and Cloud Trace |
| `RESERVATION_TTL_MINUTES` | No | `15` | Stock reservation expiration window in minutes |
| `LOG_LEVEL` | No | `INFO` | Structured JSON log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |

## 3. Documented APIs

### 3.1 HTTP REST Endpoints
- `GET /healthz` — Kubernetes liveness probe.
- `GET /readyz` — Kubernetes readiness probe (reports isolated DB & catalog status).
- `GET /api/v1/products?category=<category>` — Lists active catalog products.
- `GET /api/v1/products/:id` — Retrieves a single product by ID (`404 Not Found` if missing).
- `POST /api/v1/products` — Creates a new catalog product with validated `CreateProductDto` (`400 Bad Request` on invalid fields, `409 Conflict` on duplicate SKU).
- `PATCH /api/v1/products/:id/stock` — Adjusts available inventory (`400 Bad Request` if adjustment would drop stock below `0`).
- `POST /api/v1/products/validate-sku` — Synchronous SKU, active status, stock availability, and authoritative price validation endpoint for **Cart Service**.

### 3.2 Synchronous gRPC Interface (`product.proto`)
- `ProductCatalogGrpcService.ValidateProductSku(ValidateProductSkuRequest) returns (ValidateProductSkuResponse)`

### 3.3 Cloud Pub/Sub Event Contracts
- **Subscribes to (`cloudmart.orders.events`)**:
  - `order.created`: Atomically reserves stock across all order items or publishes `inventory.insufficient`.
  - `order.confirmed`: Commits reserved stock permanently.
  - `order.cancelled`: Compensating transaction — releases reserved stock back to available inventory.
- **Publishes to (`cloudmart.inventory.events`)**:
  - `inventory.reserved`
  - `inventory.insufficient`

## 4. Running Tests

```bash
node --test apps/product-service/test/product.spec.mjs
```
