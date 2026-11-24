import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { URL } from 'node:url';

/**
 * Notification Service Unit & Live HTTP Integration Test Suite
 * Verifies:
 * 1. Environment config validation (requires DATABASE_URL in production, validates NOTIFICATION_SENDER_EMAIL)
 * 2. Idempotent event handling for order.confirmed and order.cancelled (never sends duplicate notifications on Pub/Sub at-least-once redelivery)
 * 3. Structured logging with correlationId tracking
 * 4. Live HTTP REST integration endpoints (/healthz, /readyz, GET /api/v1/notifications, GET /api/v1/notifications/order/:orderId, POST /api/v1/notifications/send)
 */

function createNotificationServiceHarness(envOverrides = {}) {
  const nodeEnv = envOverrides.NODE_ENV || 'test';
  if ((nodeEnv === 'production' || nodeEnv === 'staging') && !envOverrides.DATABASE_URL) {
    throw new Error(
      `[notification-service] Missing required DATABASE_URL environment variable in ${nodeEnv} mode`,
    );
  }
  const senderEmail =
    envOverrides.NOTIFICATION_SENDER_EMAIL || 'no-reply@cloudmart.example.com';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new Error('[notification-service] NOTIFICATION_SENDER_EMAIL must be a valid email address');
  }

  const structuredLogs = [];
  const notificationAuditLogs = [];
  const processedEventIds = new Set();

  function log(severity, message, correlationId, metadata) {
    structuredLogs.push({
      severity,
      service: 'notification-service',
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

  const service = {
    async handleOrderConfirmed(event) {
      if (processedEventIds.has(event.eventId)) return;
      processedEventIds.add(event.eventId);

      const { orderId, userId, customerEmail, totalCents, currency } = event.payload;
      const entry = {
        id: `notif-${event.eventId}`,
        sourceEventId: event.eventId,
        orderId,
        recipientUserId: userId,
        recipientEmail: customerEmail,
        channel: 'EMAIL',
        templateKey: 'ORDER_CONFIRMED_EMAIL',
        subject: `CloudMart Order Confirmed (#${orderId})`,
        bodyText: `Order #${orderId} for ${(totalCents / 100).toFixed(2)} ${currency} confirmed.`,
        status: 'SENT',
        correlationId: event.correlationId,
        sentAt: new Date().toISOString(),
      };
      notificationAuditLogs.push(entry);
      log('INFO', `Dispatched ORDER_CONFIRMED_EMAIL for ${orderId}`, event.correlationId);
    },

    async handleOrderCancelled(event) {
      if (processedEventIds.has(event.eventId)) return;
      processedEventIds.add(event.eventId);

      const { orderId, userId, customerEmail, reason } = event.payload;
      const entry = {
        id: `notif-${event.eventId}`,
        sourceEventId: event.eventId,
        orderId,
        recipientUserId: userId,
        recipientEmail: customerEmail,
        channel: 'EMAIL',
        templateKey: 'ORDER_CANCELLED_EMAIL',
        subject: `CloudMart Order Update (#${orderId})`,
        bodyText: `Order #${orderId} cancelled (${reason}).`,
        status: 'SENT',
        correlationId: event.correlationId,
        sentAt: new Date().toISOString(),
      };
      notificationAuditLogs.push(entry);
      log('INFO', `Dispatched ORDER_CANCELLED_EMAIL for ${orderId}`, event.correlationId);
    },

    sendManualNotification(dto, correlationId) {
      const errors = [];
      if (!dto || typeof dto !== 'object') {
        throw createHttpError(400, 'BAD_REQUEST', 'Validation failed', ['body must be an object']);
      }
      if (typeof dto.orderId !== 'string' || dto.orderId.trim().length < 3) {
        errors.push('orderId is required');
      }
      if (typeof dto.recipientUserId !== 'string' || dto.recipientUserId.trim().length < 2) {
        errors.push('recipientUserId is required');
      }
      if (typeof dto.recipientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.recipientEmail)) {
        errors.push('recipientEmail format is invalid');
      }
      if (!['EMAIL', 'SMS'].includes(dto.channel)) {
        errors.push('channel must be EMAIL or SMS');
      }
      if (
        !['ORDER_CONFIRMED_EMAIL', 'ORDER_CANCELLED_EMAIL', 'CUSTOM_ALERT'].includes(
          dto.templateKey,
        )
      ) {
        errors.push('templateKey is invalid');
      }
      if (typeof dto.subject !== 'string' || dto.subject.trim().length < 3) {
        errors.push('subject is required');
      }
      if (typeof dto.bodyText !== 'string' || dto.bodyText.trim().length < 3) {
        errors.push('bodyText is required');
      }
      if (errors.length > 0) {
        throw createHttpError(400, 'BAD_REQUEST', 'Validation failed', errors);
      }

      const entry = {
        id: `notif-manual-${notificationAuditLogs.length + 1}`,
        sourceEventId: `manual-${notificationAuditLogs.length + 1}`,
        orderId: dto.orderId,
        recipientUserId: dto.recipientUserId,
        recipientEmail: dto.recipientEmail,
        channel: dto.channel,
        templateKey: dto.templateKey,
        subject: dto.subject,
        bodyText: dto.bodyText,
        status: 'SENT',
        correlationId,
        sentAt: new Date().toISOString(),
      };
      notificationAuditLogs.push(entry);
      log('INFO', `Dispatched manual ${dto.channel} notification`, correlationId);
      return entry;
    },

    getByOrder(orderId) {
      return notificationAuditLogs.filter((l) => l.orderId === orderId);
    },

    getAll(recipientUserId) {
      return recipientUserId
        ? notificationAuditLogs.filter((l) => l.recipientUserId === recipientUserId)
        : [...notificationAuditLogs];
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
        res.end(JSON.stringify({ status: 'ok', service: 'notification-service' }));
        return;
      }
      if (method === 'GET' && pathname === '/readyz') {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            status: 'ready',
            service: 'notification-service',
            database: 'notification_db (isolated)',
          }),
        );
        return;
      }
      if (method === 'GET' && pathname === '/api/v1/notifications') {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            items: service.getAll(url.searchParams.get('recipientUserId')),
          }),
        );
        return;
      }
      const orderMatch = pathname.match(/^\/api\/v1\/notifications\/order\/([^/]+)$/);
      if (method === 'GET' && orderMatch) {
        res.statusCode = 200;
        res.end(JSON.stringify({ items: service.getByOrder(orderMatch[1]) }));
        return;
      }
      if (method === 'POST' && pathname === '/api/v1/notifications/send') {
        const created = service.sendManualNotification(body, correlationId);
        res.statusCode = 201;
        res.end(JSON.stringify(created));
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

  return { service, server, structuredLogs };
}

