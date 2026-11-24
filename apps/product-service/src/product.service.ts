import {
  BadRequestException,
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
  PubSubTopic,
} from '../../../libs/shared/src';
import { CreateProductDto, UpdateStockDto } from './dto/product.dto';

export interface ProductEntity {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  currency: string;
  isActive: boolean;
  availableQty: number;
  reservedQty: number;
  version: number;
}

export interface StockReservationEntity {
  id: string;
  orderId: string;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED';
  items: Array<{ productId: string; sku: string; quantity: number }>;
  expiresAt: string;
}

export class ProductCatalogAndInventoryService {
  private readonly products = new Map<string, ProductEntity>();
  private readonly reservationsByOrder = new Map<string, StockReservationEntity>();
  private readonly processedEventIds = new Set<string>();
  private readonly outbox: Array<DomainEventEnvelope<any>> = [];

  constructor(
    private readonly eventBus: CloudPubSubEventBus,
    private readonly logger: CloudLogger = new CloudLogger('product-service'),
  ) {
    this.registerSubscriptions();
  }

  private registerSubscriptions(): void {
    this.eventBus.subscribe<OrderCreatedPayload>(
      PubSubTopic.ORDERS_EVENTS,
      'product-service.order-created.sub',
      async (event) => {
        if (event.eventType === DomainEventType.ORDER_CREATED) {
          await this.handleOrderCreated(event);
        }
      },
    );

    this.eventBus.subscribe<OrderConfirmedPayload>(
      PubSubTopic.ORDERS_EVENTS,
      'product-service.order-confirmed.sub',
      async (event) => {
        if (event.eventType === DomainEventType.ORDER_CONFIRMED) {
          await this.handleOrderConfirmed(event);
        }
      },
    );

    this.eventBus.subscribe<OrderCancelledPayload>(
      PubSubTopic.ORDERS_EVENTS,
      'product-service.order-cancelled.sub',
      async (event) => {
        if (event.eventType === DomainEventType.ORDER_CANCELLED) {
          await this.handleOrderCancelled(event);
        }
      },
    );
  }

  createProduct(dto: CreateProductDto, correlationId?: string): ProductEntity {
    for (const existing of this.products.values()) {
      if (existing.sku === dto.sku) {
        throw new ConflictException(`Product with SKU '${dto.sku}' already exists`);
      }
    }

    const id = dto.id || `prod-${dto.sku.toLowerCase()}`;
    const entity: ProductEntity = {
      id,
      sku: dto.sku,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      priceCents: dto.priceCents,
      currency: dto.currency || 'USD',
      isActive: dto.isActive ?? true,
      availableQty: dto.availableQty,
      reservedQty: 0,
      version: 1,
    };

    this.products.set(entity.id, entity);
    this.logger.log('INFO', `Created product ${entity.sku} (${entity.id})`, {
      correlationId,
      metadata: { productId: entity.id, sku: entity.sku, priceCents: entity.priceCents },
    });
    return entity;
  }

  upsertProduct(
    product: Omit<ProductEntity, 'version' | 'reservedQty'> & { reservedQty?: number },
  ): ProductEntity {
    const entity: ProductEntity = {
      ...product,
      reservedQty: product.reservedQty ?? 0,
      version: (this.products.get(product.id)?.version ?? 0) + 1,
    };
    this.products.set(entity.id, entity);
    return entity;
  }

  updateStock(productId: string, dto: UpdateStockDto, correlationId?: string): ProductEntity {
    const product = this.getProductOrThrow(productId);
    const nextQty = product.availableQty + dto.availableQtyDelta;
    if (nextQty < 0) {
      throw new BadRequestException(
        `Cannot reduce available stock below 0 (current: ${product.availableQty}, delta: ${dto.availableQtyDelta})`,
      );
    }

    product.availableQty = nextQty;
    product.version += 1;
    this.logger.log('INFO', `Updated stock for ${product.sku}: ${product.availableQty}`, {
      correlationId,
      metadata: { productId, availableQty: product.availableQty, reason: dto.reason },
    });
    return product;
  }

  listProducts(category?: string): ProductEntity[] {
    const all = Array.from(this.products.values()).filter((p) => p.isActive);
    return category ? all.filter((p) => p.category.toLowerCase() === category.toLowerCase()) : all;
  }

  getProductById(productId: string): ProductEntity | undefined {
    return this.products.get(productId);
  }

  getProductOrThrow(productId: string): ProductEntity {
    const product = this.products.get(productId);
    if (!product) {
      throw new NotFoundException(`Product '${productId}' not found`);
    }
    return product;
  }

