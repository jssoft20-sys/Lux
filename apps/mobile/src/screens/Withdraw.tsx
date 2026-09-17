import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardPaste } from 'lucide-react';
import { Button, CodeInput, Header, Row, Sheet } from '@/components/ui';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { fmt, cn } from '@/lib/format';

export default function Withdraw() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState<{ id: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const stepUp = useRef<string | undefined>(undefined);
  const book = useQuery({ queryKey: ['withdraw-addresses'], queryFn: () => api<any[]>('/wallet/withdraw-addresses') });
  const validAddr = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);

  useEffect(() => {
    if (!amount || Number(amount) <= 0) return setQuote(null);
    const t = setTimeout(() => api<any>('/wallet/withdrawals/quote', { body: { network: 'TRON', amount } }).then(setQuote).catch(() => setQuote(null)), 300);
    return () => clearTimeout(t);
  }, [amount]);

  const create = useMutation({
    mutationFn: (stepUpToken?: string) => api<any>('/wallet/withdrawals', { body: { network: 'TRON', address, amount, stepUpToken }, headers: { 'X-Idempotency-Key': `${user?.id}-${address}-${amount}-${Math.floor(Date.now() / 60000)}` } }),
    onSuccess: (r) => {
      if (r.otpRequired) setOtp({ id: r.withdrawal.id, devCode: r.otp?.devCode });
      else finish(r.withdrawal.status);
    },
    onError: (e: any) => {
      if (e.code === 'STEP_UP_REQUIRED') setPinOpen(true);
      else toast.error(e.message);
    },
  });
  const confirm = useMutation({
    mutationFn: () => api<any>(`/wallet/withdrawals/${otp!.id}/confirm`, { body: { code } }),
    onSuccess: (r) => finish(r.withdrawal.status, r.message),
    onError: (e: any) => toast.error(e.message),
  });
  function finish(status: string, msg?: string) {
    qc.invalidateQueries({ queryKey: ['me'] });
    toast.success(msg ?? (status === 'APPROVED' ? 'Вывод принят в обработку' : 'Вывод создан'));
    nav('/wallet/history', { replace: true });
  }
  const [pinErr, setPinErr] = useState(0);
  async function verifyPin(p: string) {
    try {
      const r = await api<any>('/auth/pin/verify', { body: { pin: p } });
      stepUp.current = r.stepUpToken;
      setPinOpen(false);
      setPin('');
      hapticSuccess();
      create.mutate(r.stepUpToken);
    } catch (e: any) {
      setPin('');
      setPinErr((x) => x + 1);
      hapticError();
      toast.error(e.message);
    }
  }
  const available = Number(user?.balance.available ?? 0);
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Вывести USDT" subtitle="TRON (TRC20)" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <div className="text-[13px] font-semibold mb-2">Адрес получателя</div>
        <div className={cn('input h-12 flex items-center px-3 gap-2', address && !validAddr && 'border-red')}>
          <input value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="T..." className="flex-1 bg-transparent outline-none text-[16px] number-mono" />
          <button onClick={() => navigator.clipboard?.readText().then((t) => setAddress(t.trim()))} className="muted">
            <ClipboardPaste size={18} />
          </button>
        </div>
        {book.data && book.data.length > 0 && (
          <div className="flex gap-2 mt-2 overflow-x-auto hide-scroll">
            {book.data.map((a) => (
              <button key={a.id} onClick={() => setAddress(a.address)} className="chip shrink-0 px-3 h-8 text-[11px] number-mono">
                {a.label || `${a.address.slice(0, 6)}…${a.address.slice(-4)}`}
              </button>
            ))}
          </div>
        )}
        <div className="text-[13px] font-semibold mt-4 mb-2">Сумма</div>
        <div className="input h-[56px] flex items-center px-4">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="0.00" className="flex-1 bg-transparent outline-none text-[24px] font-bold number-mono" />
          <button onClick={() => setAmount(String(Math.max(0, available - Number(quote?.fee ?? 1))))} className="text-green text-[13px] font-semibold">
            MAX
          </button>
        </div>
        <div className="text-[12px] muted mt-1">Доступно: {fmt(available, 2)} USDT</div>
        {quote && (
          <div className="card p-3 mt-3">
            <Row label="Комиссия сети" value={`${fmt(quote.fee, 2)} USDT`} mono />
            <Row label="Получатель получит" value={`${fmt(quote.netAmount, 2)} USDT`} mono className="border-t line" />
            <Row label="Лимит в день" value={`${fmt(quote.usedToday, 0)} / ${fmt(quote.limits.withdrawDaily, 0)} USDT`} mono className="border-t line" />
            {quote.problems.map((p: string) => (
              <div key={p} className="text-[12px] text-red mt-1">
                • {p}
              </div>
            ))}
          </div>
        )}
        <Button className="mt-4" disabled={!validAddr || !quote?.ok} loading={create.isPending} onClick={() => (user?.security.pinSet ? setPinOpen(true) : create.mutate(undefined))}>
          Вывести {amount ? `${fmt(amount, 2)} USDT` : ''}
        </Button>
      </div>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="PIN-код">
        <div className="text-[12px] muted mb-4">Подтвердите вывод {amount ? `${fmt(amount, 2)} USDT` : ''}</div>
        <CodeInput length={4} value={pin} onChange={setPin} onComplete={verifyPin} secret error={pinErr} />
        <div className="h-24" />
      </Sheet>
      <Sheet open={!!otp} onClose={() => setOtp(null)} title="Код из WhatsApp">
        <div className="text-[12px] muted mb-4">Код подтверждения вывода отправлен в WhatsApp</div>
        <CodeInput length={6} value={code} onChange={setCode} onComplete={() => confirm.mutate()} />
        {otp?.devCode && (
          <button type="button" onClick={() => setCode(otp.devCode!)} className="mt-4 mx-auto block px-3 py-1.5 rounded-lg warn-card text-[12px] font-semibold">
            Тестовый режим — код {otp.devCode}, нажмите
          </button>
        )}
        <Button className="mt-4" disabled={code.length < 6} loading={confirm.isPending} onClick={() => confirm.mutate()}>
          Подтвердить вывод
        </Button>
      </Sheet>
    </div>
  );
}
