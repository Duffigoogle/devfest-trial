import { NotificationAppModule } from './app.module';

/**
 * Independent Application Entry Point for CloudMart Notification Service.
 */
export async function bootstrapNotificationService() {
  const appModule = new NotificationAppModule();
  const port = await appModule.httpApp.listen(appModule.config.port);

  appModule.logger.log('INFO', `Notification Service listening on HTTP port ${port}`, {
    metadata: {
      port,
      senderEmailAddress: appModule.config.senderEmailAddress,
    },
  });

  const shutdown = async (signal: string) => {
    appModule.logger.log('INFO', `Received ${signal}, shutting down Notification Service gracefully...`);
    await appModule.httpApp.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { appModule, port };
}

if (require.main === module) {
  void bootstrapNotificationService();
}
