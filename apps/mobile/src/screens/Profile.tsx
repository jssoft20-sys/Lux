import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, ChevronRight, CreditCard, Headphones, History, LogOut, Settings, Shield, ShieldCheck, Wallet, Megaphone, Camera } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { api, fetchFileBlob } from '@/lib/api';
import { closeSocket } from '@/lib/socket';
import { fmt } from '@/lib/format';
import { useEffect, useState } from 'react';

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
    { icon: Wallet, l: 'Мой баланс', v: `${fmt(user.balance.available, 2)} USDT`, to: '/wallet/history' },
    { icon: CreditCard, l: 'Способы оплаты', v: user.paymentMethods.map((p) => p.bankShort).join(', ') || 'Добавить', to: '/profile/payment-methods' },
    { icon: BadgeCheck, l: 'Верификация (KYC)', v: verified ? 'Пройден' : 'Не пройден', to: '/kyc', tone: verified ? 'text-green' : 'text-yellow' },
    { icon: Shield, l: 'Безопасность', v: `${user.security.pinSet ? 'PIN' : 'без PIN'}, ${user.security.devices} устр.`, to: '/profile/security' },
    { icon: History, l: 'История сделок', v: `${fmt(user.stats.completedOrders, 0)} сделок`, to: '/orders' },
    { icon: Megaphone, l: 'Мои объявления', v: '', to: '/ads/mine' },
    { icon: Headphones, l: 'Поддержка', v: 'Онлайн 24/7', to: '/support', tone: 'text-green' },
    { icon: Settings, l: 'Настройки', v: '', to: '/profile/settings' },
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
        <span className="text-[22px] font-extrabold">Мой профиль</span>
        <button onClick={() => nav('/profile/settings')} className="w-10 h-10 rounded-full flex items-center justify-center">
          <Settings size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto hide-scroll px-4 pb-28">
        <div className="flex items-center gap-4 mt-2">
          <button onClick={() => input.current?.click()} className="relative">
            <Avatar name={user.fullName ?? user.nickname ?? user.phone} size={68} src={avatar || null} />
            <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green text-[#06240f] flex items-center justify-center">
              <Camera size={13} />
            </span>
            <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </button>
          <div>
            <div className="text-[17px] font-extrabold leading-tight">{user.fullName ? `${user.firstName} ${user.lastName}` : user.nickname ?? 'Пользователь'}</div>
            <div className="text-[13px] muted">{user.phoneFormatted}</div>
            {verified ? (
              <div className="text-[12px] text-green flex items-center gap-1 mt-0.5">
                <ShieldCheck size={13} /> Проверенный пользователь
              </div>
            ) : (
              <button onClick={() => nav('/kyc')} className="text-[12px] text-yellow mt-0.5">
                Пройдите верификацию →
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <span className={`px-3 py-1 rounded-full text-[11px] font-bold ${verified ? 'bg-green text-[#06240f]' : 'status-yellow'}`}>{verified ? 'KYC пройден' : 'KYC не пройден'}</span>
          <span className="px-3 py-1 rounded-full text-[11px] font-bold status-gray">{user.kyc.level}</span>
          {user.stats.rating && <span className="px-3 py-1 rounded-full text-[11px] font-bold status-gray">★ {user.stats.rating}</span>}
        </div>
        <div className="card mt-4 divide-y line">
          {rows.map((r) => (
            <button key={r.l} onClick={() => nav(r.to)} className="w-full flex items-center gap-3 px-3 py-3 text-left press">
              <span className="w-8 h-8 rounded-lg card2 flex items-center justify-center">
                <r.icon size={16} />
              </span>
              <span className="flex-1 text-[14px] font-medium">{r.l}</span>
              <span className={`text-[12px] ${r.tone ?? 'muted'}`}>{r.v}</span>
              <ChevronRight size={16} className="muted" />
            </button>
          ))}
        </div>
        <button
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
            closeSocket();
            logout();
            nav('/welcome', { replace: true });
          }}
          className="w-full mt-4 h-12 rounded-2xl btn-danger font-semibold flex items-center justify-center gap-2"
        >
          <LogOut size={16} /> Выйти
        </button>
        <div className="text-center text-[11px] muted mt-4">Somex — Больше чем обмен. Мы — Кыргызстан. 🇰🇬</div>
      </div>
    </div>
  );
}
