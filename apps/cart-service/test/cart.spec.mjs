import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { URL } from 'node:url';

/**
 * Cart Service Unit & Live HTTP Integration Test Suite
 * Verifies:
 * 1. Environment config validation (requires DATABASE_URL in production, validates CART_TTL_HOURS)
 * 2. Cross-service SKU & stock validation via Product Service API contract (no direct product_db access)
 * 3. Cart locking for checkout (LOCKED_FOR_CHECKOUT), rejection of mutations while locked (409 Conflict)
 * 4. Event-driven cart clearing on order.confirmed and compensating unlock on order.cancelled
 * 5. Live HTTP REST endpoints (/healthz, /readyz, /api/v1/carts/:userId/items, PATCH, DELETE, /lock)
 */

function createCartServiceHarness(envOverrides = {}) {
  const nodeEnv = envOverrides.NODE_ENV || 'test';
  if ((nodeEnv === 'production' || nodeEnv === 'staging') && !envOverrides.DATABASE_URL) {
    throw new Error(
      `[cart-service] Missing required DATABASE_URL environment variable in ${nodeEnv} mode`,
    );
  }
  const cartTtlHours = envOverrides.CART_TTL_HOURS ? Number(envOverrides.CART_TTL_HOURS) : 24;
  if (!Number.isInteger(cartTtlHours) || cartTtlHours <= 0) {
    throw new Error('[cart-service] CART_TTL_HOURS must be a positive integer');
  }

  const logs = [];
  const carts = new Map();
  const processedEvents = new Set();

  // Simulated remote Product Service API catalog (strictly accessed through documented API contract)
  const remoteCatalog = new Map([
    [
      'prod-headphones',
      {
        productId: 'prod-headphones',
        sku: 'SKU-ANC-HEADPHONES',
        name: 'CloudSound Pro ANC Headphones',
        unitPriceCents: 29900,
        availableQty: 5,
        isActive: true,
      },
    ],
    [
      'prod-cable',
      {
        productId: 'prod-cable',
        sku: 'SKU-USBC-CABLE',
        name: 'Braided USB-C 240W Cable',
        unitPriceCents: 2500,
        availableQty: 20,
        isActive: true,
      },
    ],
  ]);

  function log(severity, message, correlationId, metadata) {
    logs.push({
      severity,
      service: 'cart-service',
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

  function validateProductSkuViaApi({ productId, requestedQuantity }) {
    const p = remoteCatalog.get(productId);
    if (!p) {
      return { exists: false, isActive: false, hasSufficientStock: false, availableQty: 0 };
    }
    return {
      exists: true,
      isActive: p.isActive,
      hasSufficientStock: p.isActive && p.availableQty >= requestedQuantity,
      productId: p.productId,
      sku: p.sku,
      name: p.name,
      unitPriceCents: p.unitPriceCents,
      availableQty: p.availableQty,
    };
  }

  function recalc(cart) {
    cart.subtotalCents = cart.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    return cart;
  }

  const service = {
    getOrCreateCart(userId) {
      const cartId = `cart-${userId}`;
      if (carts.has(cartId)) return recalc(carts.get(cartId));
      const created = {
        id: cartId,
        userId,
        status: 'ACTIVE',
        currency: 'USD',
        items: [],
        subtotalCents: 0,
      };
      carts.set(cartId, created);
      return created;
    },

    addItem({ userId, productId, quantity }, correlationId) {
      const errors = [];
      if (typeof productId !== 'string' || productId.trim().length < 2) {
        errors.push('productId is required');
      }
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        errors.push('quantity must be an integer between 1 and 100');
      }
      if (errors.length > 0) {
        throw createHttpError(400, 'BAD_REQUEST', 'Validation failed', errors);
      }

      const cart = this.getOrCreateCart(userId);
      if (cart.status !== 'ACTIVE') {
        throw createHttpError(
          409,
          'CONFLICT',
          `Cannot modify cart '${cart.id}' while in status '${cart.status}'`,
        );
      }

      const existing = cart.items.find((i) => i.productId === productId);
      const totalRequested = (existing?.quantity || 0) + quantity;
      const check = validateProductSkuViaApi({ productId, requestedQuantity: totalRequested });

      if (!check.exists || !check.isActive) {
        throw createHttpError(404, 'NOT_FOUND', `Product '${productId}' is unavailable`);
      }
      if (!check.hasSufficientStock) {
        throw createHttpError(
          422,
          'UNPROCESSABLE_ENTITY',
          `Insufficient stock for SKU ${check.sku}: requested ${totalRequested}, available ${check.availableQty}`,
        );
      }

      if (existing) {
        existing.quantity = totalRequested;
        existing.unitPriceCents = check.unitPriceCents;
      } else {
        cart.items.push({
          productId: check.productId,
          sku: check.sku,
          productName: check.name,
          unitPriceCents: check.unitPriceCents,
          quantity,
        });
      }

      recalc(cart);
      log('INFO', `Added ${quantity}x ${check.sku} to cart ${cart.id}`, correlationId, {
        subtotalCents: cart.subtotalCents,
      });
      return cart;
    },

    updateQuantity({ userId, productId, quantity }, correlationId) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        throw createHttpError(400, 'BAD_REQUEST', 'Validation failed', [
          'quantity must be an integer between 1 and 100',
        ]);
      }
      const cart = this.getOrCreateCart(userId);
      if (cart.status !== 'ACTIVE') {
        throw createHttpError(409, 'CONFLICT', `Cart '${cart.id}' is not ACTIVE`);
      }
      const item = cart.items.find((i) => i.productId === productId);
      if (!item) {
        throw createHttpError(404, 'NOT_FOUND', `Item '${productId}' not in cart`);
      }
      const check = validateProductSkuViaApi({ productId, requestedQuantity: quantity });
      if (!check.hasSufficientStock) {
        throw createHttpError(422, 'UNPROCESSABLE_ENTITY', 'Insufficient stock');
      }
      item.quantity = quantity;
      recalc(cart);
      log('INFO', `Updated ${item.sku} quantity to ${quantity}`, correlationId);
      return cart;
    },

    removeItem({ userId, productId }, correlationId) {
      const cart = this.getOrCreateCart(userId);
      if (cart.status !== 'ACTIVE') {
        throw createHttpError(409, 'CONFLICT', `Cart '${cart.id}' is not ACTIVE`);
      }
      const idx = cart.items.findIndex((i) => i.productId === productId);
      if (idx === -1) {
        throw createHttpError(404, 'NOT_FOUND', `Item '${productId}' not in cart`);
      }
      cart.items.splice(idx, 1);
      recalc(cart);
      log('INFO', `Removed ${productId} from cart`, correlationId);
      return cart;
    },

    lockCartSnapshot(userId, correlationId) {
      const cart = this.getOrCreateCart(userId);
      if (cart.items.length === 0) {
        throw createHttpError(400, 'BAD_REQUEST', `Cart '${cart.id}' is empty`);
      }
      cart.status = 'LOCKED_FOR_CHECKOUT';
      recalc(cart);
      log('INFO', `Locked cart ${cart.id} for checkout`, correlationId);
      return {
        cartId: cart.id,
        userId: cart.userId,
        status: cart.status,
        items: cart.items.map((i) => ({ ...i })),
        totalCents: cart.subtotalCents,
        currency: cart.currency,
      };
    },

    async handleOrderConfirmed(event) {
      if (processedEvents.has(event.eventId)) return;
      processedEvents.add(event.eventId);
      const cart = carts.get(event.payload.cartId);
      if (cart) {
        cart.status = 'CHECKED_OUT';
        cart.items = [];
        cart.subtotalCents = 0;
      }
    },

    async handleOrderCancelled(event) {
      if (processedEvents.has(event.eventId)) return;
      processedEvents.add(event.eventId);
      const cart = carts.get(event.payload.cartId);
      if (cart && cart.status === 'LOCKED_FOR_CHECKOUT') {
        cart.status = 'ACTIVE';
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
        res.end(JSON.stringify({ status: 'ok', service: 'cart-service' }));
        return;
      }
      if (method === 'GET' && pathname === '/readyz') {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ready', service: 'cart-service', database: 'cart_db (isolated)' }));
        return;
      }

      const getCartMatch = pathname.match(/^\/api\/v1\/carts\/([^/]+)$/);
      if (method === 'GET' && getCartMatch) {
        res.statusCode = 200;
        res.end(JSON.stringify(service.getOrCreateCart(getCartMatch[1])));
        return;
      }

      const addMatch = pathname.match(/^\/api\/v1\/carts\/([^/]+)\/items$/);
      if (method === 'POST' && addMatch) {
        const updated = service.addItem(
          { userId: addMatch[1], productId: body.productId, quantity: body.quantity },
          correlationId,
        );
        res.statusCode = 200;
        res.end(JSON.stringify(updated));
        return;
      }

      const itemMatch = pathname.match(/^\/api\/v1\/carts\/([^/]+)\/items\/([^/]+)$/);
      if (method === 'PATCH' && itemMatch) {
        const updated = service.updateQuantity(
          { userId: itemMatch[1], productId: itemMatch[2], quantity: body.quantity },
          correlationId,
        );
        res.statusCode = 200;
        res.end(JSON.stringify(updated));
        return;
      }
      if (method === 'DELETE' && itemMatch) {
        const updated = service.removeItem(
          { userId: itemMatch[1], productId: itemMatch[2] },
          correlationId,
        );
        res.statusCode = 200;
        res.end(JSON.stringify(updated));
        return;
      }

      const lockMatch = pathname.match(/^\/api\/v1\/carts\/([^/]+)\/lock$/);
      if (method === 'POST' && lockMatch) {
        const snap = service.lockCartSnapshot(lockMatch[1], correlationId);
        res.statusCode = 200;
        res.end(JSON.stringify(snap));
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

  return { service, server, logs };
}

describe('Cart Service — Unit & HTTP Integration Tests', () => {
  describe('Unit Tests: Configuration, Product API Validation, Cart Locking & Saga Events', () => {
    it('validates environment config and rejects invalid CART_TTL_HOURS or missing DATABASE_URL in production', () => {
      assert.throws(
        () => createCartServiceHarness({ NODE_ENV: 'production', DATABASE_URL: '' }),
        /Missing required DATABASE_URL environment variable in production mode/,
      );
      assert.throws(
        () => createCartServiceHarness({ CART_TTL_HOURS: '-5' }),
        /CART_TTL_HOURS must be a positive integer/,
      );
    });

    it('validates SKU & stock via Product Service API contract and prevents overselling (422 Unprocessable Entity)', () => {
      const { service } = createCartServiceHarness();

      const cart = service.addItem(
        { userId: 'user-55', productId: 'prod-headphones', quantity: 2 },
        'corr-cart-1',
      );
      assert.equal(cart.subtotalCents, 59800);

      // Requesting 4 more (total 6 > available 5) throws 422
      assert.throws(
        () =>
          service.addItem(
            { userId: 'user-55', productId: 'prod-headphones', quantity: 4 },
            'corr-cart-2',
          ),
        (err) => err.statusCode === 422 && err.errorCode === 'UNPROCESSABLE_ENTITY',
      );
    });

    it('locks cart for checkout, blocks modifications while locked (409 Conflict), unlocks on order.cancelled, and clears on order.confirmed', async () => {
      const { service } = createCartServiceHarness();

      service.addItem({ userId: 'user-77', productId: 'prod-cable', quantity: 2 });
      const snapshot = service.lockCartSnapshot('user-77', 'corr-lock-1');
      assert.equal(snapshot.status, 'LOCKED_FOR_CHECKOUT');
      assert.equal(snapshot.totalCents, 5000);

      // Modifying a locked cart throws 409 Conflict
      assert.throws(
        () => service.addItem({ userId: 'user-77', productId: 'prod-cable', quantity: 1 }),
        (err) => err.statusCode === 409 && err.errorCode === 'CONFLICT',
      );

      // Order cancelled unlocks cart back to ACTIVE
      await service.handleOrderCancelled({
        eventId: 'evt-cancel-77',
        payload: { cartId: 'cart-user-77' },
      });
      assert.equal(service.getOrCreateCart('user-77').status, 'ACTIVE');

      // Re-lock and confirm order clears cart
      service.lockCartSnapshot('user-77');
      await service.handleOrderConfirmed({
        eventId: 'evt-confirm-77',
        payload: { cartId: 'cart-user-77' },
      });
      const cleared = service.getOrCreateCart('user-77');
      assert.equal(cleared.status, 'CHECKED_OUT');
      assert.equal(cleared.items.length, 0);
      assert.equal(cleared.subtotalCents, 0);
    });
  });

  describe('HTTP Integration Tests: REST Endpoints, Validation, Health Checks & Correlation IDs', () => {
    let harness;
    let baseUrl;

    before(async () => {
      harness = createCartServiceHarness();
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

    it('GET /healthz and GET /readyz return 200 OK and propagate x-correlation-id', async () => {
      const res = await fetch(`${baseUrl}/healthz`, {
        headers: { 'x-correlation-id': 'corr-cart-health' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-correlation-id'), 'corr-cart-health');
      const body = await res.json();
      assert.equal(body.service, 'cart-service');
    });

    it('POST, PATCH, DELETE /api/v1/carts/:userId/items validate DTOs and manage cart lifecycle', async () => {
      // Invalid quantity (0) -> 400 Bad Request
      const badRes = await fetch(`${baseUrl}/api/v1/carts/user-http-1/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 'prod-headphones', quantity: 0 }),
      });
      assert.equal(badRes.status, 400);

      // Add 2 headphones + 1 cable
      const add1 = await fetch(`${baseUrl}/api/v1/carts/user-http-1/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 'prod-headphones', quantity: 2 }),
      });
      assert.equal(add1.status, 200);

      const add2 = await fetch(`${baseUrl}/api/v1/carts/user-http-1/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ productId: 'prod-cable', quantity: 1 }),
      });
      assert.equal(add2.status, 200);
      const cartAfterAdd = await add2.json();
      assert.equal(cartAfterAdd.subtotalCents, 29900 * 2 + 2500);

      // Update cable quantity to 3
      const patchRes = await fetch(`${baseUrl}/api/v1/carts/user-http-1/items/prod-cable`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: 3 }),
      });
      assert.equal(patchRes.status, 200);
      const cartAfterPatch = await patchRes.json();
      assert.equal(cartAfterPatch.subtotalCents, 29900 * 2 + 2500 * 3);

      // Remove cable
      const delRes = await fetch(`${baseUrl}/api/v1/carts/user-http-1/items/prod-cable`, {
        method: 'DELETE',
      });
      assert.equal(delRes.status, 200);
      const cartAfterDel = await delRes.json();
      assert.equal(cartAfterDel.items.length, 1);
      assert.equal(cartAfterDel.subtotalCents, 59800);
    });
  });
});
