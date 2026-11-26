const request = require('supertest');
const { app, store } = require('../src/index');
const rawProducts = require('../src/data/products.json');

describe('Product Service API', () => {
  beforeEach(() => {
    store.load();
  });

  describe('GET /healthz', () => {
    it('returns 200 OK with service health status', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        service: 'product',
        status: 'ok'
      });
    });
  });

  describe('GET /products', () => {
    it('returns all products from the JSON catalogue with id, name, price in naira, imageUrl, and stock', async () => {
      const res = await request(app).get('/products');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(rawProducts.length);
      expect(res.body).toEqual(rawProducts);

      for (const product of res.body) {
        expect(product).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
            price: expect.any(Number),
            imageUrl: expect.any(String),
            stock: expect.any(Number)
          })
        );
        expect(product.price).toBeGreaterThan(0);
      }
    });
  });

  describe('GET /products/:id', () => {
    it('returns a single product by ID when found', async () => {
      const res = await request(app).get('/products/prod-1');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(rawProducts[0]);
    });

    it('returns 404 when the product ID does not exist', async () => {
      const res = await request(app).get('/products/prod-999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
