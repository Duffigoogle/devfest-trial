import { validateDto } from '../../../../libs/shared/src';

export interface SendNotificationDto {
  orderId: string;
  recipientUserId: string;
  recipientEmail: string;
  channel: 'EMAIL' | 'SMS';
  templateKey: 'ORDER_CONFIRMED_EMAIL' | 'ORDER_CANCELLED_EMAIL' | 'CUSTOM_ALERT';
  subject: string;
  bodyText: string;
}

export function validateSendNotificationDto(body: unknown): SendNotificationDto {
  return validateDto<SendNotificationDto>(body, [
    { field: 'orderId', required: true, type: 'string', minLength: 3 },
    { field: 'recipientUserId', required: true, type: 'string', minLength: 2 },
    {
      field: 'recipientEmail',
      required: true,
      type: 'string',
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    { field: 'channel', required: true, type: 'string', enumValues: ['EMAIL', 'SMS'] },
    {
      field: 'templateKey',
      required: true,
      type: 'string',
      enumValues: ['ORDER_CONFIRMED_EMAIL', 'ORDER_CANCELLED_EMAIL', 'CUSTOM_ALERT'],
    },
    { field: 'subject', required: true, type: 'string', minLength: 3 },
    { field: 'bodyText', required: true, type: 'string', minLength: 3 },
  ]);
}
