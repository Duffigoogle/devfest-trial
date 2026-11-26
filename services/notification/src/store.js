class NotificationStore {
  constructor() {
    this.notifications = [];
  }

  reset() {
    this.notifications = [];
  }

  list() {
    return [...this.notifications];
  }

  record({ orderId, customerEmail, total, items = [], createdAt, logLine }) {
    const notificationId = `notif-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const notification = {
      notificationId,
      eventType: 'order.placed',
      orderId,
      customerEmail,
      total: Number(total),
      items,
      createdAt: createdAt || new Date().toISOString(),
      message: logLine,
      sentAt: new Date().toISOString()
    };
    this.notifications.unshift(notification);
    return notification;
  }
}

module.exports = new NotificationStore();
module.exports.NotificationStore = NotificationStore;
