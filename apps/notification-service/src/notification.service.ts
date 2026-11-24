import {
  CloudLogger,
  CloudPubSubEventBus,
  DomainEventEnvelope,
  DomainEventType,
  OrderCancelledPayload,
  OrderConfirmedPayload,
  PubSubTopic,
} from '../../../libs/shared/src';
import { SendNotificationDto } from './dto/notification.dto';

export interface NotificationLogEntity {
  id: string;
  sourceEventId: string;
  orderId: string;
  recipientUserId: string;
  recipientEmail: string;
  channel: 'EMAIL' | 'SMS';
  templateKey: 'ORDER_CONFIRMED_EMAIL' | 'ORDER_CANCELLED_EMAIL' | 'CUSTOM_ALERT';
  subject: string;
  bodyText: string;
  status: 'SENT';
  correlationId: string;
  sentAt: string;
}

export class NotificationDispatchService {
  private readonly logs: NotificationLogEntity[] = [];
  private readonly processedEventIds = new Set<string>();

  constructor(
    private readonly eventBus: CloudPubSubEventBus,
    private readonly logger: CloudLogger = new CloudLogger('notification-service'),
  ) {
    this.registerSubscriptions();
  }

  private registerSubscriptions(): void {
    this.eventBus.subscribe<OrderConfirmedPayload>(
      PubSubTopic.ORDERS_EVENTS,
      'notification-service.order-confirmed.sub',
      async (event) => {
        if (event.eventType === DomainEventType.ORDER_CONFIRMED) {
          await this.handleOrderConfirmed(event);
        }
      },
    );

    this.eventBus.subscribe<OrderCancelledPayload>(
      PubSubTopic.ORDERS_EVENTS,
      'notification-service.order-cancelled.sub',
      async (event) => {
        if (event.eventType === DomainEventType.ORDER_CANCELLED) {
          await this.handleOrderCancelled(event);
        }
      },
    );
  }

  async handleOrderConfirmed(
    event: DomainEventEnvelope<OrderConfirmedPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const { orderId, userId, customerEmail, totalCents, currency } = event.payload;
    const formattedAmount = `${(totalCents / 100).toFixed(2)} ${currency}`;

    const entry: NotificationLogEntity = {
      id: `notif-${event.eventId}`,
      sourceEventId: event.eventId,
      orderId,
      recipientUserId: userId,
      recipientEmail: customerEmail,
      channel: 'EMAIL',
      templateKey: 'ORDER_CONFIRMED_EMAIL',
      subject: `CloudMart Order Confirmed (#${orderId})`,
      bodyText: `Thank you for your purchase! Your order #${orderId} for ${formattedAmount} has been confirmed and is being prepared for shipment.`,
      status: 'SENT',
      correlationId: event.correlationId,
      sentAt: new Date().toISOString(),
    };
    this.logs.push(entry);

    this.logger.log('INFO', `Dispatched ORDER_CONFIRMED_EMAIL for order ${orderId}`, {
      correlationId: event.correlationId,
      metadata: { orderId, recipientEmail: customerEmail },
    });
  }

  async handleOrderCancelled(
    event: DomainEventEnvelope<OrderCancelledPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const { orderId, userId, customerEmail, reason } = event.payload;

    const entry: NotificationLogEntity = {
      id: `notif-${event.eventId}`,
      sourceEventId: event.eventId,
      orderId,
      recipientUserId: userId,
      recipientEmail: customerEmail,
      channel: 'EMAIL',
      templateKey: 'ORDER_CANCELLED_EMAIL',
      subject: `CloudMart Order Update (#${orderId})`,
      bodyText: `Your order #${orderId} could not be completed (Reason: ${reason}). Any reserved stock has been released and your cart remains available.`,
      status: 'SENT',
      correlationId: event.correlationId,
      sentAt: new Date().toISOString(),
    };
    this.logs.push(entry);

    this.logger.log('INFO', `Dispatched ORDER_CANCELLED_EMAIL for order ${orderId}`, {
      correlationId: event.correlationId,
      metadata: { orderId, reason },
    });
  }

  sendManualNotification(dto: SendNotificationDto, correlationId = `corr-manual-${Date.now()}`): NotificationLogEntity {
    const entry: NotificationLogEntity = {
      id: `notif-manual-${this.logs.length + 1}`,
      sourceEventId: `manual-${Date.now()}-${this.logs.length + 1}`,
      orderId: dto.orderId,
      recipientUserId: dto.recipientUserId,
      recipientEmail: dto.recipientEmail,
      channel: dto.channel,
      templateKey: dto.templateKey,
      subject: dto.subject,
      bodyText: dto.bodyText,
      status: 'SENT',
      correlationId,
      sentAt: new Date().toISOString(),
    };
    this.logs.push(entry);

    this.logger.log('INFO', `Dispatched manual ${dto.channel} notification for order ${dto.orderId}`, {
      correlationId,
    });
    return entry;
  }

  getNotificationsForOrder(orderId: string): NotificationLogEntity[] {
    return this.logs.filter((l) => l.orderId === orderId);
  }

  getAllLogs(recipientUserId?: string): NotificationLogEntity[] {
    if (recipientUserId) {
      return this.logs.filter((l) => l.recipientUserId === recipientUserId);
    }
    return [...this.logs];
  }
}
