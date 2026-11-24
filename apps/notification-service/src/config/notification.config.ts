import { BaseServiceConfig, loadBaseServiceConfig } from '../../../../libs/shared/src';

export interface NotificationServiceConfig extends BaseServiceConfig {
  senderEmailAddress: string;
}

export function loadNotificationServiceConfig(
  env: Record<string, string | undefined> = process.env,
): NotificationServiceConfig {
  const base = loadBaseServiceConfig('notification-service', 3005, env);
  const senderEmailAddress =
    env.NOTIFICATION_SENDER_EMAIL || 'no-reply@cloudmart.example.com';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmailAddress)) {
    throw new Error('[notification-service] NOTIFICATION_SENDER_EMAIL must be a valid email address');
  }

  return {
    ...base,
    senderEmailAddress,
  };
}
