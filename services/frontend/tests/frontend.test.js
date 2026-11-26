const request = require('supertest');
const { app } = require('../src/index');

describe('Frontend Service API & Storefront', () => {
  const MOCK_PRODUCT_URL = 'http://mock-product:8081';
  const MOCK_CART_URL = 'http://mock-cart:8082';
  const MOCK_ORDER_URL = 'http://mock-order:8083';

  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PRODUCT_URL = MOCK_PRODUCT_URL;
    process.env.CART_URL = MOCK_CART_URL;
    process.env.ORDER_URL = MOCK_ORDER_URL;
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
        service: 'frontend',
        status: 'ok'
      });
    });
  });

  describe('GET / (Storefront HTML)', () => {
    it('serves the CloudMart storefront HTML with Naira formatting, localStorage cartId, and checkout email form', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('<h1>CloudMart</h1>');
      expect(res.text).toContain('localStorage');
      expect(res.text).toContain('₦');
      expect(res.text).toContain('id="checkoutForm"');
      expect(res.text).toContain('type="email"');
    });
  });

  describe('Proxy Endpoints', () => {
    it('proxies GET /api/products to PRODUCT_URL/products', async () => {
      const mockProducts = [
        { id: 'prod-1', name: 'Cloud Run Developer Hoodie', price: 35000, stock: 25 }
      ];
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProducts
      });

      const res = await request(app).get('/api/products');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockProducts);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_PRODUCT_URL}/products`,
        expect.any(Object)
      );
    });

    it('proxies GET and POST /api/carts/:cartId to CART_URL', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ cartId: 'cart-abc', items: [], total: 0 })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            cartId: 'cart-abc',
            items: [{ productId: 'prod-1', name: 'Hoodie', price: 35000, quantity: 1 }],
            total: 35000
          })
        });

      const getRes = await request(app).get('/api/carts/cart-abc');
      expect(getRes.status).toBe(200);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        `${MOCK_CART_URL}/carts/cart-abc`,
        expect.any(Object)
      );

      const postRes = await request(app)
        .post('/api/carts/cart-abc/items')
        .send({ productId: 'prod-1', quantity: 1 });
      expect(postRes.status).toBe(200);
      expect(postRes.body.total).toBe(35000);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        `${MOCK_CART_URL}/carts/cart-abc/items`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ productId: 'prod-1', quantity: 1 })
        })
      );
    });

    it('proxies POST /api/orders to ORDER_URL/orders', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          orderId: 'ord-777',
          cartId: 'cart-abc',
          total: 35000,
          customerEmail: 'ada@example.com',
          status: 'placed'
        })
      });

      const res = await request(app)
        .post('/api/orders')
        .send({ cartId: 'cart-abc', customerEmail: 'ada@example.com' });

      expect(res.status).toBe(201);
      expect(res.body.orderId).toBe('ord-777');
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_ORDER_URL}/orders`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ cartId: 'cart-abc', customerEmail: 'ada@example.com' })
        })
      );
    });
  });
});
