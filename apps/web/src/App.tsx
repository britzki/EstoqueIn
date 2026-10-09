import { lazy, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './lib/auth';
import type { Permission } from './lib/types';
import { Layout } from './components/Layout';
import { EmptyState, Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { ForcedPasswordChange } from './components/ChangePassword';
import { ShieldCheck } from 'lucide-react';

/** Cada página vira um arquivo separado, carregado só quando acessada. */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage');
const ProductsPage = lazyPage(() => import('./pages/products/ProductsPage'), 'ProductsPage');
const ProductDetailPage = lazyPage(() => import('./pages/products/ProductDetailPage'), 'ProductDetailPage');
const ImportProductsPage = lazyPage(() => import('./pages/products/ImportProductsPage'), 'ImportProductsPage');
const SuppliersPage = lazyPage(() => import('./pages/SuppliersPage'), 'SuppliersPage');
const WarehousesPage = lazyPage(() => import('./pages/WarehousesPage'), 'WarehousesPage');
const NewMovementPage = lazyPage(() => import('./pages/movements/NewMovementPage'), 'NewMovementPage');
const NfeImportPage = lazyPage(() => import('./pages/nfe/NfeImportPage'), 'NfeImportPage');
const MovementsPage = lazyPage(() => import('./pages/movements/MovementsPage'), 'MovementsPage');
const AlertsPage = lazyPage(() => import('./pages/AlertsPage'), 'AlertsPage');
const InventoriesPage = lazyPage(() => import('./pages/inventory/InventoriesPage'), 'InventoriesPage');
const InventoryDetailPage = lazyPage(() => import('./pages/inventory/InventoryDetailPage'), 'InventoryDetailPage');
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportsPage');
const NewSalePage = lazyPage(() => import('./pages/sales/NewSalePage'), 'NewSalePage');
const SalesPage = lazyPage(() => import('./pages/sales/SalesPage'), 'SalesPage');
const CashPage = lazyPage(() => import('./pages/cash/CashPage'), 'CashPage');
const CustomersPage = lazyPage(() => import('./pages/CustomersPage'), 'CustomersPage');
const PurchaseOrdersPage = lazyPage(() => import('./pages/purchasing/PurchaseOrdersPage'), 'PurchaseOrdersPage');
const PromotionsPage = lazyPage(() => import('./pages/PromotionsPage'), 'PromotionsPage');
const DeliveriesPage = lazyPage(() => import('./pages/DeliveriesPage'), 'DeliveriesPage');
const BillsPage = lazyPage(() => import('./pages/BillsPage'), 'BillsPage');
const HelpPage = lazyPage(() => import('./pages/HelpPage'), 'HelpPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const AuditPage = lazyPage(() => import('./pages/AuditPage'), 'AuditPage');
const UsersPage = lazyPage(() => import('./pages/UsersPage'), 'UsersPage');

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
        <Route path="deliveries" element={<DeliveriesPage />} />
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
