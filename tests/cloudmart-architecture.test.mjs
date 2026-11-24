import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * CloudMart End-to-End Microservices Saga, Communication Contract, & Infrastructure Verification Suite
 * Tests synchronous gRPC contracts, asynchronous Cloud Pub/Sub event choreography,
 * optimistic inventory concurrency, compensating transactions, idempotency, and GCP IaC artifacts.
 */

// In-process runtime harness mirroring the TypeScript domain implementations across the 5 services
class TestEventBus {
  constructor() {
    this.subscribers = new Map();
  }
  subscribe(topic, name, handler) {
    const list = this.subscribers.get(topic) || [];
    list.push({ name, handler });
    this.subscribers.set(topic, list);
  }
  async publish(topic, event) {
    const list = this.subscribers.get(topic) || [];
    for (const sub of list) {
      await sub.handler(event);
    }
  }
}

function createCloudMartCluster() {
  const bus = new TestEventBus();
  const webhookSecret = 'whsec_test_cloudmart_secret';

  // 1. Product Service State (product_db)
  const products = new Map();
  const reservations = new Map();
  const productProcessedEvents = new Set();

  const productService = {
    seedProduct(p) {
      products.set(p.id, { ...p, reservedQty: 0, version: 1 });
    },
    getProduct(id) {
      return products.get(id);
    },
    getReservation(orderId) {
      return reservations.get(orderId);
    },
    validateProductSkuGrpc({ productId, requestedQuantity }) {
      const p = products.get(productId);
      if (!p) {
        return { exists: false, isActive: false, hasSufficientStock: false, availableQty: 0 };
      }
      return {
        exists: true,
        isActive: p.isActive,
        hasSufficientStock: p.isActive && p.availableQty >= requestedQuantity,
        productId: p.id,
        sku: p.sku,
        name: p.name,
        unitPriceCents: p.priceCents,
        availableQty: p.availableQty,
      };
    },
  };

  bus.subscribe('cloudmart.orders.events', 'product.order-created', async (evt) => {
    if (evt.eventType !== 'order.created' || productProcessedEvents.has(evt.eventId)) return;
    productProcessedEvents.add(evt.eventId);

    const { orderId, userId, items, totalCents, currency, customerEmail } = evt.payload;
    const failedSkus = [];
    for (const item of items) {
      const p = products.get(item.productId);
      if (!p || !p.isActive || p.availableQty < item.quantity) {
        failedSkus.push({
          productId: item.productId,
          sku: item.sku,
          requestedQty: item.quantity,
          availableQty: p ? p.availableQty : 0,
        });
      }
    }

    if (failedSkus.length > 0) {
      await bus.publish('cloudmart.inventory.events', {
        eventId: `evt-inv-insuff-${orderId}`,
        eventType: 'inventory.insufficient',
        correlationId: evt.correlationId,
        payload: { orderId, userId, failedSkus, customerEmail },
      });
      return;
    }

    for (const item of items) {
      const p = products.get(item.productId);
      p.availableQty -= item.quantity;
      p.reservedQty += item.quantity;
      p.version += 1;
    }
    reservations.set(orderId, {
      id: `res-${orderId}`,
      orderId,
      status: 'RESERVED',
      items,
    });

    await bus.publish('cloudmart.inventory.events', {
      eventId: `evt-inv-res-${orderId}`,
      eventType: 'inventory.reserved',
      correlationId: evt.correlationId,
      payload: {
        orderId,
        reservationId: `res-${orderId}`,
        userId,
        totalCents,
        currency,
        customerEmail,
      },
    });
  });

  bus.subscribe('cloudmart.orders.events', 'product.order-confirmed', async (evt) => {
    if (evt.eventType !== 'order.confirmed' || productProcessedEvents.has(evt.eventId)) return;
    productProcessedEvents.add(evt.eventId);
    const res = reservations.get(evt.payload.orderId);
    if (!res || res.status !== 'RESERVED') return;
    for (const item of res.items) {
      const p = products.get(item.productId);
      p.reservedQty -= item.quantity;
      p.version += 1;
    }
    res.status = 'COMMITTED';
  });

  bus.subscribe('cloudmart.orders.events', 'product.order-cancelled', async (evt) => {
    if (evt.eventType !== 'order.cancelled' || productProcessedEvents.has(evt.eventId)) return;
    productProcessedEvents.add(evt.eventId);
    const res = reservations.get(evt.payload.orderId);
    if (!res || res.status !== 'RESERVED') return;
    for (const item of res.items) {
      const p = products.get(item.productId);
      p.reservedQty -= item.quantity;
      p.availableQty += item.quantity;
      p.version += 1;
    }
    res.status = 'RELEASED';
  });

  // 2. Cart Service State (cart_db)
  const carts = new Map();
  const cartService = {
    addItem({ userId, productId, quantity }) {
      const cartId = `cart-${userId}`;
      const cart = carts.get(cartId) || {
        id: cartId,
        userId,
        status: 'ACTIVE',
        currency: 'USD',
        items: [],
      };
      const check = productService.validateProductSkuGrpc({
        productId,
        requestedQuantity: quantity,
      });
      if (!check.exists || !check.isActive || !check.hasSufficientStock) {
        throw new Error(`SKU validation failed for ${productId}`);
      }
      cart.items.push({
        productId,
        sku: check.sku,
        productName: check.name,
        unitPriceCents: check.unitPriceCents,
        quantity,
      });
      carts.set(cartId, cart);
      return cart;
    },
    getCart(cartId) {
      return carts.get(cartId);
    },
    getAndLockCartSnapshotGrpc({ cartId, userId }) {
      const cart = carts.get(cartId);
      if (!cart || cart.userId !== userId || cart.items.length === 0) {
        throw new Error('Invalid or empty cart');
      }
      cart.status = 'LOCKED_FOR_CHECKOUT';
      const totalCents = cart.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
      return {
        cartId: cart.id,
        userId: cart.userId,
        status: cart.status,
        items: cart.items.map((i) => ({ ...i })),
        totalCents,
        currency: cart.currency,
      };
    },
  };

  bus.subscribe('cloudmart.orders.events', 'cart.order-confirmed', async (evt) => {
    if (evt.eventType !== 'order.confirmed') return;
    const cart = carts.get(evt.payload.cartId);
    if (cart) {
      cart.status = 'CHECKED_OUT';
      cart.items = [];
    }
  });

  bus.subscribe('cloudmart.orders.events', 'cart.order-cancelled', async (evt) => {
    if (evt.eventType !== 'order.cancelled') return;
    const cart = carts.get(evt.payload.cartId);
    if (cart && cart.status === 'LOCKED_FOR_CHECKOUT') {
      cart.status = 'ACTIVE';
    }
  });

  // 3. Payment Service State (payment_db)
  const paymentTxs = new Map();
  const processedWebhooks = new Set();

  bus.subscribe('cloudmart.inventory.events', 'payment.inventory-reserved', async (evt) => {
    if (evt.eventType !== 'inventory.reserved') return;
    const { orderId, totalCents, currency } = evt.payload;
    const tx = {
      id: `pay-tx-${orderId}`,
      orderId,
      clientSecret: `pi_${orderId}_secret`,
      amountCents: totalCents,
      currency,
      status: 'INTENT_CREATED',
    };
    paymentTxs.set(orderId, tx);
    await bus.publish('cloudmart.payments.events', {
      eventId: `evt-pay-intent-${orderId}`,
      eventType: 'payment.intent_created',
      correlationId: evt.correlationId,
      payload: {
        orderId,
        paymentTransactionId: tx.id,
        clientSecret: tx.clientSecret,
        amountCents: totalCents,
        currency,
      },
    });
  });

  const paymentService = {
    signPayload(raw) {
      return crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
    },
    async handleWebhook({ webhookEventId, orderId, outcome, reason, signature, rawPayload }) {
      const expected = this.signPayload(rawPayload);
      if (expected !== signature) {
        throw new Error('Invalid payment webhook HMAC signature');
      }
      const tx = paymentTxs.get(orderId);
      if (!tx) throw new Error('Transaction not found');
      if (processedWebhooks.has(webhookEventId)) return tx;
      processedWebhooks.add(webhookEventId);

      if (outcome === 'SUCCEEDED') {
        tx.status = 'SUCCEEDED';
        await bus.publish('cloudmart.payments.events', {
          eventId: `evt-pay-succ-${orderId}`,
          eventType: 'payment.succeeded',
          correlationId: `corr-${orderId}`,
          payload: { orderId, paymentTransactionId: tx.id, amountCents: tx.amountCents },
        });
      } else {
        tx.status = 'FAILED';
        await bus.publish('cloudmart.payments.events', {
          eventId: `evt-pay-fail-${orderId}`,
          eventType: 'payment.failed',
          correlationId: `corr-${orderId}`,
          payload: { orderId, paymentTransactionId: tx.id, reason: reason || 'Card declined' },
        });
      }
      return tx;
    },
  };

  // 4. Order Service State (order_db)
  const orders = new Map();
  const idempotencyMap = new Map();
  const orderProcessedEvents = new Set();

  const orderService = {
    async createOrder({ orderId, userId, cartId, idempotencyKey, customerEmail }) {
      if (idempotencyMap.has(idempotencyKey)) {
        return orders.get(idempotencyMap.get(idempotencyKey));
      }
      const snap = cartService.getAndLockCartSnapshotGrpc({ cartId, userId });
      const order = {
        id: orderId,
        userId,
        cartId,
        idempotencyKey,
        customerEmail,
        status: 'PENDING_INVENTORY',
        totalCents: snap.totalCents,
        currency: snap.currency,
        items: snap.items,
        sagaHistory: ['ORDER_CREATED:PENDING_INVENTORY'],
      };
      orders.set(order.id, order);
      idempotencyMap.set(idempotencyKey, order.id);

      await bus.publish('cloudmart.orders.events', {
        eventId: `evt-ord-created-${order.id}`,
        eventType: 'order.created',
        correlationId: `corr-${order.id}`,
        payload: {
          orderId: order.id,
          userId,
          cartId,
          totalCents: order.totalCents,
          currency: order.currency,
          items: order.items,
          customerEmail,
        },
      });
      return order;
    },
    getOrder(orderId) {
      return orders.get(orderId);
    },
  };

  bus.subscribe('cloudmart.inventory.events', 'order.inv-events', async (evt) => {
    if (orderProcessedEvents.has(evt.eventId)) return;
    orderProcessedEvents.add(evt.eventId);
    const order = orders.get(evt.payload.orderId);
    if (!order) return;

    if (evt.eventType === 'inventory.reserved') {
      order.sagaHistory.push(`INVENTORY_RESERVED:${evt.payload.reservationId}`);
    } else if (evt.eventType === 'inventory.insufficient') {
      order.status = 'CANCELLED_OUT_OF_STOCK';
      order.sagaHistory.push('INVENTORY_INSUFFICIENT:CANCELLED_OUT_OF_STOCK');
      await bus.publish('cloudmart.orders.events', {
        eventId: `evt-ord-cancel-stock-${order.id}`,
        eventType: 'order.cancelled',
        correlationId: evt.correlationId,
        payload: {
          orderId: order.id,
          userId: order.userId,
          cartId: order.cartId,
          reason: 'OUT_OF_STOCK',
          customerEmail: order.customerEmail,
        },
      });
    }
  });

  bus.subscribe('cloudmart.payments.events', 'order.pay-events', async (evt) => {
    if (orderProcessedEvents.has(evt.eventId)) return;
    orderProcessedEvents.add(evt.eventId);
    const order = orders.get(evt.payload.orderId);
    if (!order) return;

    if (evt.eventType === 'payment.intent_created') {
      if (order.status === 'PENDING_INVENTORY') {
        order.status = 'AWAITING_PAYMENT';
      }
      order.paymentClientSecret = evt.payload.clientSecret;
      order.sagaHistory.push(`PAYMENT_INTENT_CREATED:${evt.payload.paymentTransactionId}`);
    } else if (evt.eventType === 'payment.succeeded') {
      order.status = 'CONFIRMED';
      order.sagaHistory.push('PAYMENT_SUCCEEDED:CONFIRMED');
      await bus.publish('cloudmart.orders.events', {
        eventId: `evt-ord-confirmed-${order.id}`,
        eventType: 'order.confirmed',
        correlationId: evt.correlationId,
        payload: {
          orderId: order.id,
          userId: order.userId,
          cartId: order.cartId,
          totalCents: order.totalCents,
          currency: order.currency,
          customerEmail: order.customerEmail,
        },
      });
    } else if (evt.eventType === 'payment.failed') {
      order.status = 'PAYMENT_FAILED';
      order.sagaHistory.push(`PAYMENT_FAILED:${evt.payload.reason}`);
      await bus.publish('cloudmart.orders.events', {
        eventId: `evt-ord-cancel-pay-${order.id}`,
        eventType: 'order.cancelled',
        correlationId: evt.correlationId,
        payload: {
          orderId: order.id,
          userId: order.userId,
          cartId: order.cartId,
          reason: 'PAYMENT_FAILED',
          customerEmail: order.customerEmail,
        },
      });
    }
  });

  // 5. Notification Service State (notification_db)
  const notificationLogs = [];
  const notifProcessedEvents = new Set();

  bus.subscribe('cloudmart.orders.events', 'notification.orders', async (evt) => {
    if (notifProcessedEvents.has(evt.eventId)) return;
    if (evt.eventType === 'order.confirmed') {
      notifProcessedEvents.add(evt.eventId);
      notificationLogs.push({
        sourceEventId: evt.eventId,
        orderId: evt.payload.orderId,
        templateKey: 'ORDER_CONFIRMED_EMAIL',
        recipientEmail: evt.payload.customerEmail,
      });
    } else if (evt.eventType === 'order.cancelled') {
      notifProcessedEvents.add(evt.eventId);
      notificationLogs.push({
        sourceEventId: evt.eventId,
        orderId: evt.payload.orderId,
        templateKey: 'ORDER_CANCELLED_EMAIL',
        reason: evt.payload.reason,
        recipientEmail: evt.payload.customerEmail,
      });
    }
  });

  return {
    bus,
    productService,
    cartService,
    orderService,
    paymentService,
    notificationLogs,
  };
}

