import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAdminAuth } from '@/store/auth';
import { restoreSession } from '@/lib/api';
import { Layout } from '@/components/Layout';

const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const UsersPage = lazy(() => import('@/pages/Users'));
const UserDetail = lazy(() => import('@/pages/UserDetail'));
const KycPage = lazy(() => import('@/pages/Kyc'));
const AmlPage = lazy(() => import('@/pages/Aml'));
const WithdrawalsPage = lazy(() => import('@/pages/Withdrawals'));
const WalletsPage = lazy(() => import('@/pages/Wallets'));
const OrdersPage = lazy(() => import('@/pages/Orders'));
const AdsPage = lazy(() => import('@/pages/Ads'));
const EscrowPage = lazy(() => import('@/pages/Escrow'));
const DisputesPage = lazy(() => import('@/pages/Disputes'));
const RiskPage = lazy(() => import('@/pages/Risk'));
const DevicesPage = lazy(() => import('@/pages/Devices'));
const BlacklistPage = lazy(() => import('@/pages/Blacklist'));
const AuditPage = lazy(() => import('@/pages/Audit'));
const SupportPage = lazy(() => import('@/pages/Support'));
const BanksPage = lazy(() => import('@/pages/Banks'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
const AdminsPage = lazy(() => import('@/pages/Admins'));
const SystemPage = lazy(() => import('@/pages/System'));

function Guard({ children }: { children: React.ReactElement }) {
  const { accessToken } = useAdminAuth();
  return accessToken ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const restored = useAdminAuth((s) => s.restored);
  useEffect(() => {
    restoreSession();
  }, []);
  if (!restored) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-green" />
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center">
          <Loader2 className="animate-spin text-green" />
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Guard>
              <Layout />
            </Guard>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:id" element={<UserDetail />} />
          <Route path="/kyc" element={<KycPage />} />
          <Route path="/aml" element={<AmlPage />} />
          <Route path="/withdrawals" element={<WithdrawalsPage />} />
          <Route path="/wallets" element={<WalletsPage />} />
          <Route path="/p2p" element={<OrdersPage />} />
          <Route path="/p2p/:id" element={<OrdersPage />} />
          <Route path="/ads" element={<AdsPage />} />
          <Route path="/escrow" element={<EscrowPage />} />
          <Route path="/disputes" element={<DisputesPage />} />
          <Route path="/disputes/:id" element={<DisputesPage />} />
          <Route path="/risk" element={<RiskPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/blacklist" element={<BlacklistPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/banks" element={<BanksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admins" element={<AdminsPage />} />
          <Route path="/system" element={<SystemPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
