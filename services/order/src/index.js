const express = require('express');
const store = require('./store');
const { publishOrderPlaced } = require('./pubsub');

const app = express();
app.use(express.json());

const getCartUrl = () =>
  (process.env.CART_URL || process.env.CART_SERVICE_URL || 'http://localhost:8082').replace(/\/+$/, '');
const getProductUrl = () =>
  (process.env.PRODUCT_URL || process.env.PRODUCT_SERVICE_URL || 'http://localhost:8081').replace(/\/+$/, '');
const getPaymentUrl = () =>
  (process.env.PAYMENT_URL || process.env.PAYMENT_SERVICE_URL || 'http://localhost:8084').replace(/\/+$/, '');

const healthHandler = (_req, res) => {
  res.status(200).json({ service: 'order', status: 'ok' });
};

app.get('/healthz', healthHandler);
app.get('/health', healthHandler);

app.get('/orders', (_req, res) => {
  res.status(200).json(store.list());
});

app.get('/orders/:id', (req, res) => {
  const order = store.getById(req.params.id);
  if (!order) {
    return res.status(404).json({ error: `Order ${req.params.id} not found` });
  }
  return res.status(200).json(order);
});

app.post('/orders', async (req, res) => {
  const { cartId, customerEmail, shippingCost } = req.body || {};

  if (!cartId || typeof cartId !== 'string' || !customerEmail || typeof customerEmail !== 'string') {
    return res.status(400).json({ error: 'cartId and customerEmail are required' });
  }

  const shipping =
    typeof shippingCost === 'number' && !Number.isNaN(shippingCost) && shippingCost >= 0
      ? shippingCost
      : 0;

  try {
    // 1. Read cart from CART_URL
    const cartRes = await fetch(`${getCartUrl()}/carts/${encodeURIComponent(cartId)}`);
    if (!cartRes.ok) {
      return res.status(502).json({ error: 'Unable to fetch cart from Cart Service' });
    }
    const cart = await cartRes.json();
    const cartItems = Array.isArray(cart.items) ? cart.items : [];

    if (cartItems.length === 0) {
      return res.status(400).json({ error: 'Cannot place an order with an empty cart' });
    }

    // 2. Get authoritative prices from PRODUCT_URL
    const pricedItems = [];
    for (const item of cartItems) {
      const prodRes = await fetch(
        `${getProductUrl()}/products/${encodeURIComponent(item.productId)}`
      );
      if (prodRes.status === 404) {
        return res.status(404).json({ error: `Product ${item.productId} not found` });
      }
      if (!prodRes.ok) {
        return res.status(502).json({ error: `Failed to fetch product ${item.productId}` });
      }
      const product = await prodRes.json();
      pricedItems.push({
        productId: product.id || item.productId,
        name: product.name || item.name,
        quantity: Number(item.quantity),
        price: Number(product.price)
      });
    }

    const itemsTotal = pricedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total = itemsTotal + shipping;
    const orderId = `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // 3. Charge the total through PAYMENT_URL
    const payRes = await fetch(`${getPaymentUrl()}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, amount: total })
    });

    if (!payRes.ok) {
      const errBody = await payRes.json().catch(() => ({}));
      return res.status(400).json({
        error: errBody.error || 'Payment request failed',
        details: errBody
      });
    }

    const payment = await payRes.json();
    if (payment.status !== 'approved') {
      return res.status(402).json({
        error: 'Payment declined',
        paymentId: payment.paymentId,
        status: payment.status
      });
    }

    // 4. Store the order in memory
    const createdAt = new Date().toISOString();
    const order = store.create({
      orderId,
      cartId,
      items: pricedItems,
      total,
      customerEmail,
      status: 'placed',
      paymentId: payment.paymentId,
      createdAt
    });

    // 5. Clear the cart
    await fetch(`${getCartUrl()}/carts/${encodeURIComponent(cartId)}`, {
      method: 'DELETE'
    });

    // 6. Publish "order.placed" event (Pub/Sub when PUBSUB_TOPIC is set, else log locally)
    const eventPayload = {
      orderId: order.orderId,
      items: order.items,
      total: order.total,
      customerEmail: order.customerEmail,
      createdAt: order.createdAt
    };
    await publishOrderPlaced(eventPayload);

    return res.status(201).json(order);
  } catch (err) {
    return res.status(502).json({
      error: 'Checkout orchestration failed',
      details: err.message
    });
  }
});

const PORT = Number(process.env.PORT) || 8083;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[order] listening on port ${PORT}`);
  });
}

module.exports = { app, store };
