import {
  CloudLogger,
  CloudPubSubEventBus,
  ConflictException,
  DomainEventEnvelope,
  DomainEventType,
  InventoryInsufficientPayload,
  InventoryReservedPayload,
  NotFoundException,
  OrderCancelledPayload,
  OrderConfirmedPayload,
  OrderCreatedPayload,
  OrderLineItemPayload,
  PaymentFailedPayload,
  PaymentIntentCreatedPayload,
  PaymentSucceededPayload,
  PubSubTopic,
} from '../../../libs/shared/src';

export type OrderStatus =
  | 'PENDING_INVENTORY'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMED'
  | 'CANCELLED_OUT_OF_STOCK'
  | 'PAYMENT_FAILED'
  | 'CANCELLED_BY_CUSTOMER';

export interface CartGrpcClientPort {
  getAndLockCartSnapshotGrpc(
    request: { cartId: string; userId: string },
    correlationId?: string,
  ): {
    cartId: string;
    userId: string;
    status: string;
    items: OrderLineItemPayload[];
    totalCents: number;
    currency: string;
  };
}

export interface OrderEntity {
  id: string;
  userId: string;
  cartId: string;
  idempotencyKey: string;
  customerEmail: string;
  shippingAddress: string;
  status: OrderStatus;
  totalCents: number;
  currency: string;
  items: OrderLineItemPayload[];
  paymentClientSecret?: string;
  paymentTransactionId?: string;
  sagaHistory: string[];
  createdAt: string;
  updatedAt: string;
}

export class OrderSagaService {
  private readonly orders = new Map<string, OrderEntity>();
  private readonly ordersByIdempotencyKey = new Map<string, string>();
  private readonly processedEventIds = new Set<string>();
  private readonly outbox: Array<DomainEventEnvelope<any>> = [];

  constructor(
    private readonly cartGrpcClient: CartGrpcClientPort,
    private readonly eventBus: CloudPubSubEventBus,
    private readonly logger: CloudLogger = new CloudLogger('order-service'),
  ) {
    this.registerSubscriptions();
  }

  private registerSubscriptions(): void {
    this.eventBus.subscribe<InventoryReservedPayload>(
      PubSubTopic.INVENTORY_EVENTS,
      'order-service.inventory-reserved.sub',
      async (event) => {
        if (event.eventType === DomainEventType.INVENTORY_RESERVED) {
          await this.handleInventoryReserved(event);
        }
      },
    );

    this.eventBus.subscribe<InventoryInsufficientPayload>(
      PubSubTopic.INVENTORY_EVENTS,
      'order-service.inventory-insufficient.sub',
      async (event) => {
        if (event.eventType === DomainEventType.INVENTORY_INSUFFICIENT) {
          await this.handleInventoryInsufficient(event);
        }
      },
    );

    this.eventBus.subscribe<PaymentIntentCreatedPayload>(
      PubSubTopic.PAYMENTS_EVENTS,
      'order-service.payment-intent-created.sub',
      async (event) => {
        if (event.eventType === DomainEventType.PAYMENT_INTENT_CREATED) {
          await this.handlePaymentIntentCreated(event);
        }
      },
    );

    this.eventBus.subscribe<PaymentSucceededPayload>(
      PubSubTopic.PAYMENTS_EVENTS,
      'order-service.payment-succeeded.sub',
      async (event) => {
        if (event.eventType === DomainEventType.PAYMENT_SUCCEEDED) {
          await this.handlePaymentSucceeded(event);
        }
      },
    );

    this.eventBus.subscribe<PaymentFailedPayload>(
      PubSubTopic.PAYMENTS_EVENTS,
      'order-service.payment-failed.sub',
      async (event) => {
        if (event.eventType === DomainEventType.PAYMENT_FAILED) {
          await this.handlePaymentFailed(event);
        }
      },
    );
  }

  getTotalOrderCount(): number {
    return this.orders.size;
  }

