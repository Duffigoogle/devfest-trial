const path = require('path');
const express = require('express');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const getProductUrl = () =>
  (process.env.PRODUCT_URL || process.env.PRODUCT_SERVICE_URL || 'http://localhost:8081').replace(/\/+$/, '');
const getCartUrl = () =>
  (process.env.CART_URL || process.env.CART_SERVICE_URL || 'http://localhost:8082').replace(/\/+$/, '');
const getOrderUrl = () =>
  (process.env.ORDER_URL || process.env.ORDER_SERVICE_URL || 'http://localhost:8083').replace(/\/+$/, '');

async function forwardJson(res, upstreamUrl, options = {}) {
  try {
    const response = await fetch(upstreamUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({
      error: `Upstream request failed: ${upstreamUrl}`,
      details: err.message
    });
  }
}

const healthHandler = (_req, res) => {
  res.status(200).json({ service: 'frontend', status: 'ok' });
};

app.get('/healthz', healthHandler);
app.get('/health', healthHandler);

// Serve lightweight SVG product artwork for /images/* URLs so catalogue images render cleanly offline
app.get('/images/:filename', (req, res) => {
  const label = req.params.filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
    <rect width="400" height="240" rx="12" fill="#e8f0fe"/>
    <circle cx="200" cy="95" r="38" fill="#1a73e8" opacity="0.15"/>
    <text x="200" y="102" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#1a73e8" text-anchor="middle">CloudMart</text>
    <text x="200" y="175" font-family="system-ui, sans-serif" font-size="15" font-weight="600" fill="#1e293b" text-anchor="middle">${label}</text>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.status(200).send(svg);
});

// Product Service proxy routes
app.get('/api/products', (_req, res) =>
  forwardJson(res, `${getProductUrl()}/products`)
);

app.get('/api/products/:id', (req, res) =>
  forwardJson(res, `${getProductUrl()}/products/${encodeURIComponent(req.params.id)}`)
);

// Cart Service proxy routes
app.get('/api/carts/:cartId', (req, res) =>
  forwardJson(res, `${getCartUrl()}/carts/${encodeURIComponent(req.params.cartId)}`)
);

app.post('/api/carts/:cartId/items', (req, res) =>
  forwardJson(
    res,
    `${getCartUrl()}/carts/${encodeURIComponent(req.params.cartId)}/items`,
    {
      method: 'POST',
      body: JSON.stringify(req.body)
    }
  )
);

app.delete('/api/carts/:cartId', (req, res) =>
  forwardJson(
    res,
    `${getCartUrl()}/carts/${encodeURIComponent(req.params.cartId)}`,
    { method: 'DELETE' }
  )
);

// Order Service proxy routes
app.post('/api/orders', (req, res) =>
  forwardJson(res, `${getOrderUrl()}/orders`, {
    method: 'POST',
    body: JSON.stringify(req.body)
  })
);

app.get('/api/orders/:id', (req, res) =>
  forwardJson(res, `${getOrderUrl()}/orders/${encodeURIComponent(req.params.id)}`)
);

const PORT = Number(process.env.PORT) || 8080;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[frontend] listening on port ${PORT}`);
  });
}

module.exports = { app };
