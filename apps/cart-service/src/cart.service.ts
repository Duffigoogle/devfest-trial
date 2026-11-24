import {
  BadRequestException,
  CloudLogger,
  CloudPubSubEventBus,
  ConflictException,
  DomainEventEnvelope,
  DomainEventType,
  NotFoundException,
  OrderCancelledPayload,
  OrderConfirmedPayload,
  PubSubTopic,
  UnprocessableEntityException,
} from '../../../libs/shared/src';

export interface ProductGrpcClientPort {
  validateProductSkuGrpc(
    request: { productId: string; requestedQuantity: number },
    correlationId?: string,
  ): {
    exists: boolean;
    isActive: boolean;
    hasSufficientStock: boolean;
    productId: string;
    sku: string;
    name: string;
    unitPriceCents: number;
    availableQty: number;
  };
}

export interface CartItemEntity {
  productId: string;
  sku: string;
  productName: string;
  unitPriceCents: number;
  quantity: number;
}

export interface CartEntity {
  id: string;
  userId: string;
  status: 'ACTIVE' | 'LOCKED_FOR_CHECKOUT' | 'CHECKED_OUT';
  currency: string;
  items: CartItemEntity[];
  subtotalCents: number;
  expiresAt: string;
}

export class ShoppingCartService {
  private readonly carts = new Map<string, CartEntity>();
  private readonly processedEventIds = new Set<string>();

  constructor(
    private readonly productGrpcClient: ProductGrpcClientPort,
    private readonly eventBus: CloudPubSubEventBus,
    private readonly logger: CloudLogger = new CloudLogger('cart-service'),
  ) {
    this.registerSubscriptions();
  }

  private registerSubscriptions(): void {
    this.eventBus.subscribe<OrderConfirmedPayload>(
      PubSubTopic.ORDERS_EVENTS,
      'cart-service.order-confirmed.sub',
      async (event) => {
        if (event.eventType === DomainEventType.ORDER_CONFIRMED) {
          await this.handleOrderConfirmed(event);
        }
      },
    );

    this.eventBus.subscribe<OrderCancelledPayload>(
      PubSubTopic.ORDERS_EVENTS,
      'cart-service.order-cancelled.sub',
      async (event) => {
        if (event.eventType === DomainEventType.ORDER_CANCELLED) {
          await this.handleOrderCancelled(event);
        }
      },
    );
  }