  /**
   * Documented Synchronous API/gRPC handler called by Cart Service to validate SKU existence,
   * active status, available stock, and fetch current authoritative price.
   */
  validateProductSkuGrpc(
    request: { productId: string; requestedQuantity: number },
    correlationId?: string,
  ) {
    const product = this.products.get(request.productId);
    this.logger.log('DEBUG', `Validating SKU for productId=${request.productId}`, {
      correlationId,
      metadata: { requestedQuantity: request.requestedQuantity, found: Boolean(product) },
    });

    if (!product) {
      return {
        exists: false,
        isActive: false,
        hasSufficientStock: false,
        productId: request.productId,
        sku: '',
        name: '',
        unitPriceCents: 0,
        availableQty: 0,
      };
    }

    return {
      exists: true,
      isActive: product.isActive,
      hasSufficientStock: product.isActive && product.availableQty >= request.requestedQuantity,
      productId: product.id,
      sku: product.sku,
      name: product.name,
      unitPriceCents: product.priceCents,
      availableQty: product.availableQty,
    };
  }

  async handleOrderCreated(event: DomainEventEnvelope<OrderCreatedPayload>): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const { orderId, userId, items, totalCents, currency, customerEmail } = event.payload;

    const failedSkus: InventoryInsufficientPayload['failedSkus'] = [];
    for (const item of items) {
      const product = this.products.get(item.productId);
      const availableQty = product?.isActive ? product.availableQty : 0;
      if (!product || !product.isActive || availableQty < item.quantity) {
        failedSkus.push({
          productId: item.productId,
          sku: item.sku,
          requestedQty: item.quantity,
          availableQty,
        });
      }
    }

    if (failedSkus.length > 0) {
      this.logger.log('WARNING', `Insufficient stock for order ${orderId}`, {
        correlationId: event.correlationId,
        metadata: { orderId, failedSkus },
      });
      const insufficientEvent: DomainEventEnvelope<InventoryInsufficientPayload> = {
        eventId: `evt-inv-insuff-${orderId}`,
        eventType: DomainEventType.INVENTORY_INSUFFICIENT,
        occurredAt: new Date().toISOString(),
        correlationId: event.correlationId,
        traceparent: event.traceparent,
        producerService: 'product-service',
        schemaVersion: '1.0',
        payload: {
          orderId,
          userId,
          failedSkus,
          customerEmail,
        },
      };
      this.outbox.push(insufficientEvent);
      await this.eventBus.publish(PubSubTopic.INVENTORY_EVENTS, insufficientEvent);
      return;
    }

    for (const item of items) {
      const product = this.products.get(item.productId)!;
      product.availableQty -= item.quantity;
      product.reservedQty += item.quantity;
      product.version += 1;
    }

    const reservationId = `res-${orderId}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    this.reservationsByOrder.set(orderId, {
      id: reservationId,
      orderId,
      status: 'RESERVED',
      items: items.map((i) => ({ productId: i.productId, sku: i.sku, quantity: i.quantity })),
      expiresAt,
    });

    this.logger.log('INFO', `Reserved inventory for order ${orderId}`, {
      correlationId: event.correlationId,
      metadata: { orderId, reservationId },
    });

    const reservedEvent: DomainEventEnvelope<InventoryReservedPayload> = {
      eventId: `evt-inv-res-${orderId}`,
      eventType: DomainEventType.INVENTORY_RESERVED,
      occurredAt: new Date().toISOString(),
      correlationId: event.correlationId,
      traceparent: event.traceparent,
      producerService: 'product-service',
      schemaVersion: '1.0',
      payload: {
        orderId,
        reservationId,
        userId,
        totalCents,
        currency,
        customerEmail,
        expiresAt,
      },
    };
    this.outbox.push(reservedEvent);
    await this.eventBus.publish(PubSubTopic.INVENTORY_EVENTS, reservedEvent);
  }

  async handleOrderConfirmed(event: DomainEventEnvelope<OrderConfirmedPayload>): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const reservation = this.reservationsByOrder.get(event.payload.orderId);
    if (!reservation || reservation.status !== 'RESERVED') {
      return;
    }

    for (const item of reservation.items) {
      const product = this.products.get(item.productId);
      if (product) {
        product.reservedQty = Math.max(0, product.reservedQty - item.quantity);
        product.version += 1;
      }
    }
    reservation.status = 'COMMITTED';
    this.logger.log('INFO', `Committed reserved inventory for confirmed order ${event.payload.orderId}`, {
      correlationId: event.correlationId,
    });
  }

  async handleOrderCancelled(event: DomainEventEnvelope<OrderCancelledPayload>): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const reservation = this.reservationsByOrder.get(event.payload.orderId);
    if (!reservation || reservation.status !== 'RESERVED') {
      return;
    }

    for (const item of reservation.items) {
      const product = this.products.get(item.productId);
      if (product) {
        product.reservedQty = Math.max(0, product.reservedQty - item.quantity);
        product.availableQty += item.quantity;
        product.version += 1;
      }
    }
    reservation.status = 'RELEASED';
    this.logger.log('INFO', `Released reserved inventory for cancelled order ${event.payload.orderId}`, {
      correlationId: event.correlationId,
      metadata: { reason: event.payload.reason },
    });
  }

  getReservationByOrderId(orderId: string): StockReservationEntity | undefined {
    return this.reservationsByOrder.get(orderId);
  }

  getOutboxEvents(): Array<DomainEventEnvelope<any>> {
    return [...this.outbox];
  }
}
