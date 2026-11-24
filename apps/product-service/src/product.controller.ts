import {
  validateCreateProductDto,
  validateSkuRequestDto,
  validateUpdateStockDto,
} from './dto/product.dto';
import { ProductCatalogAndInventoryService } from './product.service';

export class ProductController {
  constructor(private readonly productService: ProductCatalogAndInventoryService) {}

  // GET /api/v1/products
  listCatalog(query?: { category?: string }) {
    return {
      items: this.productService.listProducts(query?.category),
    };
  }

  // GET /api/v1/products/:id
  getProduct(id: string) {
    return this.productService.getProductOrThrow(id);
  }

  // POST /api/v1/products
  createProduct(body: unknown, correlationId?: string) {
    const dto = validateCreateProductDto(body);
    const created = this.productService.createProduct(dto, correlationId);
    return {
      statusCode: 201,
      body: created,
    };
  }

  // PATCH /api/v1/products/:id/stock
  updateStock(id: string, body: unknown, correlationId?: string) {
    const dto = validateUpdateStockDto(body);
    return this.productService.updateStock(id, dto, correlationId);
  }

  // POST /api/v1/products/validate-sku (Documented synchronous validation endpoint)
  validateSkuRest(body: unknown, correlationId?: string) {
    const dto = validateSkuRequestDto(body);
    return this.productService.validateProductSkuGrpc(dto, correlationId);
  }

  // gRPC: ProductCatalogGrpcService/ValidateProductSku
  validateProductSku(
    data: { product_id: string; requested_quantity: number; correlation_id?: string },
  ) {
    const res = this.productService.validateProductSkuGrpc(
      {
        productId: data.product_id,
        requestedQuantity: data.requested_quantity,
      },
      data.correlation_id,
    );
    return {
      exists: res.exists,
      is_active: res.isActive,
      has_sufficient_stock: res.hasSufficientStock,
      product_id: res.productId,
      sku: res.sku,
      name: res.name,
      unit_price_cents: res.unitPriceCents,
      available_qty: res.availableQty,
    };
  }
}
