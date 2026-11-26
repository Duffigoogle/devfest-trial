class PaymentStore {
  constructor() {
    this.payments = new Map();
  }

  reset() {
    this.payments.clear();
  }

  list() {
    return Array.from(this.payments.values());
  }

  getById(paymentId) {
    return this.payments.get(paymentId) || null;
  }

  record({ orderId, amount, status }) {
    const paymentId = `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const payment = {
      paymentId,
      orderId,
      amount: Number(amount),
      status,
      processedAt: new Date().toISOString()
    };
    this.payments.set(paymentId, payment);
    return payment;
  }
}

module.exports = new PaymentStore();
module.exports.PaymentStore = PaymentStore;
