import { PaymentProcessingService } from '../payment.service';

export class PaymentHealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly paymentService: PaymentProcessingService) {}

  // GET /healthz
  getLiveness() {
    return {
      status: 'ok',
      service: 'payment-service',
      mode: 'SIMULATED_PAYMENT_ENGINE',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  // GET /readyz
  getReadiness() {
    return {
      status: 'ready',
      service: 'payment-service',
      database: 'payment_db (isolated)',
      mode: 'SIMULATED_PAYMENT_ENGINE',
      totalTransactions: this.paymentService.getTransactionCount(),
      timestamp: new Date().toISOString(),
    };
  }
}
