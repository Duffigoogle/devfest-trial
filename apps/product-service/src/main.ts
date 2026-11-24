import { ProductAppModule } from './app.module';

/**
 * Independent Application Entry Point for CloudMart Product Service.
 */
export async function bootstrapProductService() {
  const appModule = new ProductAppModule();
  const port = await appModule.httpApp.listen(appModule.config.port);

  appModule.logger.log('INFO', `Product Service listening on HTTP port ${port}`, {
    metadata: {
      port,
      grpcUrl: appModule.config.grpcUrl,
      nodeEnv: appModule.config.nodeEnv,
    },
  });

  const shutdown = async (signal: string) => {
    appModule.logger.log('INFO', `Received ${signal}, shutting down Product Service gracefully...`);
    await appModule.httpApp.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { appModule, port };
}

if (require.main === module) {
  void bootstrapProductService();
}
