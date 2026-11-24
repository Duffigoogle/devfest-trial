import { ShoppingCartService } from './cart.service';
import {
  validateAddCartItemDto,
  validateUpdateCartItemQuantityDto,
} from './dto/cart.dto';

export class CartController {
  constructor(private readonly cartService: ShoppingCartService) {}

  // GET /api/v1/carts/:userId
  getCart(userId: string) {
    return this.cartService.getOrCreateActiveCart(userId);
  }

  // POST /api/v1/carts/:userId/items
  addItem(userId: string, body: unknown, correlationId?: string) {
    const dto = validateAddCartItemDto(body);
    return this.cartService.addItemToCart({
      userId,
      productId: dto.productId,
      quantity: dto.quantity,
      correlationId,
    });
  }

  // PATCH /api/v1/carts/:userId/items/:productId
  updateItemQuantity(
    userId: string,
    productId: string,
    body: unknown,
    correlationId?: string,
  ) {
    const dto = validateUpdateCartItemQuantityDto(body);
    return this.cartService.updateItemQuantity({
      userId,
      productId,
      quantity: dto.quantity,
      correlationId,
    });
  }

  // DELETE /api/v1/carts/:userId/items/:productId
  removeItem(userId: string, productId: string, correlationId?: string) {
    return this.cartService.removeItemFromCart({
      userId,
      productId,
      correlationId,
    });
  }

  // POST /api/v1/carts/:userId/lock (Documented synchronous endpoint for Order Service)
  lockCartSnapshot(userId: string, body: { cartId?: string }, correlationId?: string) {
    const cartId = body?.cartId || `cart-${userId}`;
    return this.cartService.getAndLockCartSnapshotGrpc({ cartId, userId }, correlationId);
  }

  // gRPC: CartGrpcService/GetAndLockCartSnapshot
  getAndLockCartSnapshot(data: { cart_id: string; user_id: string; correlation_id?: string }) {
    return this.cartService.getAndLockCartSnapshotGrpc(
      {
        cartId: data.cart_id,
        userId: data.user_id,
      },
      data.correlation_id,
    );
  }
}
