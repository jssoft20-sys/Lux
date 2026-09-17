import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { BadgeCheck, Camera, ChevronRight, CreditCard, Headphones, History, LogOut, Megaphone, Settings, Shield, ShieldCheck, Star, Wallet } from 'lucide-react';
import { Avatar, Pressable } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { api, fetchFileBlob } from '@/lib/api';
import { closeSocket } from '@/lib/socket';
import { fmt, cn } from '@/lib/format';

export default function Profile() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, logout } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState('');
  useEffect(() => {
    if (user?.avatarFileId) fetchFileBlob(user.avatarFileId).then(setAvatar).catch(() => undefined);
  }, [user?.avatarFileId]);
  if (!user) return null;
  const verified = user.kyc.status === 'APPROVED';
  const rows = [
    { icon: Wallet, l: 'Баланс', v: `${fmt(user.balance.available, 2)} USDT`, to: '/wallet/history', c: 'text-green bg-green/15' },
    { icon: CreditCard, l: 'Способы оплаты', v: user.paymentMethods.map((p) => p.bankShort).join(', ') || 'Добавить', to: '/profile/payment-methods', c: 'text-blue bg-blue/15' },
    { icon: BadgeCheck, l: 'Верификация', v: verified ? 'Пройдена' : 'Не пройдена', to: '/kyc', c: verified ? 'text-green bg-green/15' : 'text-yellow bg-yellow/15', tone: verified ? 'text-green' : 'text-yellow' },
    { icon: Shield, l: 'Безопасность', v: user.security.pinSet ? 'PIN включён' : 'Без PIN', to: '/profile/security', c: 'text-purple-300 bg-purple-500/15', tone: user.security.pinSet ? undefined : 'text-yellow' },
    { icon: History, l: 'Сделки', v: `${fmt(user.stats.completedOrders, 0)}`, to: '/orders', c: 'text-[#f5b935] bg-yellow/15' },
    { icon: Megaphone, l: 'Мои объявления', v: '', to: '/ads/mine', c: 'text-pink-300 bg-pink-500/15' },
    { icon: Headphones, l: 'Поддержка', v: '24/7', to: '/support', c: 'text-green bg-green/15', tone: 'text-green' },
    { icon: Settings, l: 'Настройки', v: '', to: '/profile/settings', c: 'muted bg-white/5' },
  ];
  async function upload(f: File) {
    try {
      const fd = new FormData();
      fd.append('file', f);
      await api('/files?kind=AVATAR', { form: fd });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Фото обновлено');
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <div className="safe-top px-4 pb-2 flex items-center justify-between">
        <span className="text-[22px] font-extrabold">Профиль</span>
        <Pressable onClick={() => nav('/profile/settings')} className="w-10 h-10 rounded-full flex items-center justify-center" scale={0.85}>
          <Settings size={20} />
        </Pressable>
      </div>
      <div className="flex-1 overflow-y-auto hide-scroll px-4 pb-28">
        <div className="card p-4 relative overflow-hidden">
          <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full bg-green/10 blur-2xl" />
          <div className="flex items-center gap-4 relative">
            <motion.button whileTap={{ scale: 0.92 }} onClick={() => input.current?.click()} className="relative shrink-0">
              <Avatar name={user.fullName ?? user.nickname ?? user.phone} size={72} src={avatar || null} />
              <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-green text-[#06240f] border-2 border-[#141c19] flex items-center justify-center">
                <Camera size={13} />
              </span>
              <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </motion.button>
            <div className="min-w-0">
              <div className="text-[18px] font-extrabold leading-tight truncate">{user.fullName ? `${user.firstName} ${user.lastName}` : user.nickname ?? 'Пользователь'}</div>
              <div className="text-[13px] muted number-mono">{user.phoneFormatted}</div>
              {verified ? (
                <div className="text-[12px] text-green flex items-center gap-1 mt-1">
                  <ShieldCheck size={13} /> Проверенный пользователь
                </div>
              ) : (
                <button onClick={() => nav('/kyc')} className="text-[12px] text-yellow mt-1">
                  Пройти верификацию →
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4 relative">
            {[
              { l: 'Сделок', v: fmt(user.stats.completedOrders, 0) },
              { l: 'Рейтинг', v: user.stats.rating ? `${user.stats.rating}` : '—', icon: true },
              { l: 'Выполнение', v: `${user.stats.completionRate}%` },
            ].map((s) => (
              <div key={s.l} className="card2 py-2 text-center">
                <div className="text-[15px] font-extrabold number-mono flex items-center justify-center gap-1">
                  {s.icon && <Star size={12} className="text-yellow" fill="#f5b935" />}
                  {s.v}
                </div>
                <div className="text-[10px] muted">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <span className={cn('px-3 py-1 rounded-full text-[11px] font-bold', verified ? 'bg-green text-[#06240f]' : 'status-yellow')}>{verified ? 'KYC пройден' : 'KYC не пройден'}</span>
          <span className="px-3 py-1 rounded-full text-[11px] font-bold status-gray">{user.kyc.level}</span>
        </div>
        <div className="card mt-3 divide-y line overflow-hidden">
          {rows.map((r) => (
            <Pressable key={r.l} onClick={() => nav(r.to)} className="w-full flex items-center gap-3 px-3 py-3 press-row" scale={0.99}>
              <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center', r.c)}>
                <r.icon size={17} />
              </span>
              <span className="flex-1 text-[14px] font-medium">{r.l}</span>
              <span className={cn('text-[12px]', r.tone ?? 'muted')}>{r.v}</span>
              <ChevronRight size={16} className="muted" />
            </Pressable>
          ))}
        </div>
        <Pressable
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
            closeSocket();
            logout();
            nav('/welcome', { replace: true });
          }}
          className="w-full mt-4 h-12 rounded-2xl btn-danger font-semibold flex items-center justify-center gap-2"
          scale={0.97}
        >
          <LogOut size={16} /> Выйти
        </Pressable>
        <div className="text-center text-[11px] muted mt-4">Somex · Кыргызстан 🇰🇬</div>
      </div>
    </div>
  );
}
