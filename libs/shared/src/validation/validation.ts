import { BadRequestException } from '../errors/http-exceptions';

export interface ValidationRule<T = any> {
  field: keyof T & string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'array';
  minLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: RegExp;
  enumValues?: readonly string[];
}

/**
 * Declarative NestJS-style DTO ValidationPipe enforcing strict schema validation on incoming
 * REST request payloads and query parameters.
 */
export function validateDto<T extends Record<string, any>>(
  payload: unknown,
  rules: ValidationRule<T>[],
): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BadRequestException('Request body must be a valid JSON object', [
      'body must be a JSON object',
    ]);
  }

  const record = payload as Record<string, any>;
  const errors: string[] = [];

  for (const rule of rules) {
    const val = record[rule.field];

    if (val === undefined || val === null || val === '') {
      if (rule.required) {
        errors.push(`${rule.field} is required`);
      }
      continue;
    }

    if (rule.type === 'string' && typeof val !== 'string') {
      errors.push(`${rule.field} must be a string`);
      continue;
    }

    if (rule.type === 'number' && (typeof val !== 'number' || Number.isNaN(val))) {
      errors.push(`${rule.field} must be a valid number`);
      continue;
    }

    if (rule.type === 'boolean' && typeof val !== 'boolean') {
      errors.push(`${rule.field} must be a boolean`);
      continue;
    }

    if (rule.type === 'array' && !Array.isArray(val)) {
      errors.push(`${rule.field} must be an array`);
      continue;
    }

    if (typeof val === 'string') {
      if (rule.minLength !== undefined && val.trim().length < rule.minLength) {
        errors.push(`${rule.field} must be at least ${rule.minLength} characters`);
      }
      if (rule.pattern && !rule.pattern.test(val)) {
        errors.push(`${rule.field} format is invalid`);
      }
      if (rule.enumValues && !rule.enumValues.includes(val)) {
        errors.push(`${rule.field} must be one of: ${rule.enumValues.join(', ')}`);
      }
    }

    if (typeof val === 'number') {
      if (rule.integer && !Number.isInteger(val)) {
        errors.push(`${rule.field} must be an integer`);
      }
      if (rule.min !== undefined && val < rule.min) {
        errors.push(`${rule.field} must be >= ${rule.min}`);
      }
      if (rule.max !== undefined && val > rule.max) {
        errors.push(`${rule.field} must be <= ${rule.max}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new BadRequestException('Validation failed', errors);
  }

  return record as T;
}
