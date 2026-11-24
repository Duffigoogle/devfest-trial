import { PaymentAppModule } from './app.module';

/**
 * Independent Application Entry Point for CloudMart Payment Service (Simulated Payment Engine).
 */
export async function bootstrapPaymentService() {
  const appModule = new PaymentAppModule();
  const port = await appModule.httpApp.listen(appModule.config.port);

  appModule.logger.log('INFO', `Payment Service (SIMULATED) listening on HTTP port ${port}`, {
    metadata: {
      port,
      simulationModeEnabled: appModule.config.simulationModeEnabled,
    },
  });

  const shutdown = async (signal: string) => {
    appModule.logger.log('INFO', `Received ${signal}, shutting down Payment Service gracefully...`);
    await appModule.httpApp.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { appModule, port };
}

if (require.main === module) {
  void bootstrapPaymentService();
}
