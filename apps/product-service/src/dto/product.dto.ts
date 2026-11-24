import { validateDto } from '../../../../libs/shared/src';

export interface CreateProductDto {
  id?: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  currency?: string;
  availableQty: number;
  isActive?: boolean;
}

export interface UpdateStockDto {
  availableQtyDelta: number;
  reason: string;
}

export interface ValidateSkuRequestDto {
  productId: string;
  requestedQuantity: number;
}

export function validateCreateProductDto(body: unknown): CreateProductDto {
  return validateDto<CreateProductDto>(body, [
    { field: 'sku', required: true, type: 'string', minLength: 3, pattern: /^[A-Z0-9-_]+$/ },
    { field: 'name', required: true, type: 'string', minLength: 2 },
    { field: 'description', required: true, type: 'string', minLength: 3 },
    { field: 'category', required: true, type: 'string', minLength: 2 },
    { field: 'priceCents', required: true, type: 'number', integer: true, min: 1 },
    { field: 'availableQty', required: true, type: 'number', integer: true, min: 0 },
  ]);
}

export function validateUpdateStockDto(body: unknown): UpdateStockDto {
  return validateDto<UpdateStockDto>(body, [
    { field: 'availableQtyDelta', required: true, type: 'number', integer: true },
    { field: 'reason', required: true, type: 'string', minLength: 3 },
  ]);
}

export function validateSkuRequestDto(body: unknown): ValidateSkuRequestDto {
  return validateDto<ValidateSkuRequestDto>(body, [
    { field: 'productId', required: true, type: 'string', minLength: 2 },
    { field: 'requestedQuantity', required: true, type: 'number', integer: true, min: 1 },
  ]);
}
