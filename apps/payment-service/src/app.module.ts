import {
  CloudLogger,
  CloudPubSubEventBus,
  MicroHttpApplication,
} from '../../../libs/shared/src';
import { loadPaymentServiceConfig, PaymentServiceConfig } from './config/payment.config';
import { PaymentHealthController } from './health/health.controller';
import { PaymentController } from './payment.controller';
import { PaymentProcessingService } from './payment.service';

export class PaymentAppModule {
  public readonly config: PaymentServiceConfig;
  public readonly logger: CloudLogger;
  public readonly paymentService: PaymentProcessingService;
  public readonly paymentController: PaymentController;
  public readonly healthController: PaymentHealthController;
  public readonly httpApp: MicroHttpApplication;

  constructor(
    eventBus: CloudPubSubEventBus = new CloudPubSubEventBus(),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.config = loadPaymentServiceConfig(env);
    this.logger = new CloudLogger(this.config.serviceName, this.config.gcpProjectId);
    this.paymentService = new PaymentProcessingService(
      eventBus,
      this.config.webhookSigningSecret,
      this.logger,
    );
    this.paymentController = new PaymentController(this.paymentService);
    this.healthController = new PaymentHealthController(this.paymentService);
    this.httpApp = new MicroHttpApplication(this.config.serviceName, this.logger);

    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.httpApp.registerRoute('GET', '/healthz', () => this.healthController.getLiveness());
    this.httpApp.registerRoute('GET', '/readyz', () => this.healthController.getReadiness());

    this.httpApp.registerRoute('POST', '/api/v1/payments/simulate', (ctx) =>
      this.paymentController.simulatePayment(ctx.body, ctx.correlationId),
    );
    this.httpApp.registerRoute('POST', '/api/v1/payments/webhook', (ctx) =>
      this.paymentController.handleWebhook(
        {
          'x-payment-signature': ctx.headers['x-payment-signature'],
          'x-correlation-id': ctx.correlationId,
        },
        ctx.rawBody,
        ctx.body,
      ),
    );
    this.httpApp.registerRoute('GET', '/api/v1/payments/order/:orderId', (ctx) =>
      this.paymentController.getPaymentForOrder(ctx.params.orderId),
    );
    this.httpApp.registerRoute('POST', '/api/v1/payments/:orderId/refund', (ctx) =>
      this.paymentController.refundPayment(ctx.params.orderId, ctx.body, ctx.correlationId),
    );
  }
}