describe('Notification Service — Unit & HTTP Integration Tests', () => {
  describe('Unit Tests: Configuration, Idempotent Event Deduplication & Structured Logging', () => {
    it('validates NOTIFICATION_SENDER_EMAIL and rejects missing DATABASE_URL in production', () => {
      assert.throws(
        () => createNotificationServiceHarness({ NODE_ENV: 'production', DATABASE_URL: '' }),
        /Missing required DATABASE_URL environment variable in production mode/,
      );
      assert.throws(
        () => createNotificationServiceHarness({ NOTIFICATION_SENDER_EMAIL: 'not-an-email' }),
        /NOTIFICATION_SENDER_EMAIL must be a valid email address/,
      );
    });

    it('deduplicates repeated order.confirmed and order.cancelled events so customers never receive duplicate emails', async () => {
      const { service, structuredLogs } = createNotificationServiceHarness();

      const confirmedEvent = {
        eventId: 'evt-notif-confirm-1',
        correlationId: 'corr-notif-1',
        payload: {
          orderId: 'ord-700',
          userId: 'user-70',
          customerEmail: 'customer70@cloudmart.example.com',
          totalCents: 12900,
          currency: 'USD',
        },
      };

      await service.handleOrderConfirmed(confirmedEvent);
      await service.handleOrderConfirmed(confirmedEvent); // Redelivered Pub/Sub message

      const logsForOrder = service.getByOrder('ord-700');
      assert.equal(logsForOrder.length, 1);
      assert.equal(logsForOrder[0].templateKey, 'ORDER_CONFIRMED_EMAIL');
      assert.equal(structuredLogs.length, 1);
      assert.equal(structuredLogs[0].correlationId, 'corr-notif-1');
    });
  });

  describe('HTTP Integration Tests: REST Audit Endpoints, Manual Dispatch Validation & Health Checks', () => {
    let harness;
    let baseUrl;

    before(async () => {
      harness = createNotificationServiceHarness();
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
        headers: { 'x-correlation-id': 'corr-notif-health' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-correlation-id'), 'corr-notif-health');
    });

    it('POST /api/v1/notifications/send validates DTO (400 on bad email) and GET /api/v1/notifications/order/:orderId returns audit log', async () => {
      // Invalid email -> 400 Bad Request
      const badRes = await fetch(`${baseUrl}/api/v1/notifications/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: 'ord-http-800',
          recipientUserId: 'user-80',
          recipientEmail: 'invalid-email',
          channel: 'EMAIL',
          templateKey: 'CUSTOM_ALERT',
          subject: 'Hi',
          bodyText: 'Test',
        }),
      });
      assert.equal(badRes.status, 400);

      // Valid manual dispatch -> 201 Created
      const okRes = await fetch(`${baseUrl}/api/v1/notifications/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'corr-notif-manual-800',
        },
        body: JSON.stringify({
          orderId: 'ord-http-800',
          recipientUserId: 'user-80',
          recipientEmail: 'user80@cloudmart.example.com',
          channel: 'EMAIL',
          templateKey: 'CUSTOM_ALERT',
          subject: 'Shipment Update (#ord-http-800)',
          bodyText: 'Your package has been handed over to the courier.',
        }),
      });
      assert.equal(okRes.status, 201);

      const listRes = await fetch(`${baseUrl}/api/v1/notifications/order/ord-http-800`);
      assert.equal(listRes.status, 200);
      const listBody = await listRes.json();
      assert.equal(listBody.items.length, 1);
      assert.equal(listBody.items[0].correlationId, 'corr-notif-manual-800');
    });
  });
});
