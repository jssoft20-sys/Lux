import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BadgeCheck, Ban, BookOpenCheck, Cpu, Gavel, LayoutDashboard, Lock, LogOut, Megaphone, ReceiptText, Settings, Shield, ShieldAlert, Smartphone, Users, Wallet, Headphones, Landmark } from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/store/auth';
import { cn } from '@/lib/format';
import { LogoMark } from './Logo';

const NAV = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard },
  { to: '/users', label: 'Пользователи', icon: Users },
  { to: '/kyc', label: 'KYC', icon: BadgeCheck, badge: 'kycPending' },
  { to: '/aml', label: 'AML / Депозиты', icon: ArrowDownToLine, badge: 'depositsHeld' },
  { to: '/withdrawals', label: 'Выводы', icon: ArrowUpFromLine, badge: 'withdrawalsPending' },
  { to: '/wallets', label: 'Кошельки', icon: Wallet },
  { to: '/p2p', label: 'P2P сделки', icon: ReceiptText, badge: 'ordersActive' },
  { to: '/ads', label: 'Объявления', icon: Megaphone },
  { to: '/escrow', label: 'Эскроу', icon: Lock },
  { to: '/disputes', label: 'Споры', icon: Gavel, badge: 'disputesOpen' },
  { to: '/risk', label: 'Risk Engine', icon: ShieldAlert, badge: 'riskPending' },
  { to: '/devices', label: 'Устройства', icon: Smartphone },
  { to: '/blacklist', label: 'Чёрный список', icon: Ban },
  { to: '/audit', label: 'Аудит', icon: BookOpenCheck },
  { to: '/support', label: 'Поддержка', icon: Headphones },
  { to: '/banks', label: 'Банки и курс', icon: Landmark },
  { to: '/settings', label: 'Настройки', icon: Settings, role: 'SUPERADMIN' },
  { to: '/admins', label: 'Администраторы', icon: Shield, role: 'SUPERADMIN' },
  { to: '/system', label: 'Система', icon: Cpu, role: 'SUPERADMIN' },
];

export function Layout() {
  const nav = useNavigate();
  const { admin, logout } = useAdminAuth();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<any>('/dashboard/stats'), refetchInterval: 15_000 });
  const q = stats.data?.queues ?? {};
  const freeze = useQuery({ queryKey: ['freeze-flag'], queryFn: () => api<any>('/wallet'), refetchInterval: 30_000 });
  return (
    <div className="flex h-full">
      <aside className="w-[236px] shrink-0 border-r border-[#1f2a26] bg-[#0c1210] flex flex-col">
        <div className="px-4 py-4 flex items-center gap-2 border-b border-[#1f2a26]">
          <LogoMark size={28} />
          <div>
            <div className="font-extrabold text-[15px] leading-tight">Somex</div>
            <div className="text-[10px] muted uppercase tracking-widest">Control Center</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {NAV.filter((n) => !n.role || admin?.role === n.role).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cn('nav-item', isActive && 'active')}>
              <n.icon size={16} />
              <span className="flex-1">{n.label}</span>
              {n.badge && q[n.badge] > 0 && <span className={cn('tag', n.badge === 'riskPending' || n.badge === 'disputesOpen' || n.badge === 'depositsHeld' ? 'tag-red' : 'tag-yellow')}>{q[n.badge]}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[#1f2a26]">
          <div className="text-[13px] font-semibold truncate">{admin?.name}</div>
          <div className="text-[11px] muted truncate">
            {admin?.email} · <span className="text-green">{admin?.role}</span>
          </div>
          <button
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
              logout();
              nav('/login');
            }}
            className="btn btn-ghost btn-sm w-full mt-2"
          >
            <LogOut size={14} /> Выйти
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-30 bg-[#0a0e0d]/90 backdrop-blur border-b border-[#1f2a26] px-6 h-12 flex items-center gap-3">
          <span className="live-dot" />
          <span className="text-[12px] muted">Live · обновление каждые 15 с</span>
          {freeze.data?.hotWallet?.frozen && (
            <span className="tag tag-red ml-2">
              <AlertTriangle size={12} /> HOT WALLET ЗАМОРОЖЕН
            </span>
          )}
          {freeze.data?.reconciliation && !freeze.data.reconciliation.ok && (
            <span className="tag tag-red">
              <AlertTriangle size={12} /> Расхождение леджера
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 text-[12px] muted">
            <Activity size={14} className="text-green" />
            Эскроу: <b className="text-[--color-text]">{Number(stats.data?.money?.escrowLocked ?? 0).toFixed(2)} USDT</b>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
