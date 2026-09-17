import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/store/auth';
import { useProfile, useUnread } from '@/hooks/useProfile';
import { BottomNav } from '@/components/BottomNav';
import { QuickActions } from '@/screens/QuickActions';
import { Spinner } from '@/components/ui';

const Welcome = lazy(() => import('@/screens/Welcome'));
const Login = lazy(() => import('@/screens/Login'));
const Otp = lazy(() => import('@/screens/Otp'));
const Home = lazy(() => import('@/screens/Home'));
const Kyc = lazy(() => import('@/screens/Kyc'));
const CreateOrder = lazy(() => import('@/screens/CreateOrder'));
const Orders = lazy(() => import('@/screens/Orders'));
const OrderDetails = lazy(() => import('@/screens/OrderDetails'));
const ConfirmPayment = lazy(() => import('@/screens/ConfirmPayment'));
const Chat = lazy(() => import('@/screens/Chat'));
const Release = lazy(() => import('@/screens/Release'));
const OrderComplete = lazy(() => import('@/screens/OrderComplete'));
const Dispute = lazy(() => import('@/screens/Dispute'));
const Chats = lazy(() => import('@/screens/Chats'));
const Profile = lazy(() => import('@/screens/Profile'));
const PaymentMethods = lazy(() => import('@/screens/PaymentMethods'));
const Security = lazy(() => import('@/screens/Security'));
const Deposit = lazy(() => import('@/screens/Deposit'));
const Withdraw = lazy(() => import('@/screens/Withdraw'));
const History = lazy(() => import('@/screens/History'));
const Notifications = lazy(() => import('@/screens/Notifications'));
const PostAd = lazy(() => import('@/screens/PostAd'));
const MyAds = lazy(() => import('@/screens/MyAds'));
const Support = lazy(() => import('@/screens/Support'));
const Settings = lazy(() => import('@/screens/Settings'));

const NAV_ROUTES = ['/', '/orders', '/chats', '/profile'];

function Guard({ children }: { children: React.ReactElement }) {
  const { accessToken } = useAuth();
  const loc = useLocation();
  if (!accessToken) return <Navigate to="/welcome" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const { accessToken } = useAuth();
  const [quick, setQuick] = useState(false);
  useProfile(!!accessToken);
  const unread = useUnread();
  const showNav = !!accessToken && NAV_ROUTES.includes(loc.pathname);

  useEffect(() => {
    if (!accessToken && !['/welcome', '/login', '/otp'].includes(loc.pathname)) nav('/welcome', { replace: true });
  }, [accessToken, loc.pathname, nav]);

  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, #10201a 0%, #050807 60%)' }}>
      <div className="phone-frame">
        <div className="dynamic-island" />
        <div className="phone-screen theme-dark screen">
          <Suspense
            fallback={
              <div className="h-full flex items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={loc.pathname} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="absolute inset-0 overflow-y-auto hide-scroll">
                <Routes location={loc}>
                  <Route path="/welcome" element={<Welcome />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/otp" element={<Otp />} />
                  <Route path="/" element={<Guard><Home /></Guard>} />
                  <Route path="/kyc" element={<Guard><Kyc /></Guard>} />
                  <Route path="/kyc/callback" element={<Guard><Kyc callback /></Guard>} />
                  <Route path="/ads/:id/order" element={<Guard><CreateOrder /></Guard>} />
                  <Route path="/orders" element={<Guard><Orders /></Guard>} />
                  <Route path="/orders/:id" element={<Guard><OrderDetails /></Guard>} />
                  <Route path="/orders/:id/confirm" element={<Guard><ConfirmPayment /></Guard>} />
                  <Route path="/orders/:id/chat" element={<Guard><Chat /></Guard>} />
                  <Route path="/orders/:id/release" element={<Guard><Release /></Guard>} />
                  <Route path="/orders/:id/complete" element={<Guard><OrderComplete /></Guard>} />
                  <Route path="/orders/:id/dispute" element={<Guard><Dispute /></Guard>} />
                  <Route path="/chats" element={<Guard><Chats /></Guard>} />
                  <Route path="/profile" element={<Guard><Profile /></Guard>} />
                  <Route path="/profile/payment-methods" element={<Guard><PaymentMethods /></Guard>} />
                  <Route path="/profile/security" element={<Guard><Security /></Guard>} />
                  <Route path="/profile/settings" element={<Guard><Settings /></Guard>} />
                  <Route path="/wallet/deposit" element={<Guard><Deposit /></Guard>} />
                  <Route path="/wallet/withdraw" element={<Guard><Withdraw /></Guard>} />
                  <Route path="/wallet/history" element={<Guard><History /></Guard>} />
                  <Route path="/notifications" element={<Guard><Notifications /></Guard>} />
                  <Route path="/ads/new" element={<Guard><PostAd /></Guard>} />
                  <Route path="/ads/mine" element={<Guard><MyAds /></Guard>} />
                  <Route path="/support" element={<Guard><Support /></Guard>} />
                  <Route path="*" element={<Navigate to={accessToken ? '/' : '/welcome'} replace />} />
                </Routes>
              </motion.div>
            </AnimatePresence>
          </Suspense>
          {showNav && <BottomNav unread={unread.data?.unread ?? 0} onQuick={() => setQuick(true)} />}
          <AnimatePresence>{quick && <QuickActions onClose={() => setQuick(false)} />}</AnimatePresence>
        </div>
      </div>
    </div>
  );
}
