const express = require('express');
const store = require('./store');

const app = express();
app.use(express.json());

const MAX_APPROVED_AMOUNT = 1_000_000;

const healthHandler = (_req, res) => {
  res.status(200).json({ service: 'payment', status: 'ok' });
};

app.get('/healthz', healthHandler);
app.get('/health', healthHandler);

app.get('/payments', (_req, res) => {
  res.status(200).json(store.list());
});

app.post('/payments', (req, res) => {
  const { orderId, amount } = req.body || {};

  if (
    !orderId ||
    typeof orderId !== 'string' ||
    typeof amount !== 'number' ||
    Number.isNaN(amount) ||
    amount <= 0
  ) {
    return res
      .status(400)
      .json({ error: 'orderId (string) and positive amount (number) are required' });
  }

  const status = amount > MAX_APPROVED_AMOUNT ? 'declined' : 'approved';
  const payment = store.record({ orderId, amount, status });

  return res.status(200).json(payment);
});

app.get('/payments/:paymentId', (req, res) => {
  const payment = store.getById(req.params.paymentId);
  if (!payment) {
    return res.status(404).json({ error: `Payment ${req.params.paymentId} not found` });
  }
  return res.status(200).json(payment);
});

const PORT = Number(process.env.PORT) || 8084;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[payment] listening on port ${PORT}`);
  });
}

module.exports = { app, store, MAX_APPROVED_AMOUNT };
