import { CartAppModule } from './app.module';
import { ProductGrpcClientPort } from './cart.service';

/**
 * Independent Application Entry Point for CloudMart Cart Service.
 */
export async function bootstrapCartService(customProductClient?: ProductGrpcClientPort) {
  const defaultProductClient: ProductGrpcClientPort = customProductClient || {
    validateProductSkuGrpc: (req) => ({
      exists: true,
      isActive: true,
      hasSufficientStock: true,
      productId: req.productId,
      sku: `SKU-${req.productId.toUpperCase()}`,
      name: `Product ${req.productId}`,
      unitPriceCents: 1000,
      availableQty: 100,
    }),
  };

  const appModule = new CartAppModule(defaultProductClient);
  const port = await appModule.httpApp.listen(appModule.config.port);

  appModule.logger.log('INFO', `Cart Service listening on HTTP port ${port}`, {
    metadata: {
      port,
      grpcUrl: appModule.config.grpcUrl,
      productServiceGrpcUrl: appModule.config.productServiceGrpcUrl,
    },
  });

  const shutdown = async (signal: string) => {
    appModule.logger.log('INFO', `Received ${signal}, shutting down Cart Service gracefully...`);
    await appModule.httpApp.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { appModule, port };
}

if (require.main === module) {
  void bootstrapCartService();
}