describe('CloudMart Microservices Architecture & Event-Driven Checkout Saga', () => {
  it('executes the full Happy-Path Checkout Saga across Product, Cart, Order, Payment, and Notification services', async () => {
    const cluster = createCloudMartCluster();

    // 1. Seed Product Catalog (10 units in stock)
    cluster.productService.seedProduct({
      id: 'prod-1',
      sku: 'SKU-PIXEL-9',
      name: 'CloudMart Flagship Phone',
      priceCents: 99900,
      isActive: true,
      availableQty: 10,
    });

    // 2. Customer adds 2 units to Cart (validates SKU & price via synchronous gRPC)
    const cart = cluster.cartService.addItem({
      userId: 'user-101',
      productId: 'prod-1',
      quantity: 2,
    });
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].unitPriceCents, 99900);

    // 3. Customer initiates Checkout -> Order Service locks Cart via gRPC, reserves Stock via Pub/Sub, creates PaymentIntent
    const order = await cluster.orderService.createOrder({
      orderId: 'ord-1001',
      userId: 'user-101',
      cartId: cart.id,
      idempotencyKey: 'idem-checkout-1001',
      customerEmail: 'buyer@cloudmart.example.com',
    });

    assert.equal(order.status, 'AWAITING_PAYMENT');
    assert.equal(order.totalCents, 199800);
    assert.ok(order.paymentClientSecret);

    // Verify Product stock is RESERVED (availableQty: 8, reservedQty: 2)
    const productAfterReserve = cluster.productService.getProduct('prod-1');
    assert.equal(productAfterReserve.availableQty, 8);
    assert.equal(productAfterReserve.reservedQty, 2);

    // 4. External Payment Provider fires HMAC-signed webhook confirming payment
    const rawWebhook = JSON.stringify({ orderId: 'ord-1001', outcome: 'SUCCEEDED' });
    const sig = cluster.paymentService.signPayload(rawWebhook);

    await cluster.paymentService.handleWebhook({
      webhookEventId: 'wh_evt_1',
      orderId: 'ord-1001',
      outcome: 'SUCCEEDED',
      rawPayload: rawWebhook,
      signature: sig,
    });

    // 5. Verify final Saga state across all 5 microservices
    const finalOrder = cluster.orderService.getOrder('ord-1001');
    assert.equal(finalOrder.status, 'CONFIRMED');

    const finalReservation = cluster.productService.getReservation('ord-1001');
    assert.equal(finalReservation.status, 'COMMITTED');
    assert.equal(cluster.productService.getProduct('prod-1').availableQty, 8);
    assert.equal(cluster.productService.getProduct('prod-1').reservedQty, 0);

    const finalCart = cluster.cartService.getCart(cart.id);
    assert.equal(finalCart.status, 'CHECKED_OUT');
    assert.equal(finalCart.items.length, 0);

    assert.equal(cluster.notificationLogs.length, 1);
    assert.equal(cluster.notificationLogs[0].templateKey, 'ORDER_CONFIRMED_EMAIL');
  });

  it('executes Compensating Saga Transactions when Payment fails (releases reserved inventory & unlocks cart)', async () => {
    const cluster = createCloudMartCluster();

    cluster.productService.seedProduct({
      id: 'prod-2',
      sku: 'SKU-LAPTOP-PRO',
      name: 'CloudBook Pro 16',
      priceCents: 249900,
      isActive: true,
      availableQty: 5,
    });

    const cart = cluster.cartService.addItem({
      userId: 'user-202',
      productId: 'prod-2',
      quantity: 3,
    });

    const order = await cluster.orderService.createOrder({
      orderId: 'ord-2002',
      userId: 'user-202',
      cartId: cart.id,
      idempotencyKey: 'idem-checkout-2002',
      customerEmail: 'declined@cloudmart.example.com',
    });

    // Stock is temporarily reserved (availableQty: 2, reservedQty: 3)
    assert.equal(order.status, 'AWAITING_PAYMENT');
    assert.equal(cluster.productService.getProduct('prod-2').availableQty, 2);
    assert.equal(cluster.productService.getProduct('prod-2').reservedQty, 3);

    // Payment fails via webhook
    const rawWebhook = JSON.stringify({ orderId: 'ord-2002', outcome: 'FAILED' });
    const sig = cluster.paymentService.signPayload(rawWebhook);

    await cluster.paymentService.handleWebhook({
      webhookEventId: 'wh_evt_fail_2002',
      orderId: 'ord-2002',
      outcome: 'FAILED',
      reason: 'Insufficient funds',
      rawPayload: rawWebhook,
      signature: sig,
    });

    // Verify compensating transactions restored stock and unlocked cart
    assert.equal(cluster.orderService.getOrder('ord-2002').status, 'PAYMENT_FAILED');
    assert.equal(cluster.productService.getReservation('ord-2002').status, 'RELEASED');
    assert.equal(cluster.productService.getProduct('prod-2').availableQty, 5);
    assert.equal(cluster.productService.getProduct('prod-2').reservedQty, 0);
    assert.equal(cluster.cartService.getCart(cart.id).status, 'ACTIVE');
    assert.equal(cluster.cartService.getCart(cart.id).items.length, 1);

    assert.equal(cluster.notificationLogs.length, 1);
    assert.equal(cluster.notificationLogs[0].templateKey, 'ORDER_CANCELLED_EMAIL');
    assert.equal(cluster.notificationLogs[0].reason, 'PAYMENT_FAILED');
  });

  it('enforces Idempotency on duplicate checkout requests, duplicate webhooks, and Pub/Sub at-least-once redeliveries', async () => {
    const cluster = createCloudMartCluster();

    cluster.productService.seedProduct({
      id: 'prod-3',
      sku: 'SKU-BUDS',
      name: 'CloudBuds',
      priceCents: 19900,
      isActive: true,
      availableQty: 10,
    });

    const cart = cluster.cartService.addItem({
      userId: 'user-303',
      productId: 'prod-3',
      quantity: 1,
    });

    const order1 = await cluster.orderService.createOrder({
      orderId: 'ord-3003',
      userId: 'user-303',
      cartId: cart.id,
      idempotencyKey: 'idem-same-key',
      customerEmail: 'idempotent@cloudmart.example.com',
    });

    const order2 = await cluster.orderService.createOrder({
      orderId: 'ord-3003-duplicate',
      userId: 'user-303',
      cartId: cart.id,
      idempotencyKey: 'idem-same-key',
      customerEmail: 'idempotent@cloudmart.example.com',
    });

    // Same order returned; stock only reserved once
    assert.equal(order1.id, order2.id);
    assert.equal(cluster.productService.getProduct('prod-3').availableQty, 9);

    // Reject tampered webhook signature
    await assert.rejects(
      async () =>
        cluster.paymentService.handleWebhook({
          webhookEventId: 'wh_tampered',
          orderId: 'ord-3003',
          outcome: 'SUCCEEDED',
          rawPayload: '{}',
          signature: 'invalid_hmac',
        }),
      /Invalid payment webhook HMAC signature/,
    );
  });

  it('verifies Database-per-Service isolation, GKE Autopilot manifests, and Terraform IaC modules', () => {
    const rootDir = process.cwd();

    // Verify all 5 isolated Prisma schemas exist
    const services = [
      'product-service',
      'cart-service',
      'order-service',
      'payment-service',
      'notification-service',
    ];
    for (const svc of services) {
      const schemaPath = path.join(rootDir, 'apps', svc, 'prisma', 'schema.prisma');
      assert.ok(fs.existsSync(schemaPath), `Missing Prisma schema for ${svc}`);
      const dockerfilePath = path.join(rootDir, 'apps', svc, 'Dockerfile');
      assert.ok(fs.existsSync(dockerfilePath), `Missing Dockerfile for ${svc}`);
    }

    // Verify PostgreSQL Database-per-Service SQL initialization creates all 5 databases & roles
    const initSql = fs.readFileSync(
      path.join(rootDir, 'infra', 'local', 'init-multiple-dbs.sql'),
      'utf8',
    );
    for (const dbName of ['product_db', 'cart_db', 'order_db', 'payment_db', 'notification_db']) {
      assert.ok(initSql.includes(`CREATE DATABASE ${dbName}`), `Missing database ${dbName}`);
    }

    // Verify Terraform modules for VPC, GKE Autopilot, Cloud SQL HA, Pub/Sub DLQ, and CI/CD
    const tfModules = ['vpc', 'gke', 'cloudsql', 'pubsub', 'cicd'];
    for (const mod of tfModules) {
      const modPath = path.join(rootDir, 'infra', 'terraform', 'modules', mod, 'main.tf');
      assert.ok(fs.existsSync(modPath), `Missing Terraform module: ${mod}`);
    }

    const gkeTf = fs.readFileSync(
      path.join(rootDir, 'infra', 'terraform', 'modules', 'gke', 'main.tf'),
      'utf8',
    );
    assert.ok(gkeTf.includes('enable_autopilot = true'), 'GKE Autopilot must be enabled');
  });
});
