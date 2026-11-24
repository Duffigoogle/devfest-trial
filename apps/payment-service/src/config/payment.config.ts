import { BaseServiceConfig, loadBaseServiceConfig } from '../../../../libs/shared/src';

export interface PaymentServiceConfig extends BaseServiceConfig {
  webhookSigningSecret: string;
  simulationModeEnabled: boolean;
}

/**
 * Loads Payment Service configuration from environment variables.
 * Never hardcodes production credentials or real payment gateway keys.
 */
export function loadPaymentServiceConfig(
  env: Record<string, string | undefined> = process.env,
): PaymentServiceConfig {
  const base = loadBaseServiceConfig('payment-service', 3004, env);
  const webhookSigningSecret = env.PAYMENT_WEBHOOK_SECRET || '';

  if (
    (base.nodeEnv === 'production' || base.nodeEnv === 'staging') &&
    webhookSigningSecret.trim().length < 16
  ) {
    throw new Error(
      `[payment-service] Missing or weak PAYMENT_WEBHOOK_SECRET environment variable in ${base.nodeEnv} mode`,
    );
  }

  return {
    ...base,
    webhookSigningSecret: webhookSigningSecret || `sim_ephemeral_${base.nodeEnv}_signing_key`,
    simulationModeEnabled: env.PAYMENT_SIMULATION_ENABLED !== 'false',
  };
}
