import { NotificationDispatchService } from '../notification.service';

export class NotificationHealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly notificationService: NotificationDispatchService) {}

  // GET /healthz
  getLiveness() {
    return {
      status: 'ok',
      service: 'notification-service',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  // GET /readyz
  getReadiness() {
    return {
      status: 'ready',
      service: 'notification-service',
      database: 'notification_db (isolated)',
      dispatchedCount: this.notificationService.getAllLogs().length,
      timestamp: new Date().toISOString(),
    };
  }
}
