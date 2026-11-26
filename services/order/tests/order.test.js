const request = require('supertest');

const mockPublishMessage = jest.fn().mockResolvedValue('msg-123');
const mockTopic = jest.fn(() => ({
  publishMessage: mockPublishMessage
}));
const MockPubSub = jest.fn(() => ({
  topic: mockTopic
}));

jest.mock(
  '@google-cloud/pubsub',
  () => ({
    PubSub: MockPubSub
  }),
  { virtual: true }
);

const { app, store } = require('../src/index');

describe('Order Service API', () => {
  const MOCK_CART_URL = 'http://mock-cart:8082';
  const MOCK_PRODUCT_URL = 'http://mock-product:8081';
  const MOCK_PAYMENT_URL = 'http://mock-payment:8084';

  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    store.reset();
    jest.clearAllMocks();
    process.env.CART_URL = MOCK_CART_URL;
    process.env.PRODUCT_URL = MOCK_PRODUCT_URL;
    process.env.PAYMENT_URL = MOCK_PAYMENT_URL;
    process.env.GOOGLE_CLOUD_PROJECT = 'cloudmart-demo-proj';
    process.env.PUBSUB_TOPIC = 'order-placed-topic';
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  describe('GET /healthz', () => {
    it('returns 200 OK with service health status', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        service: 'order',
        status: 'ok'
      });
    });
  });

  describe('POST /orders', () => {
    it('reads cart, fetches prices, charges payment, stores order, clears cart, and publishes order.placed to Pub/Sub', async () => {
      global.fetch
        // 1. GET /carts/cart-10
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            cartId: 'cart-10',
            items: [
              { productId: 'prod-1', quantity: 2 },
              { productId: 'prod-4', quantity: 1 }
            ]
          })
        })
        // 2. GET /products/prod-1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'prod-1',
            name: 'Cloud Run Developer Hoodie',
            price: 35000
          })
        })
        // 3. GET /products/prod-4
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'prod-4',
            name: 'Spanner Global Sticker Pack',
            price: 4500
          })
        })
        // 4. POST /payments
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            paymentId: 'pay-9001',
            status: 'approved'
          })
        })
        // 5. DELETE /carts/cart-10
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ cartId: 'cart-10', items: [], total: 0 })
        });

      const res = await request(app)
        .post('/orders')
        .send({ cartId: 'cart-10', customerEmail: 'ada@cloudmart.ng' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        orderId: expect.stringMatching(/^ord-/),
        cartId: 'cart-10',
        items: [
          {
            productId: 'prod-1',
            name: 'Cloud Run Developer Hoodie',
            quantity: 2,
            price: 35000
          },
          {
            productId: 'prod-4',
            name: 'Spanner Global Sticker Pack',
            quantity: 1,
            price: 4500
          }
        ],
        total: 74500,
        customerEmail: 'ada@cloudmart.ng',
        status: 'placed',
        paymentId: 'pay-9001',
        createdAt: expect.any(String)
      });

      // Verify HTTP calls to Cart, Product, Payment, and Cart clear
      expect(global.fetch).toHaveBeenNthCalledWith(1, `${MOCK_CART_URL}/carts/cart-10`);
      expect(global.fetch).toHaveBeenNthCalledWith(2, `${MOCK_PRODUCT_URL}/products/prod-1`);
      expect(global.fetch).toHaveBeenNthCalledWith(3, `${MOCK_PRODUCT_URL}/products/prod-4`);
      expect(global.fetch).toHaveBeenNthCalledWith(
        4,
        `${MOCK_PAYMENT_URL}/payments`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ orderId: res.body.orderId, amount: 74500 })
        })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        5,
        `${MOCK_CART_URL}/carts/cart-10`,
        { method: 'DELETE' }
      );

      // Verify Google Cloud Pub/Sub call
      expect(MockPubSub).toHaveBeenCalledWith({ projectId: 'cloudmart-demo-proj' });
      expect(mockTopic).toHaveBeenCalledWith('order-placed-topic');
      expect(mockPublishMessage).toHaveBeenCalledTimes(1);

      const publishedArg = mockPublishMessage.mock.calls[0][0];
      const decodedEvent = JSON.parse(publishedArg.data.toString('utf8'));
      expect(decodedEvent).toEqual({
        orderId: res.body.orderId,
        items: res.body.items,
        total: 74500,
        customerEmail: 'ada@cloudmart.ng',
        createdAt: res.body.createdAt
      });
    });

    it('logs the order.placed event locally when PUBSUB_TOPIC is not set', async () => {
      delete process.env.PUBSUB_TOPIC;
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            cartId: 'cart-20',
            items: [{ productId: 'prod-2', quantity: 1 }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'prod-2',
            name: 'GKE Kubernetes Captain Mug',
            price: 12500
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            paymentId: 'pay-9002',
            status: 'approved'
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ cartId: 'cart-20', items: [], total: 0 })
        });

      const res = await request(app)
        .post('/orders')
        .send({ cartId: 'cart-20', customerEmail: 'local@cloudmart.ng' });

      expect(res.status).toBe(201);
      expect(MockPubSub).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        '[order] order.placed event (local):',
        expect.stringContaining('"customerEmail":"local@cloudmart.ng"')
      );

      logSpy.mockRestore();
    });

    it('returns 402 and does not store order, clear cart, or publish event when payment is declined', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            cartId: 'cart-big',
            items: [{ productId: 'prod-3', quantity: 15 }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'prod-3',
            name: 'BigQuery Mechanical Keyboard',
            price: 95000
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            paymentId: 'pay-declined-1',
            status: 'declined'
          })
        });

      const res = await request(app)
        .post('/orders')
        .send({ cartId: 'cart-big', customerEmail: 'bigspender@cloudmart.ng' });

      expect(res.status).toBe(402);
      expect(res.body).toEqual({
        error: 'Payment declined',
        paymentId: 'pay-declined-1',
        status: 'declined'
      });
      expect(global.fetch).toHaveBeenCalledTimes(3); // No DELETE cart call
      expect(mockPublishMessage).not.toHaveBeenCalled();
      expect(store.list()).toHaveLength(0);
    });

    it('returns 400 when cart is empty', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ cartId: 'cart-empty', items: [] })
      });

      const res = await request(app)
        .post('/orders')
        .send({ cartId: 'cart-empty', customerEmail: 'ada@cloudmart.ng' });

      expect(res.status).toBe(400);
      expect(mockPublishMessage).not.toHaveBeenCalled();
    });
  });

  describe('GET /orders/:id', () => {
    it('returns a stored order by ID and 404 for unknown order ID', async () => {
      const created = store.create({
        orderId: 'ord-555',
        cartId: 'cart-55',
        items: [{ productId: 'prod-1', name: 'Hoodie', quantity: 1, price: 35000 }],
        total: 35000,
        customerEmail: 'ada@cloudmart.ng',
        status: 'placed',
        paymentId: 'pay-555',
        createdAt: '2026-11-26T18:00:00.000Z'
      });

      const foundRes = await request(app).get('/orders/ord-555');
      expect(foundRes.status).toBe(200);
      expect(foundRes.body).toEqual(created);

      const missingRes = await request(app).get('/orders/ord-unknown');
      expect(missingRes.status).toBe(404);
    });
  });
});
