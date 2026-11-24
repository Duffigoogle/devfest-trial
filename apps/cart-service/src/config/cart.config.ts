import { BaseServiceConfig, loadBaseServiceConfig } from '../../../../libs/shared/src';

export interface CartServiceConfig extends BaseServiceConfig {
  grpcUrl: string;
  productServiceGrpcUrl: string;
  productServiceHttpUrl: string;
  cartTtlHours: number;
}

export function loadCartServiceConfig(
  env: Record<string, string | undefined> = process.env,
): CartServiceConfig {
  const base = loadBaseServiceConfig('cart-service', 3002, env);
  const grpcUrl = env.GRPC_URL || '0.0.0.0:50052';
  const productServiceGrpcUrl = env.PRODUCT_GRPC_URL || 'product-service:50051';
  const productServiceHttpUrl = env.PRODUCT_SERVICE_URL || 'http://localhost:3001';
  const cartTtlHours = env.CART_TTL_HOURS ? Number(env.CART_TTL_HOURS) : 24;

  if (!Number.isInteger(cartTtlHours) || cartTtlHours <= 0) {
    throw new Error('[cart-service] CART_TTL_HOURS must be a positive integer');
  }

  return {
    ...base,
    grpcUrl,
    productServiceGrpcUrl,
    productServiceHttpUrl,
    cartTtlHours,
  };
}
