# CloudMart — Cloud-Native E-Commerce Microservices on Google Cloud

CloudMart is an event-driven e-commerce platform architected for **Google Kubernetes Engine (GKE Autopilot)**, **Cloud SQL for PostgreSQL**, and **Google Cloud Pub/Sub**, provisioned via **Terraform** and delivered progressively with **Cloud Build** and **Cloud Deploy**.

## Architecture & Repository Layout

- `libs/shared/`: Shared gRPC Protobuf contracts (`product.proto`, `cart.proto`), Cloud Pub/Sub event schemas (`domain-events.ts`), and OpenTelemetry / Cloud Trace context propagation (`telemetry.ts`).
- `apps/product-service/`: Catalog CRUD, synchronous gRPC SKU/price validation (`ValidateProductSku`), and optimistic-concurrency inventory reservation/release (`product_db`).
- `apps/cart-service/`: Shopping cart management, synchronous gRPC product validation client, gRPC cart snapshot locking (`GetAndLockCartSnapshot`), and Pub/Sub cart clearing (`cart_db`).
- `apps/order-service/`: Order lifecycle state machine and Event-Driven Checkout Saga coordinator (`order_db`).
- `apps/payment-service/`: Idempotent PaymentIntent creation, HMAC-SHA256 webhook verification, and refund compensation (`payment_db`).
- `apps/notification-service/`: Idempotent multi-channel email/SMS notification consumer and audit log (`notification_db`).
- `apps/frontend/`: Next.js storefront with SSR catalog browsing and live Checkout Saga tracker.
- `k8s/`: Kustomize base and `staging`/`prod` overlays for GKE Autopilot (Workload Identity, Cloud SQL Auth Proxy sidecars, Gateway API routes, NetworkPolicies, HPAs, PDBs).
- `infra/terraform/`: Modular Terraform IaC for VPC, GKE Autopilot, Regional HA Cloud SQL for PostgreSQL (5 isolated logical databases), Cloud Pub/Sub with Dead-Letter Queues, and Cloud Deploy.

## Quick Verification

```bash
# Run End-to-End Checkout Saga, Compensating Transaction, Idempotency & IaC Verification Tests
npm test
```
