import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { authenticate, requirePasswordChanged, requirePermission } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { suppliersRoutes } from './modules/suppliers/suppliers.routes.js';
import { warehousesRoutes } from './modules/warehouses/warehouses.routes.js';
import { productsRoutes } from './modules/products/products.routes.js';
import { stockRoutes } from './modules/stock/stock.routes.js';
import { alertsRoutes } from './modules/alerts/alerts.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { dashboardRoutes, reportsRoutes } from './modules/reports/reports.routes.js';
import { integrationsRoutes } from './modules/integrations/integrations.routes.js';
import { setupRoutes } from './modules/setup/setup.routes.js';
import { nfeRoutes } from './modules/nfe/nfe.routes.js';
import { salesRoutes } from './modules/sales/sales.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { cashRoutes } from './modules/cash/cash.routes.js';
import { customersRoutes } from './modules/customers/customers.routes.js';
import { purchaseOrdersRoutes } from './modules/purchasing/purchase-orders.routes.js';
import { promotionsRoutes } from './modules/promotions/promotions.routes.js';
import { loyaltyRoutes } from './modules/loyalty/loyalty.routes.js';
import { billsRoutes } from './modules/bills/bills.routes.js';
import { couriersRoutes, deliveriesRoutes } from './modules/deliveries/deliveries.routes.js';

interface AppOptions {
  /** Pasta do front-end compilado. Quando informada, a API também serve a interface. */
  webDist?: string;
}

export function createApp({ webDist }: AppOptions = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Política de conteúdo para a interface servida por esta API (programa instalado e hospedagem):
  // só scripts do próprio sistema, nada de scripts injetados. Os <style> de impressão (tamanho da
  // página) precisam de 'unsafe-inline' em estilos. Sem "upgrade-insecure-requests": no computador
  // da loja a interface roda em http://127.0.0.1, e trocar para https quebraria tudo.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'upgrade-insecure-requests': null,
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) }));
  app.use(express.json({ limit: '1mb' }));

  if (env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
      const start = performance.now();
      res.on('finish', () =>
        console.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Math.round(performance.now() - start)}ms`),
      );
      next();
    });
  }

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/setup', setupRoutes);

  const api = Router();
  api.use(authenticate);
  api.use(requirePasswordChanged);
  api.use('/dashboard', dashboardRoutes);
  api.use('/users', requirePermission('users:manage'), usersRoutes);
  api.use('/suppliers', suppliersRoutes);
  api.use('/warehouses', warehousesRoutes);
  api.use('/products', productsRoutes);
  api.use('/stock', stockRoutes);
  api.use('/alerts', alertsRoutes);
  api.use('/inventories', inventoryRoutes);
  api.use('/reports', reportsRoutes);
  api.use('/integrations', integrationsRoutes);
  api.use('/nfe', nfeRoutes);
  api.use('/sales', salesRoutes);
  api.use('/cash', cashRoutes);
  api.use('/customers', customersRoutes);
  api.use('/purchase-orders', purchaseOrdersRoutes);
  api.use('/promotions', promotionsRoutes);
  api.use('/loyalty-rules', loyaltyRoutes);
  api.use('/deliveries', deliveriesRoutes);
  api.use('/couriers', couriersRoutes);
  // Contas a pagar: só administrador e gerente (nem a tela nem os dados para os outros perfis).
  api.use('/bills', requirePermission('bills:manage'), billsRoutes);
  api.use('/settings', settingsRoutes);
  api.use('/audit', requirePermission('audit:read'), auditRoutes);
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  // A API pode servir o front-end compilado: um único serviço (hospedagem ou app desktop).
  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist, { maxAge: '1h', index: false }));
    app.get('/{*path}', (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
