const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'products.json');

class ProductStore {
  constructor(filePath = DATA_FILE) {
    this.filePath = filePath;
    this.products = new Map();
    this.load();
  }

  load() {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const items = JSON.parse(raw);
    this.products.clear();
    for (const item of items) {
      this.products.set(item.id, { ...item });
    }
  }

  list() {
    return Array.from(this.products.values());
  }

  getById(id) {
    return this.products.get(id) || null;
  }

  adjustStock(id, delta) {
    const product = this.products.get(id);
    if (!product) {
      return { error: 'NOT_FOUND' };
    }
    const nextStock = product.stock + Number(delta);
    if (nextStock < 0) {
      return { error: 'INSUFFICIENT_STOCK', available: product.stock };
    }
    product.stock = nextStock;
    return { product };
  }
}

module.exports = new ProductStore();
module.exports.ProductStore = ProductStore;
