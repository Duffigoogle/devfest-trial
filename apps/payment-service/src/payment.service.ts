import * as crypto from 'crypto';
import {
  CloudLogger,
  CloudPubSubEventBus,
  ConflictException,
  DomainEventEnvelope,
  DomainEventType,
  InventoryReservedPayload,
  NotFoundException,
  PaymentFailedPayload,
  PaymentIntentCreatedPayload,
  PaymentSucceededPayload,
  PubSubTopic,
  UnauthorizedException,
} from '../../../libs/shared/src';
import { SimulatedPaymentToken } from './dto/payment.dto';

export interface PaymentTransactionEntity {
  id: string;
  orderId: string;
  providerPaymentIntentId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
  status: 'INTENT_CREATED' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  simulatedTokenUsed?: SimulatedPaymentToken;
  failureReason?: string;
  refundReason?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 100% Simulated Payment Service for CloudMart.
 * Does NOT integrate real payment provider credentials or external payment gateways.
 */
export class PaymentProcessingService {
  private readonly transactionsByOrder = new Map<string, PaymentTransactionEntity>();
  private readonly processedEventIds = new Set<string>();
  private readonly processedIdempotencyKeys = new Map<string, PaymentTransactionEntity>();
  private readonly outbox: Array<DomainEventEnvelope<any>> = [];

  constructor(
    private readonly eventBus: CloudPubSubEventBus,
    private readonly webhookSigningSecret: string,
    private readonly logger: CloudLogger = new CloudLogger('payment-service'),
  ) {
    if (!webhookSigningSecret) {
      throw new Error('[payment-service] webhookSigningSecret must be provided via configuration');
    }
    this.registerSubscriptions();
  }

  private registerSubscriptions(): void {
    this.eventBus.subscribe<InventoryReservedPayload>(
      PubSubTopic.INVENTORY_EVENTS,
      'payment-service.inventory-reserved.sub',
      async (event) => {
        if (event.eventType === DomainEventType.INVENTORY_RESERVED) {
          await this.handleInventoryReserved(event);
        }
      },
    );
  }

  getTransactionCount(): number {
    return this.transactionsByOrder.size;
  }

  /**
   * Saga Step 3: On `inventory.reserved`, create an idempotent simulated PaymentIntent
   * and publish `payment.intent_created`.
   */
  async handleInventoryReserved(
    event: DomainEventEnvelope<InventoryReservedPayload>,
  ): Promise<void> {
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const { orderId, totalCents, currency } = event.payload;
    if (this.transactionsByOrder.has(orderId)) {
      return;
    }

    const now = new Date().toISOString();
    const tx: PaymentTransactionEntity = {
      id: `pay-tx-${orderId}`,
      orderId,
      providerPaymentIntentId: `sim_pi_${orderId}`,
      clientSecret: `sim_pi_${orderId}_client_token`,
      amountCents: totalCents,
      currency,
      status: 'INTENT_CREATED',
      createdAt: now,
      updatedAt: now,
    };
    this.transactionsByOrder.set(orderId, tx);

    this.logger.log('INFO', `Created simulated PaymentIntent for order ${orderId}`, {
      correlationId: event.correlationId,
      metadata: { orderId, amountCents: totalCents },
    });

    const intentEvent: DomainEventEnvelope<PaymentIntentCreatedPayload> = {
      eventId: `evt-pay-intent-${orderId}`,
      eventType: DomainEventType.PAYMENT_INTENT_CREATED,
      occurredAt: now,
      correlationId: event.correlationId,
      traceparent: event.traceparent,
      producerService: 'payment-service',
      schemaVersion: '1.0',
      payload: {
        orderId: tx.orderId,
        paymentTransactionId: tx.id,
        providerPaymentIntentId: tx.providerPaymentIntentId,
        clientSecret: tx.clientSecret,
        amountCents: tx.amountCents,
        currency: tx.currency,
      },
    };

    this.outbox.push(intentEvent);
    await this.eventBus.publish(PubSubTopic.PAYMENTS_EVENTS, intentEvent);
  }

