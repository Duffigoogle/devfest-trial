import { OrderSagaService } from '../order.service';

export class OrderHealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly orderService: OrderSagaService) {}

  // GET /healthz
  getLiveness() {
    return {
      status: 'ok',
      service: 'order-service',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  // GET /readyz
  getReadiness() {
    return {
      status: 'ready',
      service: 'order-service',
      database: 'order_db (isolated)',
      totalOrdersTracked: this.orderService.getTotalOrderCount(),
      timestamp: new Date().toISOString(),
    };
  }
}
