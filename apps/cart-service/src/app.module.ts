import {
  CloudLogger,
  CloudPubSubEventBus,
  MicroHttpApplication,
} from '../../../libs/shared/src';
import { CartController } from './cart.controller';
import { ProductGrpcClientPort, ShoppingCartService } from './cart.service';
import { CartServiceConfig, loadCartServiceConfig } from './config/cart.config';
import { CartHealthController } from './health/health.controller';

export class CartAppModule {
  public readonly config: CartServiceConfig;
  public readonly logger: CloudLogger;
  public readonly cartService: ShoppingCartService;
  public readonly cartController: CartController;
  public readonly healthController: CartHealthController;
  public readonly httpApp: MicroHttpApplication;

  constructor(
    productClient: ProductGrpcClientPort,
    eventBus: CloudPubSubEventBus = new CloudPubSubEventBus(),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.config = loadCartServiceConfig(env);
    this.logger = new CloudLogger(this.config.serviceName, this.config.gcpProjectId);
    this.cartService = new ShoppingCartService(productClient, eventBus, this.logger);
    this.cartController = new CartController(this.cartService);
    this.healthController = new CartHealthController(this.cartService);
    this.httpApp = new MicroHttpApplication(this.config.serviceName, this.logger);

    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.httpApp.registerRoute('GET', '/healthz', () => this.healthController.getLiveness());
    this.httpApp.registerRoute('GET', '/readyz', () => this.healthController.getReadiness());

    this.httpApp.registerRoute('GET', '/api/v1/carts/:userId', (ctx) =>
      this.cartController.getCart(ctx.params.userId),
    );
    this.httpApp.registerRoute('POST', '/api/v1/carts/:userId/items', (ctx) =>
      this.cartController.addItem(ctx.params.userId, ctx.body, ctx.correlationId),
    );
    this.httpApp.registerRoute('PATCH', '/api/v1/carts/:userId/items/:productId', (ctx) =>
      this.cartController.updateItemQuantity(
        ctx.params.userId,
        ctx.params.productId,
        ctx.body,
        ctx.correlationId,
      ),
    );
    this.httpApp.registerRoute('DELETE', '/api/v1/carts/:userId/items/:productId', (ctx) =>
      this.cartController.removeItem(ctx.params.userId, ctx.params.productId, ctx.correlationId),
    );
    this.httpApp.registerRoute('POST', '/api/v1/carts/:userId/lock', (ctx) =>
      this.cartController.lockCartSnapshot(ctx.params.userId, ctx.body, ctx.correlationId),
    );
  }
}
