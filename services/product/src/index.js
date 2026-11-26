const express = require('express');
const store = require('./store');

const app = express();
app.use(express.json());

const healthHandler = (_req, res) => {
  res.status(200).json({ service: 'product', status: 'ok' });
};

app.get('/healthz', healthHandler);
app.get('/health', healthHandler);

app.get('/products', (_req, res) => {
  res.status(200).json(store.list());
});

app.get('/products/:id', (req, res) => {
  const product = store.getById(req.params.id);
  if (!product) {
    return res.status(404).json({ error: `Product ${req.params.id} not found` });
  }
  return res.status(200).json(product);
});

app.patch('/products/:id/stock', (req, res) => {
  const { delta } = req.body || {};
  if (typeof delta !== 'number' || !Number.isInteger(delta)) {
    return res.status(400).json({ error: 'delta must be an integer' });
  }
  const result = store.adjustStock(req.params.id, delta);
  if (result.error === 'NOT_FOUND') {
    return res.status(404).json({ error: `Product ${req.params.id} not found` });
  }
  if (result.error === 'INSUFFICIENT_STOCK') {
    return res.status(400).json({
      error: 'Insufficient stock',
      available: result.available
    });
  }
  return res.status(200).json(result.product);
});

const PORT = Number(process.env.PORT) || 8081;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[product] listening on port ${PORT}`);
  });
}

module.exports = { app, store };
