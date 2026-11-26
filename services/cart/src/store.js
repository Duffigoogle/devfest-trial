class CartStore {
  constructor() {
    this.carts = new Map();
  }

  reset() {
    this.carts.clear();
  }

  getCart(cartId) {
    if (!this.carts.has(cartId)) {
      return {
        cartId,
        items: [],
        total: 0,
        updatedAt: new Date().toISOString()
      };
    }
    const cart = this.carts.get(cartId);
    return {
      ...cart,
      items: cart.items.map((item) => ({ ...item }))
    };
  }

  upsertItem(cartId, { productId, name, price, imageUrl, quantity }) {
    const cart = this.getCart(cartId);
    const existingIndex = cart.items.findIndex((i) => i.productId === productId);

    if (existingIndex >= 0) {
      cart.items[existingIndex].quantity += quantity;
      cart.items[existingIndex].price = price;
      cart.items[existingIndex].name = name;
      if (imageUrl !== undefined) {
        cart.items[existingIndex].imageUrl = imageUrl;
      }
    } else {
      const newItem = { productId, name, price, quantity };
      if (imageUrl !== undefined) {
        newItem.imageUrl = imageUrl;
      }
      cart.items.push(newItem);
    }

    return this._recalculateAndSave(cartId, cart.items);
  }

  clearCart(cartId) {
    this.carts.delete(cartId);
    return {
      cartId,
      items: [],
      total: 0,
      updatedAt: new Date().toISOString()
    };
  }

  _recalculateAndSave(cartId, items) {
    const total = Number(
      items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
    );
    const updated = {
      cartId,
      items,
      total,
      updatedAt: new Date().toISOString()
    };
    this.carts.set(cartId, updated);
    return this.getCart(cartId);
  }
}

module.exports = new CartStore();
module.exports.CartStore = CartStore;
