class OrderStore {
  constructor() {
    this.orders = new Map();
  }

  reset() {
    this.orders.clear();
  }

  list() {
    return Array.from(this.orders.values());
  }

  getById(orderId) {
    return this.orders.get(orderId) || null;
  }

  create({ orderId, cartId, items, total, customerEmail, status, paymentId, createdAt }) {
    const order = {
      orderId,
      cartId,
      items,
      total: Number(total),
      customerEmail,
      status,
      paymentId,
      createdAt: createdAt || new Date().toISOString()
    };
    this.orders.set(orderId, order);
    return order;
  }
}

module.exports = new OrderStore();
module.exports.OrderStore = OrderStore;
