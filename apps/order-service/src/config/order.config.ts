import { BaseServiceConfig, loadBaseServiceConfig } from '../../../../libs/shared/src';

export interface OrderServiceConfig extends BaseServiceConfig {
  cartServiceGrpcUrl: string;
  cartServiceHttpUrl: string;
}

export function loadOrderServiceConfig(
  env: Record<string, string | undefined> = process.env,
): OrderServiceConfig {
  const base = loadBaseServiceConfig('order-service', 3003, env);
  const cartServiceGrpcUrl = env.CART_GRPC_URL || 'cart-service:50052';
  const cartServiceHttpUrl = env.CART_SERVICE_URL || 'http://localhost:3002';

  return {
    ...base,
    cartServiceGrpcUrl,
    cartServiceHttpUrl,
  };
}
