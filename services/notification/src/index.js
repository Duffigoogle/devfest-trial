const express = require('express');
const store = require('./store');

const app = express();
app.use(express.json());

function decodePubSubMessage(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    !body.message ||
    typeof body.message.data !== 'string' ||
    body.message.data.trim() === ''
  ) {
    throw new Error('Missing Pub/Sub message.data');
  }

  const rawJson = Buffer.from(body.message.data, 'base64').toString('utf8');
  return JSON.parse(rawJson);
}

function validateOrderPlacedEvent(event) {
  if (!event || typeof event !== 'object') {
    return 'Event payload must be a JSON object';
  }
  const { orderId, customerEmail, total } = event;
  if (!orderId || typeof orderId !== 'string') {
    return 'orderId is required and must be a string';
  }
  if (!customerEmail || typeof customerEmail !== 'string' || !customerEmail.includes('@')) {
    return 'customerEmail is required and must be a valid email';
  }
  if (typeof total !== 'number' || Number.isNaN(total) || total < 0) {
    return 'total is required and must be a non-negative number';
  }
  return null;
}

const healthHandler = (_req, res) => {
  res.status(200).json({ service: 'notification', status: 'ok' });
};

app.get('/healthz', healthHandler);
app.get('/health', healthHandler);

app.get('/notifications', (_req, res) => {
  res.status(200).json(store.list());
});

app.post('/pubsub', (req, res) => {
  let event;
  try {
    event = decodePubSubMessage(req.body);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid Pub/Sub message', details: err.message });
  }

  const validationError = validateOrderPlacedEvent(event);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const formattedTotal = Number(event.total).toLocaleString('en-US');
  const logLine = `Notification sent: order ${event.orderId} confirmed for ${event.customerEmail}, total ₦${formattedTotal}`;

  console.log(logLine);
  store.record({ ...event, logLine });

  return res.status(204).send();
});

const PORT = Number(process.env.PORT) || 8085;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[notification] listening on port ${PORT}`);
  });
}

module.exports = { app, store };
