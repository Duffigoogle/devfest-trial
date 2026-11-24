import { validateCreateOrderDto } from './dto/order.dto';
import { OrderSagaService } from './order.service';

export class OrderController {
  constructor(private readonly orderService: OrderSagaService) {}

  // POST /api/v1/orders -> 202 Accepted
  async placeOrder(
    headers: { 'idempotency-key'?: string; 'x-correlation-id'?: string },
    body: unknown,
  ) {
    const { dto, idempotencyKey } = validateCreateOrderDto(body, headers['idempotency-key']);

    const order = await this.orderService.createCheckoutOrder({
      orderId: dto.orderId,
      userId: dto.userId,
      cartId: dto.cartId,
      idempotencyKey,
      customerEmail: dto.customerEmail,
      shippingAddress: dto.shippingAddress,
      correlationId: headers['x-correlation-id'],
    });

    return {
      statusCode: 202,
      body: {
        orderId: order.id,
        status: order.status,
        totalCents: order.totalCents,
        currency: order.currency,
        paymentClientSecret: order.paymentClientSecret,
        sagaHistory: order.sagaHistory,
      },
    };
  }

  // GET /api/v1/orders/:id
  getOrder(orderId: string) {
    return this.orderService.getOrderOrThrow(orderId);
  }

  // GET /api/v1/orders/user/:userId
  listUserOrders(userId: string) {
    return {
      items: this.orderService.listOrdersByUser(userId),
    };
  }

  // POST /api/v1/orders/:id/cancel
  async cancelOrder(orderId: string, correlationId?: string) {
    return this.orderService.cancelOrderByCustomer(orderId, correlationId);
  }
}
