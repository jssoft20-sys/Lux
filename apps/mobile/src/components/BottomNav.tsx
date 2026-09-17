import { Home, ReceiptText, Zap, MessagesSquare, User } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/format';

export function BottomNav({ unread = 0, onQuick }: { unread?: number; onQuick: () => void }) {
  const loc = useLocation();
  const items = [
    { to: '/', label: 'Главная', icon: Home },
    { to: '/orders', label: 'Сделки', icon: ReceiptText },
    null,
    { to: '/chats', label: 'Чаты', icon: MessagesSquare, badge: unread },
    { to: '/profile', label: 'Профиль', icon: User },
  ];
  return (
    <div className="absolute left-0 right-0 bottom-0 z-30">
      <div className="mx-0 bg-[#0e1512]/95 backdrop-blur border-t border-[#1d2823] safe-bottom pt-2 px-2 flex items-end justify-between">
        {items.map((it, i) =>
          it === null ? (
            <button key="quick" onClick={onQuick} className="relative -mt-7 w-[58px] h-[58px] rounded-full btn-green green-glow flex items-center justify-center press" aria-label="Быстрые действия">
              <Zap size={26} fill="#06240f" />
            </button>
          ) : (
            <NavLink key={it.to} to={it.to} className="flex-1 flex flex-col items-center gap-1 py-1 relative">
              {({ isActive }) => {
                const active = isActive || (it.to === '/' && loc.pathname === '/');
                return (
                  <>
                    <div className="relative">
                      <it.icon size={22} className={cn(active ? 'text-green' : 'text-[#7b877f]')} />
                      {!!it.badge && <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-green text-[#06240f] text-[10px] font-bold flex items-center justify-center">{it.badge}</span>}
                    </div>
                    <span className={cn('text-[10px] font-medium', active ? 'text-green' : 'text-[#7b877f]')}>{it.label}</span>
                    {active && <motion.span layoutId="nav-dot" className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-green" />}
                  </>
                );
              }}
            </NavLink>
          ),
        )}
      </div>
    </div>
  );
}
