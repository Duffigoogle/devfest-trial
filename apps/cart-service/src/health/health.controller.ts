import { ShoppingCartService } from '../cart.service';

export class CartHealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly cartService: ShoppingCartService) {}

  // GET /healthz
  getLiveness() {
    return {
      status: 'ok',
      service: 'cart-service',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  // GET /readyz
  getReadiness() {
    return {
      status: 'ready',
      service: 'cart-service',
      database: 'cart_db (isolated)',
      activeCartCount: this.cartService.getActiveCartCount(),
      timestamp: new Date().toISOString(),
    };
  }
}