  private recalculateSubtotal(cart: CartEntity): CartEntity {
    cart.subtotalCents = cart.items.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );
    return cart;
  }

  getActiveCartCount(): number {
    return Array.from(this.carts.values()).filter((c) => c.status === 'ACTIVE').length;
  }

  getOrCreateActiveCart(userId: string, cartId = `cart-${userId}`): CartEntity {
    if (!userId || userId.trim().length === 0) {
      throw new BadRequestException('userId is required');
    }
    const existing = this.carts.get(cartId);
    if (existing) {
      return this.recalculateSubtotal(existing);
    }

    const created: CartEntity = {
      id: cartId,
      userId,
      status: 'ACTIVE',
      currency: 'USD',
      items: [],
      subtotalCents: 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    this.carts.set(cartId, created);
    return created;
  }

  /**
   * Calls Product Service via documented synchronous API/gRPC (`ValidateProductSku`)
   * without accessing `product_db` directly.
   */
  addItemToCart(params: {
    userId: string;
    cartId?: string;
    productId: string;
    quantity: number;
    correlationId?: string;
  }): CartEntity {
    if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive integer');
    }

    const cart = this.getOrCreateActiveCart(params.userId, params.cartId);
    if (cart.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot modify cart '${cart.id}' while in status '${cart.status}'`);
    }

    const existingItem = cart.items.find((i) => i.productId === params.productId);
    const desiredTotalQty = (existingItem?.quantity ?? 0) + params.quantity;

    const validation = this.productGrpcClient.validateProductSkuGrpc(
      {
        productId: params.productId,
        requestedQuantity: desiredTotalQty,
      },
      params.correlationId,
    );

    if (!validation.exists || !validation.isActive) {
      throw new NotFoundException(`Product '${params.productId}' is unavailable or inactive`);
    }
    if (!validation.hasSufficientStock) {
      throw new UnprocessableEntityException(
        `Insufficient stock for SKU ${validation.sku}: requested ${desiredTotalQty}, available ${validation.availableQty}`,
      );
    }

    if (existingItem) {
      existingItem.quantity = desiredTotalQty;
      existingItem.unitPriceCents = validation.unitPriceCents;
      existingItem.productName = validation.name;
    } else {
      cart.items.push({
        productId: validation.productId,
        sku: validation.sku,
        productName: validation.name,
        unitPriceCents: validation.unitPriceCents,
        quantity: params.quantity,
      });
    }

    this.recalculateSubtotal(cart);
    this.logger.log('INFO', `Added ${params.quantity}x ${validation.sku} to cart ${cart.id}`, {
      correlationId: params.correlationId,
      metadata: { cartId: cart.id, userId: params.userId, subtotalCents: cart.subtotalCents },
    });
    return cart;
  }

  updateItemQuantity(params: {
    userId: string;
    productId: string;
    quantity: number;
    correlationId?: string;
  }): CartEntity {
    const cart = this.getOrCreateActiveCart(params.userId);
    if (cart.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot modify cart '${cart.id}' while in status '${cart.status}'`);
    }

    const item = cart.items.find((i) => i.productId === params.productId);
    if (!item) {
      throw new NotFoundException(`Product '${params.productId}' is not in cart '${cart.id}'`);
    }

    const validation = this.productGrpcClient.validateProductSkuGrpc(
      {
        productId: params.productId,
        requestedQuantity: params.quantity,
      },
      params.correlationId,
    );

    if (!validation.hasSufficientStock) {
      throw new UnprocessableEntityException(
        `Insufficient stock for SKU ${item.sku}: requested ${params.quantity}, available ${validation.availableQty}`,
      );
    }

    item.quantity = params.quantity;
    item.unitPriceCents = validation.unitPriceCents;
    this.recalculateSubtotal(cart);
    this.logger.log('INFO', `Updated quantity for ${item.sku} in cart ${cart.id}`, {
      correlationId: params.correlationId,
      metadata: { cartId: cart.id, quantity: params.quantity },
    });
    return cart;
  }

  removeItemFromCart(params: {
    userId: string;
    productId: string;
    correlationId?: string;
  }): CartEntity {
    const cart = this.getOrCreateActiveCart(params.userId);
    if (cart.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot modify cart '${cart.id}' while in status '${cart.status}'`);
    }

    const idx = cart.items.findIndex((i) => i.productId === params.productId);
    if (idx === -1) {
      throw new NotFoundException(`Product '${params.productId}' is not in cart '${cart.id}'`);
    }

    const [removed] = cart.items.splice(idx, 1);
    this.recalculateSubtotal(cart);
    this.logger.log('INFO', `Removed ${removed.sku} from cart ${cart.id}`, {
      correlationId: params.correlationId,
    });
    return cart;
  }

  getAndLockCartSnapshotGrpc(
    request: { cartId: string; userId: string },
    correlationId?: string,
  ) {
    const cart = this.carts.get(request.cartId);
    if (!cart || cart.userId !== request.userId) {
      throw new NotFoundException(`Cart '${request.cartId}' not found for user '${request.userId}'`);
    }
    if (cart.items.length === 0) {
      throw new BadRequestException(`Cart '${request.cartId}' is empty`);
    }

    cart.status = 'LOCKED_FOR_CHECKOUT';
    this.recalculateSubtotal(cart);

    this.logger.log('INFO', `Locked cart ${cart.id} for checkout snapshot`, {
      correlationId,
      metadata: { cartId: cart.id, userId: cart.userId, totalCents: cart.subtotalCents },
    });

    return {
      cartId: cart.id,
      userId: cart.userId,
      status: cart.status,
      items: cart.items.map((item) => ({ ...item })),
      totalCents: cart.subtotalCents,
      currency: cart.currency,
    };
  }

  async handleOrderConfirmed(event: DomainEventEnvelope<OrderConfirmedPayload>): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const cart = this.carts.get(event.payload.cartId);
    if (cart) {
      cart.status = 'CHECKED_OUT';
      cart.items = [];
      cart.subtotalCents = 0;
      this.logger.log('INFO', `Cleared checked-out cart ${cart.id} on order.confirmed`, {
        correlationId: event.correlationId,
      });
    }
  }

  async handleOrderCancelled(event: DomainEventEnvelope<OrderCancelledPayload>): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const cart = this.carts.get(event.payload.cartId);
    if (cart && cart.status === 'LOCKED_FOR_CHECKOUT') {
      cart.status = 'ACTIVE';
      this.logger.log('INFO', `Unlocked cart ${cart.id} back to ACTIVE after order.cancelled`, {
        correlationId: event.correlationId,
      });
    }
  }
}
