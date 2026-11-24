import {
  CloudLogger,
  CloudPubSubEventBus,
  MicroHttpApplication,
} from '../../../libs/shared/src';
import { loadOrderServiceConfig, OrderServiceConfig } from './config/order.config';
import { OrderHealthController } from './health/health.controller';
import { OrderController } from './order.controller';
import { CartGrpcClientPort, OrderSagaService } from './order.service';

export class OrderAppModule {
  public readonly config: OrderServiceConfig;
  public readonly logger: CloudLogger;
  public readonly orderService: OrderSagaService;
  public readonly orderController: OrderController;
  public readonly healthController: OrderHealthController;
  public readonly httpApp: MicroHttpApplication;

  constructor(
    cartClient: CartGrpcClientPort,
    eventBus: CloudPubSubEventBus = new CloudPubSubEventBus(),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.config = loadOrderServiceConfig(env);
    this.logger = new CloudLogger(this.config.serviceName, this.config.gcpProjectId);
    this.orderService = new OrderSagaService(cartClient, eventBus, this.logger);
    this.orderController = new OrderController(this.orderService);
    this.healthController = new OrderHealthController(this.orderService);
    this.httpApp = new MicroHttpApplication(this.config.serviceName, this.logger);

    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.httpApp.registerRoute('GET', '/healthz', () => this.healthController.getLiveness());
    this.httpApp.registerRoute('GET', '/readyz', () => this.healthController.getReadiness());

    this.httpApp.registerRoute('POST', '/api/v1/orders', (ctx) =>
      this.orderController.placeOrder(
        {
          'idempotency-key': ctx.headers['idempotency-key'],
          'x-correlation-id': ctx.correlationId,
        },
        ctx.body,
      ),
    );
    this.httpApp.registerRoute('GET', '/api/v1/orders/user/:userId', (ctx) =>
      this.orderController.listUserOrders(ctx.params.userId),
    );
    this.httpApp.registerRoute('GET', '/api/v1/orders/:id', (ctx) =>
      this.orderController.getOrder(ctx.params.id),
    );
    this.httpApp.registerRoute('POST', '/api/v1/orders/:id/cancel', (ctx) =>
      this.orderController.cancelOrder(ctx.params.id, ctx.correlationId),
    );
  }
}
