import {
  CloudLogger,
  CloudPubSubEventBus,
  MicroHttpApplication,
} from '../../../libs/shared/src';
import { loadProductServiceConfig, ProductServiceConfig } from './config/product.config';
import { ProductHealthController } from './health/health.controller';
import { ProductController } from './product.controller';
import { ProductCatalogAndInventoryService } from './product.service';

export class ProductAppModule {
  public readonly config: ProductServiceConfig;
  public readonly logger: CloudLogger;
  public readonly productService: ProductCatalogAndInventoryService;
  public readonly productController: ProductController;
  public readonly healthController: ProductHealthController;
  public readonly httpApp: MicroHttpApplication;

  constructor(
    eventBus: CloudPubSubEventBus = new CloudPubSubEventBus(),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.config = loadProductServiceConfig(env);
    this.logger = new CloudLogger(this.config.serviceName, this.config.gcpProjectId);
    this.productService = new ProductCatalogAndInventoryService(eventBus, this.logger);
    this.productController = new ProductController(this.productService);
    this.healthController = new ProductHealthController(this.productService);
    this.httpApp = new MicroHttpApplication(this.config.serviceName, this.logger);

    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.httpApp.registerRoute('GET', '/healthz', () => this.healthController.getLiveness());
    this.httpApp.registerRoute('GET', '/readyz', () => this.healthController.getReadiness());

    this.httpApp.registerRoute('GET', '/api/v1/products', (ctx) =>
      this.productController.listCatalog({ category: ctx.query.category }),
    );
    this.httpApp.registerRoute('GET', '/api/v1/products/:id', (ctx) =>
      this.productController.getProduct(ctx.params.id),
    );
    this.httpApp.registerRoute('POST', '/api/v1/products', (ctx) =>
      this.productController.createProduct(ctx.body, ctx.correlationId),
    );
    this.httpApp.registerRoute('PATCH', '/api/v1/products/:id/stock', (ctx) =>
      this.productController.updateStock(ctx.params.id, ctx.body, ctx.correlationId),
    );
    this.httpApp.registerRoute('POST', '/api/v1/products/validate-sku', (ctx) =>
      this.productController.validateSkuRest(ctx.body, ctx.correlationId),
    );
  }
}
