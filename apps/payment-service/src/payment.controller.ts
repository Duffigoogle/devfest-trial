import {
  validatePaymentWebhookDto,
  validateRefundPaymentDto,
  validateSimulatePaymentDto,
} from './dto/payment.dto';
import { PaymentProcessingService } from './payment.service';

export class PaymentController {
  constructor(private readonly paymentService: PaymentProcessingService) {}

  // POST /api/v1/payments/simulate
  async simulatePayment(body: unknown, correlationId?: string) {
    const dto = validateSimulatePaymentDto(body);
    return this.paymentService.simulatePaymentCharge({
      orderId: dto.orderId,
      simulatedPaymentToken: dto.simulatedPaymentToken,
      idempotencyKey: dto.idempotencyKey,
      correlationId,
    });
  }

  // POST /api/v1/payments/webhook
  async handleWebhook(
    headers: { 'x-payment-signature'?: string; 'x-correlation-id'?: string },
    rawBody: string,
    parsedBody: unknown,
  ) {
    const dto = validatePaymentWebhookDto(parsedBody);
    const tx = await this.paymentService.processPaymentWebhook({
      webhookEventId: dto.webhookEventId,
      orderId: dto.orderId,
      outcome: dto.outcome,
      failureReason: dto.failureReason,
      rawPayload: rawBody,
      signature: headers['x-payment-signature'],
      correlationId: headers['x-correlation-id'],
    });
    return { received: true, paymentStatus: tx.status, transactionId: tx.id };
  }

  // GET /api/v1/payments/order/:orderId
  getPaymentForOrder(orderId: string) {
    return this.paymentService.getTransactionByOrderOrThrow(orderId);
  }

  // POST /api/v1/payments/:orderId/refund
  async refundPayment(orderId: string, body: unknown, correlationId?: string) {
    const dto = validateRefundPaymentDto(body);
    return this.paymentService.refundOrderPayment(orderId, dto.reason, correlationId);
  }
}
