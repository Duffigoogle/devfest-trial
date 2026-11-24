import { validateSendNotificationDto } from './dto/notification.dto';
import { NotificationDispatchService } from './notification.service';

export class NotificationController {
  constructor(private readonly notificationService: NotificationDispatchService) {}

  // GET /api/v1/notifications
  listNotifications(query?: { recipientUserId?: string }) {
    return {
      items: this.notificationService.getAllLogs(query?.recipientUserId),
    };
  }

  // GET /api/v1/notifications/order/:orderId
  getOrderNotifications(orderId: string) {
    return {
      items: this.notificationService.getNotificationsForOrder(orderId),
    };
  }

  // POST /api/v1/notifications/send
  sendManualNotification(body: unknown, correlationId?: string) {
    const dto = validateSendNotificationDto(body);
    const created = this.notificationService.sendManualNotification(dto, correlationId);
    return {
      statusCode: 201,
      body: created,
    };
  }
}
