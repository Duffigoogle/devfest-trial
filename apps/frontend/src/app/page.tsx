'use client';

import React, { useState } from 'react';
import { StorefrontOrderState, StorefrontProduct } from '../lib/api-client';

const SAGA_STEPS = [
  { key: 'PENDING_INVENTORY', label: '1. Order Created & Reserving Stock (Product Service)' },
  { key: 'AWAITING_PAYMENT', label: '2. Stock Reserved & Payment Intent Ready (Payment Service)' },
  { key: 'CONFIRMED', label: '3. Payment Confirmed & Notification Sent (Order + Notification Service)' },
] as const;

export default function CloudMartStorefrontPage() {
  const [products] = useState<StorefrontProduct[]>([
    {
      id: 'prod-pixel-9-pro',
      sku: 'SKU-PIXEL-9-PRO',
      name: 'CloudMart Flagship Smartphone 256GB',
      description: 'AI-accelerated flagship device with hardware security chip',
      category: 'Electronics',
      priceCents: 99900,
      currency: 'USD',
      availableQty: 25,
    },
    {
      id: 'prod-cloud-buds',
      sku: 'SKU-CLOUD-BUDS-PRO',
      name: 'CloudBuds Active Noise Cancelling Earbuds',
      description: 'Low-latency spatial audio earbuds with 36-hour battery case',
      category: 'Audio',
      priceCents: 19900,
      currency: 'USD',
      availableQty: 60,
    },
  ]);

  const [activeOrder, setActiveOrder] = useState<StorefrontOrderState | null>(null);

  return (
    <div>
      <section style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0' }}>CloudMart Product Catalog</h1>
        <p style={{ margin: 0, color: '#475569' }}>
          Every cart addition validates SKU & pricing via synchronous gRPC; checkout executes an asynchronous Event-Driven Saga over Google Cloud Pub/Sub.
        </p>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {products.map((product) => (
          <div
            key={product.id}
            style={{
              background: '#ffffff',
              borderRadius: '0.75rem',
              padding: '1.5rem',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2563eb', textTransform: 'uppercase' }}>
                {product.category} • {product.sku}
              </span>
              <h3 style={{ margin: '0.5rem 0' }}>{product.name}</h3>
              <p style={{ color: '#64748b', fontSize: '0.9rem' }}>{product.description}</p>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '1.25rem' }}>
                ${(product.priceCents / 100).toFixed(2)}
              </strong>
              <button
                onClick={() =>
                  setActiveOrder({
                    orderId: 'ord-demo-1001',
                    status: 'CONFIRMED',
                    totalCents: product.priceCents,
                    currency: product.currency,
                    sagaHistory: [
                      'ORDER_CREATED:PENDING_INVENTORY',
                      'INVENTORY_RESERVED:res-ord-demo-1001',
                      'PAYMENT_INTENT_CREATED:pay-tx-ord-demo-1001',
                      'PAYMENT_SUCCEEDED:CONFIRMED',
                    ],
                  })
                }
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '0.6rem 1rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Buy Now (Run Saga)
              </button>
            </div>
          </div>
        ))}
      </div>

      {activeOrder && (
        <section
          style={{
            marginTop: '2.5rem',
            background: '#ffffff',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            border: '1px solid #cbd5e1',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Live Checkout Saga Tracker — Order #{activeOrder.orderId}</h2>
          <p style={{ color: '#475569' }}>
            Current Status: <strong>{activeOrder.status}</strong>
          </p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {SAGA_STEPS.map((step) => (
              <li key={step.key} style={{ padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9' }}>
                ✓ {step.label}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
