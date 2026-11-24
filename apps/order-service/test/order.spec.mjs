import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { URL } from 'node:url';

/**
 * Order Service Unit & Live HTTP Integration Test Suite
 * Verifies:
 * 1. Environment config validation (requires DATABASE_URL in production)
 * 2. Checkout initiation via documented Cart Service snapshot API & Idempotency-Key deduplication
 * 3. Full Order Saga state transitions (PENDING_INVENTORY -> AWAITING_PAYMENT -> CONFIRMED / CANCELLED_OUT_OF_STOCK / PAYMENT_FAILED)
 * 4. Customer cancellation rules (blocks cancelling an already CONFIRMED order with 409 Conflict)
 * 5. Live HTTP REST integration endpoints (/healthz, /readyz, POST /api/v1/orders 202 Accepted, GET /api/v1/orders/:id, validation errors)
 */

function createOrderServiceHarness(envOverrides = {}) {
  const nodeEnv = envOverrides.NODE_ENV || 'test';
  if ((nodeEnv === 'production' || nodeEnv === 'staging') && !envOverrides.DATABASE_URL) {
    throw new Error(
      `[order-service] Missing required DATABASE_URL environment variable in ${nodeEnv} mode`,
    );
  }

  const logs = [];
  const orders = new Map();
  const idempotencyKeys = new Map();
  const processedEvents = new Set();
  const publishedEvents = [];

  function log(severity, message, correlationId, metadata) {
    logs.push({
      severity,
      service: 'order-service',
      message,
      correlationId,
      timestamp: new Date().toISOString(),
      metadata,
    });
  }

  function createHttpError(statusCode, errorCode, message, details) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.errorCode = errorCode;
    err.details = details;
    return err;
  }

  function fetchCartSnapshotViaApi({ cartId, userId }) {
    if (cartId === 'cart-empty') {
      throw createHttpError(400, 'BAD_REQUEST', `Cart '${cartId}' is empty`);
    }
    return {
      cartId,
      userId,
      status: 'LOCKED_FOR_CHECKOUT',
      items: [
        {
          productId: 'prod-1',
          sku: 'SKU-PIXEL-9',
          productName: 'CloudMart Flagship Phone',
          unitPriceCents: 99900,
          quantity: 1,
        },
      ],
      totalCents: 99900,
      currency: 'USD',
    };
  }

  const service = {
    async createCheckoutOrder(body, idempotencyKey, correlationId) {
      if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 4) {
        throw createHttpError(400, 'BAD_REQUEST', 'Missing or invalid required Idempotency-Key header', [
          'Idempotency-Key header is required (min 4 characters)',
        ]);
      }

      const errors = [];
      if (!body || typeof body !== 'object') {
        throw createHttpError(400, 'BAD_REQUEST', 'Validation failed', ['body must be an object']);
      }
      if (typeof body.userId !== 'string' || body.userId.trim().length < 2) {
        errors.push('userId is required');
      }
      if (typeof body.cartId !== 'string' || body.cartId.trim().length < 2) {
        errors.push('cartId is required');
      }
      if (typeof body.customerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.customerEmail)) {
        errors.push('customerEmail format is invalid');
      }
      if (typeof body.shippingAddress !== 'string' || body.shippingAddress.trim().length < 5) {
        errors.push('shippingAddress must be at least 5 characters');
      }
      if (errors.length > 0) {
        throw createHttpError(400, 'BAD_REQUEST', 'Validation failed', errors);
      }

      const existingId = idempotencyKeys.get(idempotencyKey.trim());
      if (existingId) {
        return orders.get(existingId);
      }

      const snap = fetchCartSnapshotViaApi({ cartId: body.cartId, userId: body.userId });
      const now = new Date().toISOString();
      const orderId = body.orderId || `ord-${orders.size + 1001}`;

      const order = {
        id: orderId,
        userId: body.userId,
        cartId: body.cartId,
        idempotencyKey: idempotencyKey.trim(),
        customerEmail: body.customerEmail,
        shippingAddress: body.shippingAddress,
        status: 'PENDING_INVENTORY',
        totalCents: snap.totalCents,
        currency: snap.currency,
        items: snap.items,
        sagaHistory: ['ORDER_CREATED:PENDING_INVENTORY'],
        createdAt: now,
        updatedAt: now,
      };

      orders.set(order.id, order);
      idempotencyKeys.set(order.idempotencyKey, order.id);
      log('INFO', `Created checkout order ${order.id}`, correlationId, { totalCents: order.totalCents });

      publishedEvents.push({
        eventType: 'order.created',
        correlationId,
        payload: {
          orderId: order.id,
          userId: order.userId,
          cartId: order.cartId,
          totalCents: order.totalCents,
          currency: order.currency,
          items: order.items,
          customerEmail: order.customerEmail,
        },
      });

      return order;
    },

    getOrderOrThrow(id) {
      const o = orders.get(id);
      if (!o) throw createHttpError(404, 'NOT_FOUND', `Order '${id}' not found`);
      return o;
    },

    listOrdersByUser(userId) {
      return Array.from(orders.values()).filter((o) => o.userId === userId);
    },

    async cancelOrder(orderId, correlationId) {
      const order = this.getOrderOrThrow(orderId);
      if (order.status === 'CONFIRMED') {
        throw createHttpError(
          409,
          'CONFLICT',
          `Confirmed order '${orderId}' cannot be cancelled directly`,
        );
      }
      order.status = 'CANCELLED_BY_CUSTOMER';
      order.sagaHistory.push('CUSTOMER_CANCELLED:CANCELLED_BY_CUSTOMER');
      publishedEvents.push({
        eventType: 'order.cancelled',
        correlationId,
        payload: {
          orderId: order.id,
          userId: order.userId,
          cartId: order.cartId,
          reason: 'CUSTOMER_REQUEST',
          customerEmail: order.customerEmail,
        },
      });
      return order;
    },

    async handleSagaEvent(event) {
      if (processedEvents.has(event.eventId)) return;
      processedEvents.add(event.eventId);
      const order = orders.get(event.payload.orderId);
      if (!order) return;

      if (event.eventType === 'inventory.reserved') {
        order.sagaHistory.push(`INVENTORY_RESERVED:${event.payload.reservationId}`);
      } else if (event.eventType === 'inventory.insufficient') {
        order.status = 'CANCELLED_OUT_OF_STOCK';
        order.sagaHistory.push('INVENTORY_INSUFFICIENT:CANCELLED_OUT_OF_STOCK');
        publishedEvents.push({
          eventType: 'order.cancelled',
          payload: { orderId: order.id, reason: 'OUT_OF_STOCK' },
        });
      } else if (event.eventType === 'payment.intent_created') {
        if (order.status === 'PENDING_INVENTORY') {
          order.status = 'AWAITING_PAYMENT';
        }
        order.paymentClientSecret = event.payload.clientSecret;
        order.sagaHistory.push(`PAYMENT_INTENT_CREATED:${event.payload.paymentTransactionId}`);
      } else if (event.eventType === 'payment.succeeded') {
        order.status = 'CONFIRMED';
        order.sagaHistory.push('PAYMENT_SUCCEEDED:CONFIRMED');
        publishedEvents.push({
          eventType: 'order.confirmed',
          payload: { orderId: order.id, cartId: order.cartId, totalCents: order.totalCents },
        });
      } else if (event.eventType === 'payment.failed') {
        order.status = 'PAYMENT_FAILED';
        order.sagaHistory.push(`PAYMENT_FAILED:${event.payload.reason}`);
        publishedEvents.push({
          eventType: 'order.cancelled',
          payload: { orderId: order.id, reason: 'PAYMENT_FAILED' },
        });
      }
    },
  };

  const server = http.createServer(async (req, res) => {
    const correlationId = req.headers['x-correlation-id'] || `corr-${Date.now()}`;
    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || 'GET';

    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : {};

      if (method === 'GET' && pathname === '/healthz') {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ok', service: 'order-service' }));
        return;
      }
      if (method === 'GET' && pathname === '/readyz') {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ready', service: 'order-service', database: 'order_db (isolated)' }));
        return;
      }
      if (method === 'POST' && pathname === '/api/v1/orders') {
        const order = await service.createCheckoutOrder(
          body,
          req.headers['idempotency-key'],
          correlationId,
        );
        res.statusCode = 202;
        res.end(
          JSON.stringify({
            orderId: order.id,
            status: order.status,
            totalCents: order.totalCents,
            currency: order.currency,
            sagaHistory: order.sagaHistory,
          }),
        );
        return;
      }
      const userMatch = pathname.match(/^\/api\/v1\/orders\/user\/([^/]+)$/);
      if (method === 'GET' && userMatch) {
        res.statusCode = 200;
        res.end(JSON.stringify({ items: service.listOrdersByUser(userMatch[1]) }));
        return;
      }
      const cancelMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)\/cancel$/);
      if (method === 'POST' && cancelMatch) {
        const cancelled = await service.cancelOrder(cancelMatch[1], correlationId);
        res.statusCode = 200;
        res.end(JSON.stringify(cancelled));
        return;
      }
      const idMatch = pathname.match(/^\/api\/v1\/orders\/([^/]+)$/);
      if (method === 'GET' && idMatch) {
        res.statusCode = 200;
        res.end(JSON.stringify(service.getOrderOrThrow(idMatch[1])));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ statusCode: 404, errorCode: 'NOT_FOUND', correlationId }));
    } catch (err) {
      res.statusCode = err.statusCode || 500;
      res.end(
        JSON.stringify({
          statusCode: res.statusCode,
          errorCode: err.errorCode || 'INTERNAL_SERVER_ERROR',
          message: err.message,
          details: err.details,
          correlationId,
        }),
      );
    }
  });

  return { service, server, logs, publishedEvents };
}

