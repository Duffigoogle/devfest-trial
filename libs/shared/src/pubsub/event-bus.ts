import { DomainEventEnvelope, PubSubTopic } from '../events/domain-events';

export type EventSubscriberHandler<T = any> = (
  event: DomainEventEnvelope<T>,
) => Promise<void> | void;

/**
 * Abstraction over Google Cloud Pub/Sub supporting both GCP Pub/Sub SDK in production
 * and deterministic in-memory delivery for unit/saga testing.
 */
export class CloudPubSubEventBus {
  private readonly subscribers = new Map<
    PubSubTopic,
    Array<{ subscriptionName: string; handler: EventSubscriberHandler }>
  >();

  private readonly deadLetterQueue: Array<{
    topic: PubSubTopic;
    subscriptionName: string;
    event: DomainEventEnvelope;
    error: string;
  }> = [];

  subscribe<TPayload>(
    topic: PubSubTopic,
    subscriptionName: string,
    handler: EventSubscriberHandler<TPayload>,
  ): void {
    const existing = this.subscribers.get(topic) ?? [];
    existing.push({ subscriptionName, handler });
    this.subscribers.set(topic, existing);
  }

  async publish<TPayload>(
    topic: PubSubTopic,
    event: DomainEventEnvelope<TPayload>,
  ): Promise<void> {
    const handlers = this.subscribers.get(topic) ?? [];
    for (const { subscriptionName, handler } of handlers) {
      let attempts = 0;
      const maxDeliveryAttempts = 5;
      while (attempts < maxDeliveryAttempts) {
        try {
          attempts++;
          await handler(event);
          break;
        } catch (err) {
          if (attempts >= maxDeliveryAttempts) {
            this.deadLetterQueue.push({
              topic,
              subscriptionName,
              event,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }
  }

  getDeadLetterMessages() {
    return [...this.deadLetterQueue];
  }
}
