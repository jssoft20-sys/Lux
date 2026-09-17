import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Lock, Plus, Trash2 } from 'lucide-react';
import { Badge, BankLogo, Button, Header, Sheet } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useBanks } from '@/hooks/useProfile';
import { cn } from '@/lib/format';

export default function PaymentMethods() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const banks = useBanks();
  const [open, setOpen] = useState(!!(loc.state as any)?.bankCode);
  const [bank, setBank] = useState<string>((loc.state as any)?.bankCode ?? '');
  const [account, setAccount] = useState('');
  const verified = user?.kyc.status === 'APPROVED';
  const add = useMutation({
    mutationFn: () => api('/me/payment-methods', { body: { bankCode: bank, accountNumber: account } }),
    onSuccess: () => {
      toast.success('Счёт добавлен');
      qc.invalidateQueries({ queryKey: ['me'] });
      setOpen(false);
      setAccount('');
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/me/payment-methods/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (e: any) => toast.error(e.message),
  });
  const selected = banks.data?.find((b: any) => b.code === bank);
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Способы оплаты" subtitle="Только счета на ваше имя по KYC" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        {!verified && (
          <div className="warn-card p-3 text-[12px] flex gap-2">
            <AlertTriangle size={18} className="shrink-0" />
            <span>
              Сначала пройдите верификацию: ФИО владельца счёта берётся из документа.{' '}
              <button className="font-bold underline" onClick={() => nav('/kyc')}>
                Пройти KYC
              </button>
            </span>
          </div>
        )}
        <div className="flex flex-col gap-2 mt-2">
          {user?.paymentMethods.map((p) => (
            <div key={p.id} className="card p-3 flex items-center gap-3">
              <BankLogo code={p.bankCode} logo={banks.data?.find((b: any) => b.code === p.bankCode)?.logo} color={banks.data?.find((b: any) => b.code === p.bankCode)?.color} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[14px]">{p.bankName}</div>
                <div className="text-[12px] muted number-mono">{p.accountMasked}</div>
                <div className="text-[11px] muted truncate">{p.holderName}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {p.status === 'ACTIVE' ? <Badge tone="green">Активен</Badge> : p.status === 'PENDING_REVIEW' ? <Badge tone="yellow">Проверка</Badge> : <Badge tone="gray">{p.status}</Badge>}
                {!p.showsSenderName && <Badge tone="yellow">Без имени плательщика</Badge>}
                <button onClick={() => remove.mutate(p.id)} className="text-red text-[11px] flex items-center gap-1">
                  <Trash2 size={12} /> Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
        <Button variant="soft" className="mt-4" onClick={() => setOpen(true)} disabled={!verified}>
          <Plus size={18} /> Добавить счёт
        </Button>
        <div className="info-card p-3 mt-4 text-[12px]">Сделки идут по правилу «банк → тот же банк»: чтобы торговать с продавцом в Optima, у вас должен быть счёт Optima на ваше имя.</div>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Новый счёт">
        <div className="text-[13px] font-semibold mb-2">Банк</div>
        <div className="grid grid-cols-3 gap-2">
          {banks.data?.map((b: any) => (
            <button key={b.code} onClick={() => setBank(b.code)} className={cn('card p-2 flex flex-col items-center gap-1', bank === b.code && 'border-green bg-green/10')}>
              <BankLogo code={b.code} logo={b.logo} color={b.color} size={30} />
              <span className="text-[11px] font-semibold truncate w-full text-center">{b.shortName}</span>
            </button>
          ))}
        </div>
        <div className="text-[13px] font-semibold mt-4 mb-2">Владелец счёта</div>
        <div className="input h-12 px-3 flex items-center gap-2 opacity-80">
          <Lock size={14} className="muted" />
          <span className="text-[14px] font-medium">{user?.fullName}</span>
        </div>
        <div className="text-[11px] muted mt-1">ФИО из KYC — изменить нельзя. Это защита от оплат с чужих счетов.</div>
        <div className="text-[13px] font-semibold mt-4 mb-2">{selected?.accountHint ?? 'Номер счёта / карты'}</div>
        <input value={account} onChange={(e) => setAccount(e.target.value)} inputMode="numeric" className="input w-full h-12 px-3 number-mono text-[16px]" placeholder={selected?.kind === 'EWALLET' ? '+996 555 123 456' : '4169 5800 0000 1234'} />
        {selected && !selected.showsSenderName && <div className="warn-card p-3 mt-3 text-[12px]">В {selected.name} получатель не видит имя плательщика. Продавцы могут отказывать в сделках с этим способом.</div>}
        <Button className="mt-4" disabled={!bank || account.replace(/\D/g, '').length < 6} loading={add.isPending} onClick={() => add.mutate()}>
          Добавить
        </Button>
      </Sheet>
    </div>
  );
}
