const { spawn } = require('child_process');
const path = require('path');

const env = {
  ...process.env,
  PRODUCT_URL: 'http://localhost:8081',
  CART_URL: 'http://localhost:8082',
  ORDER_URL: 'http://localhost:8083',
  PAYMENT_URL: 'http://localhost:8084',
  NOTIFICATION_URL: 'http://localhost:8085'
};

const services = [
  { name: 'product', port: '8081', dir: 'services/product' },
  { name: 'cart', port: '8082', dir: 'services/cart' },
  { name: 'payment', port: '8084', dir: 'services/payment' },
  { name: 'notification', port: '8085', dir: 'services/notification' },
  { name: 'order', port: '8083', dir: 'services/order' },
  { name: 'frontend', port: '8080', dir: 'services/frontend' }
];

const children = [];

for (const svc of services) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..', svc.dir),
    env: { ...env, PORT: svc.port },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk.toString());
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk.toString());
  });

  children.push(child);
}

process.on('SIGINT', () => {
  for (const child of children) child.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  for (const child of children) child.kill();
  process.exit(0);
});
