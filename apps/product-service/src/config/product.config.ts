import { BaseServiceConfig, loadBaseServiceConfig } from '../../../../libs/shared/src';

export interface ProductServiceConfig extends BaseServiceConfig {
  grpcUrl: string;
  reservationTtlMinutes: number;
}

export function loadProductServiceConfig(
  env: Record<string, string | undefined> = process.env,
): ProductServiceConfig {
  const base = loadBaseServiceConfig('product-service', 3001, env);
  const grpcUrl = env.GRPC_URL || '0.0.0.0:50051';
  const reservationTtlMinutes = env.RESERVATION_TTL_MINUTES
    ? Number(env.RESERVATION_TTL_MINUTES)
    : 15;

  if (!Number.isInteger(reservationTtlMinutes) || reservationTtlMinutes <= 0) {
    throw new Error('[product-service] RESERVATION_TTL_MINUTES must be a positive integer');
  }

  return {
    ...base,
    grpcUrl,
    reservationTtlMinutes,
  };
}
