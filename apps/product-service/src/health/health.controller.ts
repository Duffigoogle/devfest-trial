import { ProductCatalogAndInventoryService } from '../product.service';

export class ProductHealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly productService: ProductCatalogAndInventoryService) {}

  // GET /healthz (Liveness probe)
  getLiveness() {
    return {
      status: 'ok',
      service: 'product-service',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  // GET /readyz (Readiness probe)
  getReadiness() {
    return {
      status: 'ready',
      service: 'product-service',
      database: 'product_db (isolated)',
      catalogCount: this.productService.listProducts().length,
      timestamp: new Date().toISOString(),
    };
  }
}