  /**
   * Simulates a payment charge deterministically using a simulated payment token:
   * - `tok_sim_success` -> SUCCEEDED
   * - `tok_sim_decline_insufficient_funds` -> FAILED (Insufficient funds)
   * - `tok_sim_decline_expired_card` -> FAILED (Card expired)
   * - `tok_sim_decline_fraud_suspected` -> FAILED (Suspected fraud block)
   */
  async simulatePaymentCharge(params: {
    orderId: string;
    simulatedPaymentToken: SimulatedPaymentToken;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<PaymentTransactionEntity> {
    const cached = this.processedIdempotencyKeys.get(params.idempotencyKey);
    if (cached) {
      return cached;
    }

    const tx = this.getTransactionByOrderOrThrow(params.orderId);
    if (tx.status === 'SUCCEEDED' || tx.status === 'REFUNDED') {
      throw new ConflictException(`Order '${params.orderId}' payment is already in status '${tx.status}'`);
    }

    tx.simulatedTokenUsed = params.simulatedPaymentToken;
    const correlationId = params.correlationId || `corr-${params.orderId}`;

    const tokenFailureMap: Record<SimulatedPaymentToken, string | null> = {
      tok_sim_success: null,
      tok_sim_decline_insufficient_funds: 'Simulated decline: Insufficient funds',
      tok_sim_decline_expired_card: 'Simulated decline: Expired payment card',
      tok_sim_decline_fraud_suspected: 'Simulated decline: Automated risk engine block',
    };

    const failureReason = tokenFailureMap[params.simulatedPaymentToken];
    if (failureReason === null) {
      await this.recordPaymentOutcome(tx, 'SUCCEEDED', undefined, correlationId);
    } else {
      await this.recordPaymentOutcome(tx, 'FAILED', failureReason, correlationId);
    }

    this.processedIdempotencyKeys.set(params.idempotencyKey, tx);
    return tx;
  }

  computeWebhookSignature(rawPayload: string): string {
    return crypto.createHmac('sha256', this.webhookSigningSecret).update(rawPayload).digest('hex');
  }

  verifyWebhookSignature(rawPayload: string, providedSignature?: string): boolean {
    if (!providedSignature) return false;
    const expected = this.computeWebhookSignature(rawPayload);
    if (expected.length !== providedSignature.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSignature));
  }

  async processPaymentWebhook(params: {
    webhookEventId: string;
    orderId: string;
    outcome: 'SUCCEEDED' | 'FAILED';
    failureReason?: string;
    rawPayload: string;
    signature?: string;
    correlationId?: string;
  }): Promise<PaymentTransactionEntity> {
    if (!this.verifyWebhookSignature(params.rawPayload, params.signature)) {
      throw new UnauthorizedException('Invalid payment webhook HMAC signature');
    }

    const cached = this.processedIdempotencyKeys.get(params.webhookEventId);
    if (cached) {
      return cached;
    }

    const tx = this.getTransactionByOrderOrThrow(params.orderId);
    const correlationId = params.correlationId ?? `corr-${params.orderId}`;

    await this.recordPaymentOutcome(tx, params.outcome, params.failureReason, correlationId);
    this.processedIdempotencyKeys.set(params.webhookEventId, tx);
    return tx;
  }

  private async recordPaymentOutcome(
    tx: PaymentTransactionEntity,
    outcome: 'SUCCEEDED' | 'FAILED',
    failureReason: string | undefined,
    correlationId: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    if (outcome === 'SUCCEEDED') {
      tx.status = 'SUCCEEDED';
      tx.failureReason = undefined;
      tx.updatedAt = now;

      this.logger.log('INFO', `Simulated payment SUCCEEDED for order ${tx.orderId}`, {
        correlationId,
        metadata: { orderId: tx.orderId, amountCents: tx.amountCents },
      });

      const succeededEvent: DomainEventEnvelope<PaymentSucceededPayload> = {
        eventId: `evt-pay-succ-${tx.orderId}`,
        eventType: DomainEventType.PAYMENT_SUCCEEDED,
        occurredAt: now,
        correlationId,
        producerService: 'payment-service',
        schemaVersion: '1.0',
        payload: {
          orderId: tx.orderId,
          paymentTransactionId: tx.id,
          providerPaymentIntentId: tx.providerPaymentIntentId,
          amountCents: tx.amountCents,
          currency: tx.currency,
          paidAt: now,
        },
      };
      this.outbox.push(succeededEvent);
      await this.eventBus.publish(PubSubTopic.PAYMENTS_EVENTS, succeededEvent);
    } else {
      tx.status = 'FAILED';
      tx.failureReason = failureReason || 'Simulated card decline';
      tx.updatedAt = now;

      this.logger.log('WARNING', `Simulated payment FAILED for order ${tx.orderId}: ${tx.failureReason}`, {
        correlationId,
        metadata: { orderId: tx.orderId, reason: tx.failureReason },
      });

      const failedEvent: DomainEventEnvelope<PaymentFailedPayload> = {
        eventId: `evt-pay-fail-${tx.orderId}`,
        eventType: DomainEventType.PAYMENT_FAILED,
        occurredAt: now,
        correlationId,
        producerService: 'payment-service',
        schemaVersion: '1.0',
        payload: {
          orderId: tx.orderId,
          paymentTransactionId: tx.id,
          reason: tx.failureReason,
          failedAt: now,
        },
      };
      this.outbox.push(failedEvent);
      await this.eventBus.publish(PubSubTopic.PAYMENTS_EVENTS, failedEvent);
    }
  }

  async refundOrderPayment(
    orderId: string,
    reason: string,
    correlationId?: string,
  ): Promise<PaymentTransactionEntity> {
    const tx = this.getTransactionByOrderOrThrow(orderId);
    if (tx.status !== 'SUCCEEDED') {
      throw new ConflictException(
        `Only SUCCEEDED payment transactions can be refunded (current status: '${tx.status}')`,
      );
    }

    tx.status = 'REFUNDED';
    tx.refundReason = reason;
    tx.updatedAt = new Date().toISOString();

    this.logger.log('INFO', `Processed simulated refund for order ${orderId}`, {
      correlationId,
      metadata: { orderId, reason },
    });

    return tx;
  }

  getTransactionByOrderId(orderId: string): PaymentTransactionEntity | undefined {
    return this.transactionsByOrder.get(orderId);
  }

  getTransactionByOrderOrThrow(orderId: string): PaymentTransactionEntity {
    const tx = this.transactionsByOrder.get(orderId);
    if (!tx) {
      throw new NotFoundException(`Payment transaction for order '${orderId}' not found`);
    }
    return tx;
  }
}
