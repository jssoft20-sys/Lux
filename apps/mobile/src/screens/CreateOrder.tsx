import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Avatar, Button, Check, Header, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { fmt, cn } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { REGION_MAP } from '@somex/shared';

export default function CreateOrder() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const ad = useQuery({ queryKey: ['ad', id], queryFn: () => api<any>(`/p2p/ads/${id}`) });
  const [amount, setAmount] = useState('50000');
  const [agree, setAgree] = useState(false);
  const a = ad.data;
  const buying = a?.action === 'BUY';
  const usdt = useMemo(() => (a ? Number(amount || 0) / Number(a.price) : 0), [a, amount]);
  const hasBankMethod = !!user?.paymentMethods.some((p) => p.bankCode === a?.bankCode && p.status === 'ACTIVE');
  const inLimits = a ? Number(amount) >= Number(a.minAmountFiat) && Number(amount) <= Number(a.maxAmountFiat) : false;

  const create = useMutation({
    mutationFn: () => api<any>('/p2p/orders', { body: { adId: id, amountFiat: amount, agreedToRules: agree } }),
    onSuccess: (o) => nav(`/orders/${o.id}`, { replace: true }),
    onError: (e: any) => {
      if (e.code === 'BANK_METHOD_REQUIRED') {
        toast.error(e.message);
        nav('/profile/payment-methods', { state: { bankCode: e.data?.bankCode } });
      } else toast.error(e.message);
    },
  });

  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header
        title={
          a ? (
            <span className="flex items-center gap-2">
              <Avatar name={a.advertiser.name} size={30} />
              <span className="flex flex-col leading-tight">
                <span className="text-[15px] font-bold">{a.advertiser.name}</span>
                <span className="text-[11px] muted font-normal">
                  {a.advertiser.online ? <span className="text-green">Онлайн</span> : 'Не в сети'} · {a.advertiser.completionRate}% | {fmt(a.advertiser.completedOrders, 0)}
                </span>
              </span>
            </span>
          ) : (
            <Skeleton className="h-8 w-40" />
          )
        }
      />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        {a && (
          <>
            <div className="card p-4">
              <div className="text-[12px] muted">{buying ? 'Купить USDT' : 'Продать USDT'}</div>
              <div className="text-[28px] font-extrabold number-mono leading-tight">
                {fmt(a.price, 2)} <span className="text-[16px] font-bold">KGS</span>
              </div>
              <div className="text-[12px] muted mt-2">Лимит: {fmt(a.minAmountFiat, 0)} – {fmt(a.maxAmountFiat, 0)} KGS</div>
              <div className="text-[12px] muted">Способ: {a.bank?.name ?? a.bankCode}</div>
              <div className="text-[12px] muted">Регион: {REGION_MAP[a.region]?.name ?? a.region}</div>
              <div className="text-[12px] muted">Доступно: {fmt(a.availableAmount, 2)} USDT</div>
              {a.terms && <div className="text-[12px] mt-2 p-2 rounded-lg card2 muted">{a.terms}</div>}
            </div>

            <div className="text-[13px] font-semibold mt-4 mb-2">Сумма в KGS</div>
            <div className={cn('input h-[56px] flex items-center px-4', amount && !inLimits && 'border-red')}>
              <input inputMode="numeric" value={amount ? fmt(amount, 0) : ''} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, '').slice(0, 9))} placeholder="50 000" className="bg-transparent outline-none w-full text-[24px] font-bold number-mono" />
              <span className="text-[14px] muted font-semibold">KGS</span>
            </div>
            <div className="flex gap-2 mt-2">
              {[10000, 50000, 100000, 200000].map((v) => (
                <button key={v} onClick={() => setAmount(String(v))} className={cn('chip flex-1 h-9 text-[12px] font-semibold', amount === String(v) && 'chip-on')}>
                  {v / 1000}K
                </button>
              ))}
            </div>
            {amount && !inLimits && <div className="text-[12px] text-red mt-1">Сумма должна быть от {fmt(a.minAmountFiat, 0)} до {fmt(a.maxAmountFiat, 0)} KGS</div>}

            <div className="text-[13px] font-semibold mt-4 mb-2">{buying ? 'Вы получите' : 'Вы отдадите'}</div>
            <div className="card2 h-[56px] flex items-center px-4">
              <span className="text-[24px] font-bold number-mono">{fmt(usdt, 2)}</span>
              <span className="ml-2 text-[14px] muted font-semibold">USDT</span>
            </div>
            <div className="text-[12px] muted mt-2">Цена за 1 USDT: {fmt(a.price, 2)} KGS</div>

            <Button className="mt-4" disabled={!agree || !inLimits || !amount} loading={create.isPending} onClick={() => create.mutate()}>
              Создать сделку
            </Button>
            <button onClick={() => setAgree(!agree)} className="flex items-start gap-2 mt-3 text-left">
              <Check on={agree} size={22} />
              <span className="text-[12px] muted">
                Я согласен с <span className="text-green">Правилами сделки</span> и <span className="text-green">Политикой безопасности</span>
              </span>
            </button>
            <div className="warn-card p-3 mt-3 flex gap-2 text-[12px]">
              <AlertTriangle size={18} className="shrink-0" />
              <span>
                Используйте только свой счёт {a.bank?.shortName}. Сделки с третьими лицами запрещены. {buying ? 'Продавец' : 'Покупатель'} увидит ваше ФИО: <b>{user?.fullName ?? 'по KYC'}</b>.
              </span>
            </div>
            {!hasBankMethod && (
              <div className="info-card p-3 mt-3 text-[12px] flex gap-2">
                <ShieldCheck size={18} className="text-green shrink-0" />
                <span>
                  Сделка идёт только <b>{a.bank?.shortName} → {a.bank?.shortName}</b>. Для продолжения добавьте свой счёт {a.bank?.name} на своё имя — мы попросим сделать это при создании сделки.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