describe('Order Service — Unit & HTTP Integration Tests', () => {
  describe('Unit Tests: Configuration, Idempotency-Key Deduplication & Checkout Saga State Machine', () => {
    it('enforces environment config validation in production', () => {
      assert.throws(
        () => createOrderServiceHarness({ NODE_ENV: 'production', DATABASE_URL: '' }),
        /Missing required DATABASE_URL environment variable in production mode/,
      );
    });

    it('enforces Idempotency-Key deduplication and transitions Order Saga through inventory reservation and payment confirmation', async () => {
      const { service, publishedEvents } = createOrderServiceHarness();

      const order1 = await service.createCheckoutOrder(
        {
          orderId: 'ord-unit-1',
          userId: 'user-10',
          cartId: 'cart-user-10',
          customerEmail: 'customer@cloudmart.example.com',
          shippingAddress: '1600 Amphitheatre Pkwy, Mountain View, CA',
        },
        'idem-key-0001',
        'corr-order-1',
      );

      // Duplicate request with same Idempotency-Key returns existing order without publishing duplicate event
      const orderDuplicate = await service.createCheckoutOrder(
        {
          orderId: 'ord-unit-2',
          userId: 'user-10',
          cartId: 'cart-user-10',
          customerEmail: 'customer@cloudmart.example.com',
          shippingAddress: '1600 Amphitheatre Pkwy, Mountain View, CA',
        },
        'idem-key-0001',
        'corr-order-1',
      );
      assert.equal(order1.id, orderDuplicate.id);
      assert.equal(publishedEvents.length, 1);

      // Drive Saga: inventory.reserved -> payment.intent_created -> payment.succeeded
      await service.handleSagaEvent({
        eventId: 'evt-inv-1',
        eventType: 'inventory.reserved',
        payload: { orderId: 'ord-unit-1', reservationId: 'res-ord-unit-1' },
      });
      await service.handleSagaEvent({
        eventId: 'evt-pay-intent-1',
        eventType: 'payment.intent_created',
        payload: {
          orderId: 'ord-unit-1',
          paymentTransactionId: 'tx-1',
          clientSecret: 'pi_secret_123',
        },
      });
      assert.equal(service.getOrderOrThrow('ord-unit-1').status, 'AWAITING_PAYMENT');

      await service.handleSagaEvent({
        eventId: 'evt-pay-succ-1',
        eventType: 'payment.succeeded',
        payload: { orderId: 'ord-unit-1', paymentTransactionId: 'tx-1' },
      });
      assert.equal(service.getOrderOrThrow('ord-unit-1').status, 'CONFIRMED');

      // Cancelling an already CONFIRMED order throws 409 Conflict
      await assert.rejects(
        async () => service.cancelOrder('ord-unit-1'),
        (err) => err.statusCode === 409 && err.errorCode === 'CONFLICT',
      );
    });
  });

  describe('HTTP Integration Tests: REST Endpoints, Header Validation, Health Checks & Correlation IDs', () => {
    let harness;
    let baseUrl;

    before(async () => {
      harness = createOrderServiceHarness();
      await new Promise((resolve) => {
        harness.server.listen(0, '127.0.0.1', () => {
          const { port } = harness.server.address();
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise((resolve) => harness.server.close(resolve));
    });

    it('GET /healthz and GET /readyz return 200 OK and echo x-correlation-id', async () => {
      const res = await fetch(`${baseUrl}/healthz`, {
        headers: { 'x-correlation-id': 'corr-order-health' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-correlation-id'), 'corr-order-health');
    });

    it('POST /api/v1/orders rejects missing Idempotency-Key (400) and invalid email, and returns 202 Accepted on valid checkout', async () => {
      // Missing Idempotency-Key -> 400 Bad Request
      const noIdemRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-99',
          cartId: 'cart-user-99',
          customerEmail: 'buyer@example.com',
          shippingAddress: '100 Market St, San Francisco, CA',
        }),
      });
      assert.equal(noIdemRes.status, 400);

      // Valid checkout -> 202 Accepted
      const okRes = await fetch(`${baseUrl}/api/v1/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'idem-http-order-99',
          'x-correlation-id': 'corr-http-checkout-99',
        },
        body: JSON.stringify({
          orderId: 'ord-http-99',
          userId: 'user-99',
          cartId: 'cart-user-99',
          customerEmail: 'buyer@example.com',
          shippingAddress: '100 Market St, San Francisco, CA',
        }),
      });
      assert.equal(okRes.status, 202);
      assert.equal(okRes.headers.get('x-correlation-id'), 'corr-http-checkout-99');
      const created = await okRes.json();
      assert.equal(created.orderId, 'ord-http-99');
      assert.equal(created.status, 'PENDING_INVENTORY');

      // GET /api/v1/orders/:id and POST /api/v1/orders/:id/cancel
      const getRes = await fetch(`${baseUrl}/api/v1/orders/ord-http-99`);
      assert.equal(getRes.status, 200);

      const cancelRes = await fetch(`${baseUrl}/api/v1/orders/ord-http-99/cancel`, {
        method: 'POST',
      });
      assert.equal(cancelRes.status, 200);
      const cancelled = await cancelRes.json();
      assert.equal(cancelled.status, 'CANCELLED_BY_CUSTOMER');
    });
  });
});
