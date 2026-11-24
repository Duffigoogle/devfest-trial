import { OrderAppModule } from './app.module';
import { CartGrpcClientPort } from './order.service';

/**
 * Independent Application Entry Point for CloudMart Order Service.
 */
export async function bootstrapOrderService(customCartClient?: CartGrpcClientPort) {
  const defaultCartClient: CartGrpcClientPort = customCartClient || {
    getAndLockCartSnapshotGrpc: (req) => ({
      cartId: req.cartId,
      userId: req.userId,
      status: 'LOCKED_FOR_CHECKOUT',
      items: [
        {
          productId: 'prod-default',
          sku: 'SKU-DEFAULT',
          productName: 'CloudMart Product',
          unitPriceCents: 5000,
          quantity: 1,
        },
      ],
      totalCents: 5000,
      currency: 'USD',
    }),
  };

  const appModule = new OrderAppModule(defaultCartClient);
  const port = await appModule.httpApp.listen(appModule.config.port);

  appModule.logger.log('INFO', `Order Service listening on HTTP port ${port}`, {
    metadata: {
      port,
      cartServiceGrpcUrl: appModule.config.cartServiceGrpcUrl,
    },
  });

  const shutdown = async (signal: string) => {
    appModule.logger.log('INFO', `Received ${signal}, shutting down Order Service gracefully...`);
    await appModule.httpApp.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { appModule, port };
}

if (require.main === module) {
  void bootstrapOrderService();
}
