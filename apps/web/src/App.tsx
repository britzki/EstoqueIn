import { lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './lib/auth';
import type { Permission } from './lib/types';
import { Layout } from './components/Layout';
import { EmptyState, Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { ForcedPasswordChange } from './components/ChangePassword';
import { ShieldCheck } from 'lucide-react';

// Cada página vira um arquivo separado, carregado só quando acessada.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ProductsPage = lazy(() => import('./pages/products/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const ProductDetailPage = lazy(() =>
  import('./pages/products/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })),
);
const ImportProductsPage = lazy(() =>
  import('./pages/products/ImportProductsPage').then((m) => ({ default: m.ImportProductsPage })),
);
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })));
const WarehousesPage = lazy(() => import('./pages/WarehousesPage').then((m) => ({ default: m.WarehousesPage })));
const NewMovementPage = lazy(() =>
  import('./pages/movements/NewMovementPage').then((m) => ({ default: m.NewMovementPage })),
);
const NfeImportPage = lazy(() => import('./pages/nfe/NfeImportPage').then((m) => ({ default: m.NfeImportPage })));
const MovementsPage = lazy(() => import('./pages/movements/MovementsPage').then((m) => ({ default: m.MovementsPage })));
const AlertsPage = lazy(() => import('./pages/AlertsPage').then((m) => ({ default: m.AlertsPage })));
const InventoriesPage = lazy(() =>
  import('./pages/inventory/InventoriesPage').then((m) => ({ default: m.InventoriesPage })),
);
const InventoryDetailPage = lazy(() =>
  import('./pages/inventory/InventoryDetailPage').then((m) => ({ default: m.InventoryDetailPage })),
);
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const NewSalePage = lazy(() => import('./pages/sales/NewSalePage').then((m) => ({ default: m.NewSalePage })));
const SalesPage = lazy(() => import('./pages/sales/SalesPage').then((m) => ({ default: m.SalesPage })));
const CashPage = lazy(() => import('./pages/cash/CashPage').then((m) => ({ default: m.CashPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const PurchaseOrdersPage = lazy(() =>
  import('./pages/purchasing/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })),
);
const PromotionsPage = lazy(() => import('./pages/PromotionsPage').then((m) => ({ default: m.PromotionsPage })));
const BillsPage = lazy(() => import('./pages/BillsPage').then((m) => ({ default: m.BillsPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Carregando sessão..." />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.mustChangePassword) return <ForcedPasswordChange />;
  return children;
}

function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Acesso restrito"
        description="Seu perfil não tem permissão para acessar esta página. Fale com um administrador."
      />
    );
  }
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route
          path="products/import"
          element={
            <RequirePermission permission="products:import">
              <ImportProductsPage />
            </RequirePermission>
          }
        />
        <Route path="products/:id" element={<ProductDetailPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="warehouses" element={<WarehousesPage />} />
        <Route
          path="movements/new"
          element={
            <RequirePermission permission="stock:move">
              <NewMovementPage />
            </RequirePermission>
          }
        />
        <Route
          path="movements/nfe"
          element={
            <RequirePermission permission="stock:move">
              <NfeImportPage />
            </RequirePermission>
          }
        />
        <Route path="movements" element={<MovementsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="inventories" element={<InventoriesPage />} />
        <Route path="inventories/:id" element={<InventoryDetailPage />} />
        <Route
          path="reports"
          element={
            <RequirePermission permission="reports:read">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="sales/new"
          element={
            <RequirePermission permission="sales:create">
              <NewSalePage />
            </RequirePermission>
          }
        />
        <Route path="sales" element={<SalesPage />} />
        <Route path="cash" element={<CashPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="promotions" element={<PromotionsPage />} />
        <Route
          path="bills"
          element={
            <RequirePermission permission="bills:manage">
              <BillsPage />
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="settings:manage">
              <SettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit:read">
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route
          path="users"
          element={
            <RequirePermission permission="users:manage">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="*"
          element={<EmptyState title="Página não encontrada" description="Confira o endereço digitado." />}
        />
      </Route>
    </Routes>
  );
}
