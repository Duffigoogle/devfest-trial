const request = require('supertest');
const { app, store } = require('../src/index');

describe('Notification Service API', () => {
  beforeEach(() => {
    store.reset();
  });

  describe('GET /healthz', () => {
    it('returns 200 OK with service health status', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        service: 'notification',
        status: 'ok'
      });
    });
  });

  describe('POST /pubsub', () => {
    it('decodes a valid base64 order.placed message, logs the formatted Naira confirmation line, and returns 204', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const eventPayload = {
        orderId: '123',
        items: [
          {
            productId: 'prod-1',
            name: 'Cloud Run Developer Hoodie',
            quantity: 1,
            price: 35000
          },
          {
            productId: 'prod-4',
            name: 'Spanner Global Sticker Pack',
            quantity: 2,
            price: 5000
          }
        ],
        total: 45000,
        customerEmail: 'ada@example.com',
        createdAt: '2026-11-26T18:50:00.000Z'
      };

      const base64Data = Buffer.from(JSON.stringify(eventPayload)).toString('base64');

      const res = await request(app)
        .post('/pubsub')
        .send({
          message: {
            data: base64Data,
            messageId: 'msg-001'
          },
          subscription: 'projects/cloudmart/subscriptions/notification-sub'
        });

      expect(res.status).toBe(204);
      expect(logSpy).toHaveBeenCalledWith(
        'Notification sent: order 123 confirmed for ada@example.com, total ₦45,000'
      );
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0]).toEqual(
        expect.objectContaining({
          orderId: '123',
          customerEmail: 'ada@example.com',
          total: 45000
        })
      );

      logSpy.mockRestore();
    });

    it('returns 400 when message or message.data is missing', async () => {
      const resMissingMessage = await request(app).post('/pubsub').send({});
      expect(resMissingMessage.status).toBe(400);

      const resEmptyData = await request(app)
        .post('/pubsub')
        .send({ message: { data: '' } });
      expect(resEmptyData.status).toBe(400);
    });

    it('returns 400 when message.data does not decode to valid JSON', async () => {
      const invalidBase64 = Buffer.from('not-valid-json{{{').toString('base64');
      const res = await request(app)
        .post('/pubsub')
        .send({ message: { data: invalidBase64 } });

      expect(res.status).toBe(400);
    });

    it('returns 400 when decoded event payload is missing required order.placed fields', async () => {
      const incompleteEvent = Buffer.from(
        JSON.stringify({ orderId: '123' })
      ).toString('base64');

      const res = await request(app)
        .post('/pubsub')
        .send({ message: { data: incompleteEvent } });

      expect(res.status).toBe(400);
    });
  });
});
