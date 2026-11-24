export enum PubSubTopic {
  ORDERS_EVENTS = 'cloudmart.orders.events',
  INVENTORY_EVENTS = 'cloudmart.inventory.events',
  PAYMENTS_EVENTS = 'cloudmart.payments.events',
}

export enum DomainEventType {
  ORDER_CREATED = 'order.created',
  ORDER_CONFIRMED = 'order.confirmed',
  ORDER_CANCELLED = 'order.cancelled',
  INVENTORY_RESERVED = 'inventory.reserved',
  INVENTORY_INSUFFICIENT = 'inventory.insufficient',
  PAYMENT_INTENT_CREATED = 'payment.intent_created',
  PAYMENT_SUCCEEDED = 'payment.succeeded',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_REFUNDED = 'payment.refunded',
}

export interface DomainEventEnvelope<TPayload = unknown> {
  eventId: string;
  eventType: DomainEventType;
  occurredAt: string;
  correlationId: string;
  traceparent?: string;
  producerService: string;
  schemaVersion: '1.0';
  payload: TPayload;
}

export interface OrderLineItemPayload {
  productId: string;
  sku: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
}

export interface OrderCreatedPayload {
  orderId: string;
  userId: string;
  cartId: string;
  totalCents: number;
  currency: string;
  items: OrderLineItemPayload[];
  customerEmail: string;
}

export interface InventoryReservedPayload {
  orderId: string;
  reservationId: string;
  userId: string;
  totalCents: number;
  currency: string;
  customerEmail: string;
  expiresAt: string;
}

export interface InventoryInsufficientPayload {
  orderId: string;
  userId: string;
  failedSkus: Array<{
    productId: string;
    sku: string;
    requestedQty: number;
    availableQty: number;
  }>;
  customerEmail: string;
}

export interface PaymentIntentCreatedPayload {
  orderId: string;
  paymentTransactionId: string;
  providerPaymentIntentId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
}

export interface PaymentSucceededPayload {
  orderId: string;
  paymentTransactionId: string;
  providerPaymentIntentId: string;
  amountCents: number;
  currency: string;
  paidAt: string;
}

export interface PaymentFailedPayload {
  orderId: string;
  paymentTransactionId: string;
  reason: string;
  failedAt: string;
}

export interface OrderConfirmedPayload {
  orderId: string;
  userId: string;
  cartId: string;
  totalCents: number;
  currency: string;
  customerEmail: string;
  confirmedAt: string;
}

export interface OrderCancelledPayload {
  orderId: string;
  userId: string;
  cartId: string;
  reason: 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'CUSTOMER_REQUEST';
  customerEmail: string;
  cancelledAt: string;
}
