import React from 'react';

export const metadata = {
  title: 'CloudMart | Cloud-Native Microservices Storefront',
  description: 'Next.js Storefront powered by NestJS Microservices on GKE Autopilot, Cloud SQL, and Cloud Pub/Sub',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <header style={{ background: '#0f172a', color: '#ffffff', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>CloudMart</strong>
            <span style={{ marginLeft: '0.75rem', fontSize: '0.85rem', color: '#94a3b8' }}>
              GKE Autopilot • Cloud SQL PostgreSQL • Cloud Pub/Sub Saga
            </span>
          </div>
          <nav style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
            Catalog • Cart • Orders
          </nav>
        </header>
        <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
