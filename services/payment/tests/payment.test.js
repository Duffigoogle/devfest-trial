const request = require('supertest');
const { app, store } = require('../src/index');

describe('Payment Service API', () => {
  beforeEach(() => {
    store.reset();
  });

  describe('GET /healthz', () => {
    it('returns 200 OK with service health status', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        service: 'payment',
        status: 'ok'
      });
    });
  });

  describe('POST /payments', () => {
    it('approves payment when amount is 1,000,000 or less and returns a paymentId', async () => {
      const res = await request(app)
        .post('/payments')
        .send({ orderId: 'ord-101', amount: 70000 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        paymentId: expect.stringMatching(/^pay-/),
        orderId: 'ord-101',
        amount: 70000,
        status: 'approved',
        processedAt: expect.any(String)
      });
    });

    it('approves payment at the exact boundary of 1,000,000', async () => {
      const res = await request(app)
        .post('/payments')
        .send({ orderId: 'ord-102', amount: 1000000 });

      expect(res.status).toBe(200);
      expect(res.body.paymentId).toMatch(/^pay-/);
      expect(res.body.status).toBe('approved');
    });

    it('declines payment when amount is over 1,000,000', async () => {
      const res = await request(app)
        .post('/payments')
        .send({ orderId: 'ord-103', amount: 1000001 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        paymentId: expect.stringMatching(/^pay-/),
        orderId: 'ord-103',
        amount: 1000001,
        status: 'declined',
        processedAt: expect.any(String)
      });
    });

    it('returns 400 when orderId or amount is missing or invalid', async () => {
      const missingOrder = await request(app)
        .post('/payments')
        .send({ amount: 5000 });
      expect(missingOrder.status).toBe(400);

      const invalidAmount = await request(app)
        .post('/payments')
        .send({ orderId: 'ord-104', amount: -100 });
      expect(invalidAmount.status).toBe(400);
    });
  });
});
