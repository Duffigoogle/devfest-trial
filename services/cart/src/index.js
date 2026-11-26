const express = require('express');
const store = require('./store');

const app = express();
app.use(express.json());

const getProductServiceUrl = () =>
  (process.env.PRODUCT_URL || process.env.PRODUCT_SERVICE_URL || 'http://localhost:8081').replace(/\/+$/, '');

const healthHandler = (_req, res) => {
  res.status(200).json({ service: 'cart', status: 'ok' });
};

app.get('/healthz', healthHandler);
app.get('/health', healthHandler);

const getCartHandler = (req, res) => {
  res.status(200).json(store.getCart(req.params.cartId));
};

app.get('/carts/:cartId', getCartHandler);
app.get('/cart/:cartId', getCartHandler);

const addItemHandler = async (req, res) => {
  const { cartId } = req.params;
  const { productId, quantity } = req.body || {};

  if (
    !productId ||
    typeof productId !== 'string' ||
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    return res
      .status(400)
      .json({ error: 'productId (string) and quantity (positive integer) are required' });
  }

  try {
    const response = await fetch(
      `${getProductServiceUrl()}/products/${encodeURIComponent(productId)}`
    );

    if (response.status === 404) {
      return res.status(404).json({ error: `Product ${productId} not found` });
    }
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to query Product Service' });
    }

    const product = await response.json();

    if (typeof product.stock === 'number') {
      const existingCart = store.getCart(cartId);
      const currentQty =
        existingCart.items.find((i) => i.productId === productId)?.quantity || 0;
      if (currentQty + quantity > product.stock) {
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}`,
          available: product.stock
        });
      }
    }

    const updatedCart = store.upsertItem(cartId, {
      productId: product.id || productId,
      name: product.name,
      price: Number(product.price),
      imageUrl: product.imageUrl,
      quantity
    });

    return res.status(200).json(updatedCart);
  } catch (err) {
    return res.status(502).json({
      error: 'Unable to reach Product Service',
      details: err.message
    });
  }
};

app.post('/carts/:cartId/items', addItemHandler);
app.post('/cart/:cartId/items', addItemHandler);

const deleteCartHandler = (req, res) => {
  res.status(200).json(store.clearCart(req.params.cartId));
};

app.delete('/carts/:cartId', deleteCartHandler);
app.delete('/cart/:cartId', deleteCartHandler);

const PORT = Number(process.env.PORT) || 8082;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[cart] listening on port ${PORT}`);
  });
}

module.exports = { app, store };
