import { validateDto } from '../../../../libs/shared/src';

export interface AddCartItemDto {
  productId: string;
  quantity: number;
}

export interface UpdateCartItemQuantityDto {
  quantity: number;
}

export function validateAddCartItemDto(body: unknown): AddCartItemDto {
  return validateDto<AddCartItemDto>(body, [
    { field: 'productId', required: true, type: 'string', minLength: 2 },
    { field: 'quantity', required: true, type: 'number', integer: true, min: 1, max: 100 },
  ]);
}

export function validateUpdateCartItemQuantityDto(body: unknown): UpdateCartItemQuantityDto {
  return validateDto<UpdateCartItemQuantityDto>(body, [
    { field: 'quantity', required: true, type: 'number', integer: true, min: 1, max: 100 },
  ]);
}
