export interface StorefrontProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  currency: string;
  availableQty: number;
}

export interface StorefrontOrderState {
  orderId: string;
  status:
    | 'PENDING_INVENTORY'
    | 'AWAITING_PAYMENT'
    | 'CONFIRMED'
    | 'CANCELLED_OUT_OF_STOCK'
    | 'PAYMENT_FAILED';
  totalCents: number;
  currency: string;
  paymentClientSecret?: string;
  sagaHistory: string[];
}

const PRODUCT_API = process.env.NEXT_PUBLIC_PRODUCT_API_URL || '/api/v1';
const CART_API = process.env.NEXT_PUBLIC_CART_API_URL || '/api/v1';
const ORDER_API = process.env.NEXT_PUBLIC_ORDER_API_URL || '/api/v1';

export class CloudMartApiClient {
  static async fetchCatalog(category?: string): Promise<StorefrontProduct[]> {
    const url = category
      ? `${PRODUCT_API}/products?category=${encodeURIComponent(category)}`
      : `${PRODUCT_API}/products`;
    const res = await fetch(url, { next: { revalidate: 30 } } as RequestInit);
    if (!res.ok) throw new Error('Failed to load product catalog');
    const data = await res.json();
    return data.items;
  }

  static async addToCart(userId: string, productId: string, quantity: number) {
    const res = await fetch(`${CART_API}/carts/${userId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, quantity }),
    });
    if (!res.ok) throw new Error('Failed to add item to cart');
    return res.json();
  }

  static async submitCheckoutOrder(params: {
    userId: string;
    cartId: string;
    customerEmail: string;
    shippingAddress: string;
    idempotencyKey: string;
  }): Promise<StorefrontOrderState> {
    const res = await fetch(`${ORDER_API}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        userId: params.userId,
        cartId: params.cartId,
        customerEmail: params.customerEmail,
        shippingAddress: params.shippingAddress,
      }),
    });
    if (!res.ok) throw new Error('Checkout submission failed');
    return res.json();
  }

  static async getOrderStatus(orderId: string): Promise<StorefrontOrderState> {
    const res = await fetch(`${ORDER_API}/orders/${orderId}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch status for order ${orderId}`);
    return res.json();
  }
}
