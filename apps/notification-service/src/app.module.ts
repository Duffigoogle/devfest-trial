import {
  CloudLogger,
  CloudPubSubEventBus,
  MicroHttpApplication,
} from '../../../libs/shared/src';
import {
  loadNotificationServiceConfig,
  NotificationServiceConfig,
} from './config/notification.config';
import { NotificationHealthController } from './health/health.controller';
import { NotificationController } from './notification.controller';
import { NotificationDispatchService } from './notification.service';

export class NotificationAppModule {
  public readonly config: NotificationServiceConfig;
  public readonly logger: CloudLogger;
  public readonly notificationService: NotificationDispatchService;
  public readonly notificationController: NotificationController;
  public readonly healthController: NotificationHealthController;
  public readonly httpApp: MicroHttpApplication;

  constructor(
    eventBus: CloudPubSubEventBus = new CloudPubSubEventBus(),
    env: Record<string, string | undefined> = process.env,
  ) {
    this.config = loadNotificationServiceConfig(env);
    this.logger = new CloudLogger(this.config.serviceName, this.config.gcpProjectId);
    this.notificationService = new NotificationDispatchService(eventBus, this.logger);
    this.notificationController = new NotificationController(this.notificationService);
    this.healthController = new NotificationHealthController(this.notificationService);
    this.httpApp = new MicroHttpApplication(this.config.serviceName, this.logger);

    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.httpApp.registerRoute('GET', '/healthz', () => this.healthController.getLiveness());
    this.httpApp.registerRoute('GET', '/readyz', () => this.healthController.getReadiness());

    this.httpApp.registerRoute('GET', '/api/v1/notifications', (ctx) =>
      this.notificationController.listNotifications({
        recipientUserId: ctx.query.recipientUserId,
      }),
    );
    this.httpApp.registerRoute('GET', '/api/v1/notifications/order/:orderId', (ctx) =>
      this.notificationController.getOrderNotifications(ctx.params.orderId),
    );
    this.httpApp.registerRoute('POST', '/api/v1/notifications/send', (ctx) =>
      this.notificationController.sendManualNotification(ctx.body, ctx.correlationId),
    );
  }
}
