import { validateDto } from '../../../../libs/shared/src';

export const SIMULATED_PAYMENT_TOKENS = [
  'tok_sim_success',
  'tok_sim_decline_insufficient_funds',
  'tok_sim_decline_expired_card',
  'tok_sim_decline_fraud_suspected',
] as const;

export type SimulatedPaymentToken = (typeof SIMULATED_PAYMENT_TOKENS)[number];

export interface SimulatePaymentDto {
  orderId: string;
  simulatedPaymentToken: SimulatedPaymentToken;
  idempotencyKey: string;
}

export interface PaymentWebhookDto {
  webhookEventId: string;
  orderId: string;
  outcome: 'SUCCEEDED' | 'FAILED';
  failureReason?: string;
}

export interface RefundPaymentDto {
  reason: string;
}

export function validateSimulatePaymentDto(body: unknown): SimulatePaymentDto {
  return validateDto<SimulatePaymentDto>(body, [
    { field: 'orderId', required: true, type: 'string', minLength: 3 },
    {
      field: 'simulatedPaymentToken',
      required: true,
      type: 'string',
      enumValues: SIMULATED_PAYMENT_TOKENS,
    },
    { field: 'idempotencyKey', required: true, type: 'string', minLength: 4 },
  ]);
}

export function validatePaymentWebhookDto(body: unknown): PaymentWebhookDto {
  return validateDto<PaymentWebhookDto>(body, [
    { field: 'webhookEventId', required: true, type: 'string', minLength: 3 },
    { field: 'orderId', required: true, type: 'string', minLength: 3 },
    { field: 'outcome', required: true, type: 'string', enumValues: ['SUCCEEDED', 'FAILED'] },
  ]);
}

export function validateRefundPaymentDto(body: unknown): RefundPaymentDto {
  return validateDto<RefundPaymentDto>(body, [
    { field: 'reason', required: true, type: 'string', minLength: 3 },
  ]);
}
