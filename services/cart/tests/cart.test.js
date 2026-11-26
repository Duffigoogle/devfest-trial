const request = require('supertest');
const { app, store } = require('../src/index');

describe('Cart Service API', () => {
  const MOCK_PRODUCT_URL = 'http://mock-product-service:8081';
  const originalFetch = global.fetch;
  const originalProductUrl = process.env.PRODUCT_URL;

  beforeEach(() => {
    store.reset();
    process.env.PRODUCT_URL = MOCK_PRODUCT_URL;
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalProductUrl === undefined) {
      delete process.env.PRODUCT_URL;
    } else {
      process.env.PRODUCT_URL = originalProductUrl;
    }
  });

  describe('GET /healthz', () => {
    it('returns 200 OK with service health status', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        service: 'cart',
        status: 'ok'
      });
    });
  });

  describe('GET /carts/:cartId', () => {
    it('returns an empty cart when cartId has no items yet', async () => {
      const res = await request(app).get('/carts/cart-100');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        cartId: 'cart-100',
        items: [],
        total: 0,
        updatedAt: expect.any(String)
      });
    });
  });

  describe('POST /carts/:cartId/items', () => {
    it('checks product existence at PRODUCT_URL and adds the item to the cart', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'prod-1',
          name: 'Cloud Run Developer Hoodie',
          price: 35000,
          imageUrl: '/images/cloud-run-hoodie.jpg',
          stock: 25
        })
      });

      const res = await request(app)
        .post('/carts/cart-100/items')
        .send({ productId: 'prod-1', quantity: 2 });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_PRODUCT_URL}/products/prod-1`
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        cartId: 'cart-100',
        items: [
          {
            productId: 'prod-1',
            name: 'Cloud Run Developer Hoodie',
            price: 35000,
            imageUrl: '/images/cloud-run-hoodie.jpg',
            quantity: 2
          }
        ],
        total: 70000,
        updatedAt: expect.any(String)
      });
    });

    it('increments quantity when the same product is added again', async () => {
      const mockProductResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'prod-2',
          name: 'GKE Kubernetes Captain Mug',
          price: 12500,
          imageUrl: '/images/gke-mug.jpg',
          stock: 40
        })
      };
      global.fetch
        .mockResolvedValueOnce(mockProductResponse)
        .mockResolvedValueOnce(mockProductResponse);

      await request(app)
        .post('/carts/cart-200/items')
        .send({ productId: 'prod-2', quantity: 1 });

      const res = await request(app)
        .post('/carts/cart-200/items')
        .send({ productId: 'prod-2', quantity: 3 });

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(4);
      expect(res.body.total).toBe(50000);
    });

    it('returns 404 and does not modify the cart when the product does not exist in the product service', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Product prod-999 not found' })
      });

      const res = await request(app)
        .post('/carts/cart-100/items')
        .send({ productId: 'prod-999', quantity: 1 });

      expect(global.fetch).toHaveBeenCalledWith(
        `${MOCK_PRODUCT_URL}/products/prod-999`
      );
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');

      const cartRes = await request(app).get('/carts/cart-100');
      expect(cartRes.body.items).toEqual([]);
    });

    it('returns 400 when productId or quantity is invalid without calling the product service', async () => {
      const res = await request(app)
        .post('/carts/cart-100/items')
        .send({ productId: 'prod-1', quantity: 0 });

      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /carts/:cartId', () => {
    it('deletes all items in the specified cart', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'prod-1',
          name: 'Cloud Run Developer Hoodie',
          price: 35000,
          imageUrl: '/images/cloud-run-hoodie.jpg',
          stock: 25
        })
      });

      await request(app)
        .post('/carts/cart-300/items')
        .send({ productId: 'prod-1', quantity: 1 });

      const delRes = await request(app).delete('/carts/cart-300');
      expect(delRes.status).toBe(200);
      expect(delRes.body).toEqual({
        cartId: 'cart-300',
        items: [],
        total: 0,
        updatedAt: expect.any(String)
      });

      const getRes = await request(app).get('/carts/cart-300');
      expect(getRes.body.items).toEqual([]);
      expect(getRes.body.total).toBe(0);
    });
  });
});
