import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { AppShell } from '@/components/layout/AppShell';
import { Dashboard } from '@/routes/Dashboard';
import { Styleguide } from '@/routes/Styleguide';
import { AlertList } from '@/routes/AlertList';
import { Login } from '@/routes/Login';
import { ForgotPassword } from '@/routes/ForgotPassword';
import { ResetPassword } from '@/routes/ResetPassword';
import { Items } from '@/routes/Items';
import { ItemDetail } from '@/routes/ItemDetail';
import { StockTransactions } from '@/routes/StockTransactions';
import { TaxRates } from '@/routes/TaxRates';
import { CurrencySettings } from '@/routes/CurrencySettings';
import { Suppliers } from '@/routes/Suppliers';
import { SupplierDetail } from '@/routes/SupplierDetail';
import { PurchaseOrders } from '@/routes/PurchaseOrders';
import { PurchaseOrderForm } from '@/routes/PurchaseOrderForm';
import { PurchaseOrderDetail } from '@/routes/PurchaseOrderDetail';
import { GrnList } from '@/routes/GrnList';
import { NewGrn } from '@/routes/NewGrn';
import { DirectGrnForm } from '@/routes/DirectGrnForm';
import { PoGrnForm } from '@/routes/PoGrnForm';
import { ScanInvoiceGrnForm } from '@/routes/ScanInvoiceGrnForm';
import { GrnDetail } from '@/routes/GrnDetail';
import { getSession } from '@/lib/auth-store';

function RequireAuth({ children }: { children: ReactNode }) {
  return getSession() ? <>{children}</> : <Navigate to="/login" replace />;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  return getSession() ? <Navigate to="/" replace /> : <>{children}</>;
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          {/* Pre-auth, no Global App Chrome — FR-13's Login screen. */}
          <Route
            path="/login"
            element={
              <RedirectIfAuthed>
                <Login />
              </RedirectIfAuthed>
            }
          />

          {/* Also pre-auth. Not wrapped in RedirectIfAuthed: a signed-in user
              following a reset link from their inbox should still be able to
              complete the reset rather than be bounced to the dashboard. */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/items" element={<Items />} />
            <Route path="/items/:id" element={<ItemDetail />} />
            <Route path="/stock" element={<StockTransactions />} />
            <Route path="/tax-rates" element={<TaxRates />} />
            <Route path="/currency" element={<CurrencySettings />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/suppliers/:id" element={<SupplierDetail />} />
            <Route path="/purchase-orders" element={<PurchaseOrders />} />
            <Route path="/purchase-orders/new" element={<PurchaseOrderForm />} />
            <Route path="/purchase-orders/:id/edit" element={<PurchaseOrderForm />} />
            <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
            <Route path="/grn" element={<GrnList />} />
            <Route path="/grn/new" element={<NewGrn />} />
            <Route path="/grn/new/direct" element={<DirectGrnForm />} />
            <Route path="/grn/new/scan" element={<ScanInvoiceGrnForm />} />
            <Route path="/grn/new/po" element={<PoGrnForm />} />
            <Route path="/grn/new/po/:poId" element={<PoGrnForm />} />
            <Route path="/grn/:id" element={<GrnDetail />} />
            <Route path="/styleguide" element={<Styleguide />} />
            <Route path="/alerts/:type" element={<AlertList />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
