import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BankLogo, Button, Header } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useBanks, useRate } from '@/hooks/useProfile';
import { fmt, cn } from '@/lib/format';
import { REGIONS } from '@somex/shared';

export default function PostAd() {
  const nav = useNavigate();
  const { user } = useAuth();
  const banks = useBanks();
  const rate = useRate();
  const [f, setF] = useState({ side: 'SELL', price: '', minAmountFiat: '5000', maxAmountFiat: '200000', totalAmount: '', bankCode: '', region: 'ALL', terms: 'Оплата только со своего счёта на своё имя. Перевод от третьих лиц не принимаю.', paymentWindowMin: 15 });
  const myBanks = user?.paymentMethods.filter((p) => p.status === 'ACTIVE').map((p) => p.bankCode) ?? [];
  const create = useMutation({
    mutationFn: () => api('/p2p/ads', { body: { ...f, paymentWindowMin: Number(f.paymentWindowMin) } }),
    onSuccess: () => {
      toast.success('Объявление размещено');
      nav('/ads/mine', { replace: true });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const ref = rate.data ? Number(rate.data.price) : null;
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Новое объявление" subtitle="Ваш курс, лимиты и банк" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <div className="card2 p-1 flex">
          {(['SELL', 'BUY'] as const).map((s) => (
            <button key={s} onClick={() => set('side', s)} className={cn('flex-1 h-9 rounded-xl text-[13px] font-semibold', f.side === s ? 'tab-active' : 'muted')}>
              {s === 'SELL' ? 'Продаю USDT' : 'Покупаю USDT'}
            </button>
          ))}
        </div>
        <div className="text-[13px] font-semibold mt-4 mb-2">Банк (только ваши счета)</div>
        {myBanks.length === 0 ? (
          <div className="warn-card p-3 text-[12px]">
            Добавьте счёт на своё имя, чтобы разместить объявление.{' '}
            <button className="font-bold underline" onClick={() => nav('/profile/payment-methods')}>
              Добавить
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {banks.data?.filter((b: any) => myBanks.includes(b.code)).map((b: any) => (
              <button key={b.code} onClick={() => set('bankCode', b.code)} className={cn('card p-2 flex flex-col items-center gap-1', f.bankCode === b.code && 'border-green bg-green/10')}>
                <BankLogo code={b.code} logo={b.logo} color={b.color} size={30} />
                <span className="text-[11px] font-semibold">{b.shortName}</span>
              </button>
            ))}
          </div>
        )}
        <div className="text-[13px] font-semibold mt-4 mb-2">Цена за 1 USDT (KGS) {ref && <span className="muted font-normal">· рынок ≈ {fmt(ref, 2)}</span>}</div>
        <div className="input h-12 flex items-center px-3 gap-2">
          <input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value.replace(/[^\d.]/g, ''))} placeholder={ref ? String(ref) : '88.40'} className="flex-1 bg-transparent outline-none number-mono text-[18px] font-bold" />
          {ref && (
            <div className="flex gap-1">
              {[-0.5, 0, 0.5].map((d) => (
                <button key={d} onClick={() => set('price', (ref * (1 + d / 100)).toFixed(2))} className="chip px-2 h-7 text-[11px]">
                  {d > 0 ? '+' : ''}
                  {d}%
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {[
            ['minAmountFiat', 'Мин. сделка (KGS)'],
            ['maxAmountFiat', 'Макс. сделка (KGS)'],
          ].map(([k, l]) => (
            <label key={k} className="input h-12 flex flex-col justify-center px-3">
              <span className="text-[10px] muted">{l}</span>
              <input inputMode="numeric" value={(f as any)[k]} onChange={(e) => set(k, e.target.value.replace(/\D/g, ''))} className="bg-transparent outline-none number-mono text-[16px] font-semibold" />
            </label>
          ))}
        </div>
        <label className="input h-12 flex flex-col justify-center px-3 mt-2">
          <span className="text-[10px] muted">Объём (USDT) {f.side === 'SELL' && `· доступно ${fmt(user?.balance.available, 2)}`}</span>
          <input inputMode="decimal" value={f.totalAmount} onChange={(e) => set('totalAmount', e.target.value.replace(/[^\d.]/g, ''))} className="bg-transparent outline-none number-mono text-[16px] font-semibold" placeholder="1000" />
        </label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="input h-12 flex flex-col justify-center px-3">
            <span className="text-[10px] muted">Регион</span>
            <select value={f.region} onChange={(e) => set('region', e.target.value)} className="bg-transparent outline-none text-[16px] font-medium">
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="input h-12 flex flex-col justify-center px-3">
            <span className="text-[10px] muted">Окно оплаты (мин)</span>
            <select value={f.paymentWindowMin} onChange={(e) => set('paymentWindowMin', e.target.value)} className="bg-transparent outline-none text-[16px] font-medium">
              {[10, 15, 20, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <textarea value={f.terms} onChange={(e) => set('terms', e.target.value)} rows={3} className="input w-full p-3 text-[16px] mt-2" placeholder="Условия сделки" />
        <Button className="mt-4" disabled={!f.bankCode || !f.price || !f.totalAmount} loading={create.isPending} onClick={() => create.mutate()}>
          Разместить объявление
        </Button>
      </div>
    </div>
  );
}
