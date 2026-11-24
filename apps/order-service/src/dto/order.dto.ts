import { BadRequestException, validateDto } from '../../../../libs/shared/src';

export interface CreateOrderDto {
  orderId?: string;
  userId: string;
  cartId: string;
  customerEmail: string;
  shippingAddress: string;
}

export interface CancelOrderDto {
  reason?: string;
}

export function validateCreateOrderDto(
  body: unknown,
  idempotencyKey?: string,
): { dto: CreateOrderDto; idempotencyKey: string } {
  if (!idempotencyKey || idempotencyKey.trim().length < 4) {
    throw new BadRequestException('Missing or invalid required Idempotency-Key header', [
      'Idempotency-Key header is required (min 4 characters)',
    ]);
  }

  const dto = validateDto<CreateOrderDto>(body, [
    { field: 'userId', required: true, type: 'string', minLength: 2 },
    { field: 'cartId', required: true, type: 'string', minLength: 2 },
    {
      field: 'customerEmail',
      required: true,
      type: 'string',
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    { field: 'shippingAddress', required: true, type: 'string', minLength: 5 },
  ]);

  return { dto, idempotencyKey: idempotencyKey.trim() };
}