  /**
   * Saga Step 1: Checkout initiation (HTTP 202 Accepted).
   * Enforces idempotency, snapshots the cart via documented Cart Service API/gRPC,
   * saves Order + Outbox in a local transaction, and emits `order.created`.
   */
  async createCheckoutOrder(params: {
    orderId?: string;
    userId: string;
    cartId: string;
    idempotencyKey: string;
    customerEmail: string;
    shippingAddress: string;
    correlationId?: string;
  }): Promise<OrderEntity> {
    const existingOrderId = this.ordersByIdempotencyKey.get(params.idempotencyKey);
    if (existingOrderId) {
      const existingOrder = this.orders.get(existingOrderId)!;
      this.logger.log('INFO', `Idempotent replay for key ${params.idempotencyKey} -> ${existingOrder.id}`, {
        correlationId: params.correlationId,
      });
      return existingOrder;
    }

    const cartSnapshot = this.cartGrpcClient.getAndLockCartSnapshotGrpc(
      {
        cartId: params.cartId,
        userId: params.userId,
      },
      params.correlationId,
    );

    const orderId = params.orderId ?? `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();

    const order: OrderEntity = {
      id: orderId,
      userId: params.userId,
      cartId: params.cartId,
      idempotencyKey: params.idempotencyKey,
      customerEmail: params.customerEmail,
      shippingAddress: params.shippingAddress,
      status: 'PENDING_INVENTORY',
      totalCents: cartSnapshot.totalCents,
      currency: cartSnapshot.currency,
      items: cartSnapshot.items,
      sagaHistory: ['ORDER_CREATED:PENDING_INVENTORY'],
      createdAt: now,
      updatedAt: now,
    };

    this.orders.set(order.id, order);
    this.ordersByIdempotencyKey.set(params.idempotencyKey, order.id);

    const correlationId = params.correlationId ?? `corr-${order.id}`;
    this.logger.log('INFO', `Created checkout order ${order.id} (PENDING_INVENTORY)`, {
      correlationId,
      metadata: { orderId: order.id, userId: order.userId, totalCents: order.totalCents },
    });

    const orderCreatedEvent: DomainEventEnvelope<OrderCreatedPayload> = {
      eventId: `evt-ord-created-${order.id}`,
      eventType: DomainEventType.ORDER_CREATED,
      occurredAt: now,
      correlationId,
      producerService: 'order-service',
      schemaVersion: '1.0',
      payload: {
        orderId: order.id,
        userId: order.userId,
        cartId: order.cartId,
        totalCents: order.totalCents,
        currency: order.currency,
        items: order.items,
        customerEmail: order.customerEmail,
      },
    };

    this.outbox.push(orderCreatedEvent);
    await this.eventBus.publish(PubSubTopic.ORDERS_EVENTS, orderCreatedEvent);

    return order;
  }

  async cancelOrderByCustomer(orderId: string, correlationId?: string): Promise<OrderEntity> {
    const order = this.getOrderOrThrow(orderId);
    if (order.status === 'CONFIRMED') {
      throw new ConflictException(`Confirmed order '${orderId}' cannot be cancelled directly`);
    }
    if (
      order.status === 'CANCELLED_BY_CUSTOMER' ||
      order.status === 'CANCELLED_OUT_OF_STOCK' ||
      order.status === 'PAYMENT_FAILED'
    ) {
      return order;
    }

    order.status = 'CANCELLED_BY_CUSTOMER';
    order.sagaHistory.push('CUSTOMER_CANCELLED:CANCELLED_BY_CUSTOMER');
    order.updatedAt = new Date().toISOString();

    const cancelledEvent: DomainEventEnvelope<OrderCancelledPayload> = {
      eventId: `evt-ord-cancel-cust-${order.id}`,
      eventType: DomainEventType.ORDER_CANCELLED,
      occurredAt: order.updatedAt,
      correlationId: correlationId || `corr-${order.id}`,
      producerService: 'order-service',
      schemaVersion: '1.0',
      payload: {
        orderId: order.id,
        userId: order.userId,
        cartId: order.cartId,
        reason: 'CUSTOMER_REQUEST',
        customerEmail: order.customerEmail,
        cancelledAt: order.updatedAt,
      },
    };

    this.outbox.push(cancelledEvent);
    await this.eventBus.publish(PubSubTopic.ORDERS_EVENTS, cancelledEvent);
    return order;
  }

  private async handleInventoryReserved(
    event: DomainEventEnvelope<InventoryReservedPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const order = this.orders.get(event.payload.orderId);
    if (!order) return;

    order.sagaHistory.push(`INVENTORY_RESERVED:${event.payload.reservationId}`);
    order.updatedAt = new Date().toISOString();
  }

  private async handleInventoryInsufficient(
    event: DomainEventEnvelope<InventoryInsufficientPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const order = this.orders.get(event.payload.orderId);
    if (!order || order.status === 'CONFIRMED') return;

    order.status = 'CANCELLED_OUT_OF_STOCK';
    order.sagaHistory.push('INVENTORY_INSUFFICIENT:CANCELLED_OUT_OF_STOCK');
    order.updatedAt = new Date().toISOString();

    const cancelledEvent: DomainEventEnvelope<OrderCancelledPayload> = {
      eventId: `evt-ord-cancel-stock-${order.id}`,
      eventType: DomainEventType.ORDER_CANCELLED,
      occurredAt: order.updatedAt,
      correlationId: event.correlationId,
      producerService: 'order-service',
      schemaVersion: '1.0',
      payload: {
        orderId: order.id,
        userId: order.userId,
        cartId: order.cartId,
        reason: 'OUT_OF_STOCK',
        customerEmail: order.customerEmail,
        cancelledAt: order.updatedAt,
      },
    };

    this.outbox.push(cancelledEvent);
    await this.eventBus.publish(PubSubTopic.ORDERS_EVENTS, cancelledEvent);
  }

  private async handlePaymentIntentCreated(
    event: DomainEventEnvelope<PaymentIntentCreatedPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const order = this.orders.get(event.payload.orderId);
    if (!order) return;

    if (order.status === 'PENDING_INVENTORY') {
      order.status = 'AWAITING_PAYMENT';
    }
    order.paymentClientSecret = event.payload.clientSecret;
    order.paymentTransactionId = event.payload.paymentTransactionId;
    order.sagaHistory.push(`PAYMENT_INTENT_CREATED:${event.payload.paymentTransactionId}`);
    order.updatedAt = new Date().toISOString();
  }

  private async handlePaymentSucceeded(
    event: DomainEventEnvelope<PaymentSucceededPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const order = this.orders.get(event.payload.orderId);
    if (!order || order.status === 'CONFIRMED') return;

    order.status = 'CONFIRMED';
    order.paymentTransactionId = event.payload.paymentTransactionId;
    order.sagaHistory.push('PAYMENT_SUCCEEDED:CONFIRMED');
    order.updatedAt = new Date().toISOString();

    this.logger.log('INFO', `Order ${order.id} CONFIRMED`, {
      correlationId: event.correlationId,
    });

    const confirmedEvent: DomainEventEnvelope<OrderConfirmedPayload> = {
      eventId: `evt-ord-confirmed-${order.id}`,
      eventType: DomainEventType.ORDER_CONFIRMED,
      occurredAt: order.updatedAt,
      correlationId: event.correlationId,
      producerService: 'order-service',
      schemaVersion: '1.0',
      payload: {
        orderId: order.id,
        userId: order.userId,
        cartId: order.cartId,
        totalCents: order.totalCents,
        currency: order.currency,
        customerEmail: order.customerEmail,
        confirmedAt: order.updatedAt,
      },
    };

    this.outbox.push(confirmedEvent);
    await this.eventBus.publish(PubSubTopic.ORDERS_EVENTS, confirmedEvent);
  }

  private async handlePaymentFailed(
    event: DomainEventEnvelope<PaymentFailedPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const order = this.orders.get(event.payload.orderId);
    if (!order || order.status === 'CONFIRMED' || order.status === 'PAYMENT_FAILED') return;

    order.status = 'PAYMENT_FAILED';
    order.sagaHistory.push(`PAYMENT_FAILED:${event.payload.reason}`);
    order.updatedAt = new Date().toISOString();

    this.logger.log('WARNING', `Order ${order.id} PAYMENT_FAILED: ${event.payload.reason}`, {
      correlationId: event.correlationId,
    });

    const cancelledEvent: DomainEventEnvelope<OrderCancelledPayload> = {
      eventId: `evt-ord-cancel-pay-${order.id}`,
      eventType: DomainEventType.ORDER_CANCELLED,
      occurredAt: order.updatedAt,
      correlationId: event.correlationId,
      producerService: 'order-service',
      schemaVersion: '1.0',
      payload: {
        orderId: order.id,
        userId: order.userId,
        cartId: order.cartId,
        reason: 'PAYMENT_FAILED',
        customerEmail: order.customerEmail,
        cancelledAt: order.updatedAt,
      },
    };

    this.outbox.push(cancelledEvent);
    await this.eventBus.publish(PubSubTopic.ORDERS_EVENTS, cancelledEvent);
  }

  getOrderById(orderId: string): OrderEntity | undefined {
    return this.orders.get(orderId);
  }

  getOrderOrThrow(orderId: string): OrderEntity {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new NotFoundException(`Order '${orderId}' not found`);
    }
    return order;
  }

  listOrdersByUser(userId: string): OrderEntity[] {
    return Array.from(this.orders.values()).filter((o) => o.userId === userId);
  }

  getOutboxEvents(): Array<DomainEventEnvelope<any>> {
    return [...this.outbox];
  }
}
