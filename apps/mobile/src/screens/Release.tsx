import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, useMotionValue, animate } from 'framer-motion';
import { toast } from 'sonner';
import { AlertTriangle, Smartphone } from 'lucide-react';
import { Button, Check, CodeInput, Header, Sheet } from '@/components/ui';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { useOrder } from '@/hooks/useOrder';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { fmt, cn } from '@/lib/format';

function HoldButton({ label, onComplete, disabled }: { label: string; onComplete: () => void; disabled?: boolean }) {
  const progress = useMotionValue(0);
  const [holding, setHolding] = useState(false);
  const anim = useRef<any>(null);
  const start = () => {
    if (disabled) return;
    setHolding(true);
    anim.current = animate(progress, 100, { duration: 1.6, ease: 'linear', onComplete: () => { setHolding(false); onComplete(); } });
  };
  const stop = () => {
    anim.current?.stop();
    setHolding(false);
    animate(progress, 0, { duration: 0.25 });
  };
  return (
    <button onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} disabled={disabled} className={cn('relative w-full h-[60px] rounded-2xl overflow-hidden font-bold text-[15px] select-none', disabled ? 'card2 muted' : 'btn-green green-glow')} style={{ touchAction: 'none' }}>
      <motion.div className="absolute inset-y-0 left-0 bg-[#06240f]/25" style={{ width: progress.get() + '%' }} />
      <motion.div className="absolute inset-y-0 left-0 bg-[#06240f]/25" style={{ width: useWidth(progress) }} />
      <span className="relative flex flex-col items-center leading-tight">
        <span className="text-[11px] font-medium opacity-80">{holding ? 'Удерживайте…' : 'Удерживайте для подтверждения'}</span>
        <span>{label}</span>
      </span>
    </button>
  );
}
function useWidth(mv: any) {
  const [w, setW] = useState('0%');
  mv.on('change', (v: number) => setW(`${v}%`));
  return w;
}

export default function Release() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: o } = useOrder(id);
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);
  const [c3, setC3] = useState(false);
  const [observed, setObserved] = useState('');
  const [nameResult, setNameResult] = useState<boolean | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [otpOpen, setOtpOpen] = useState<{ reason: string; devCode?: string } | null>(null);
  const [otp, setOtp] = useState('');
  const stepUp = useRef<string | undefined>(undefined);

  const check = useMutation({ mutationFn: () => api<any>(`/p2p/orders/${id}/check-sender`, { body: { observedName: observed } }), onSuccess: (r) => setNameResult(r.matches) });

  const release = useMutation({
    mutationFn: (extra: { stepUpToken?: string; otpCode?: string }) => api<any>(`/p2p/orders/${id}/release`, { body: { checkedBankApp: c1, senderNameMatches: c2, amountMatches: c3, ...extra } }),
    onSuccess: (r) => {
      if (r.otpRequired) {
        setOtpOpen({ reason: r.reason, devCode: r.otp?.devCode });
        return;
      }
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['me'] });
      nav(`/orders/${id}/complete`, { replace: true });
    },
    onError: (e: any) => {
      if (e.code === 'STEP_UP_REQUIRED') setPinOpen(true);
      else toast.error(e.message);
    },
  });

  const [pinErr, setPinErr] = useState(0);
  async function verifyPin(p: string) {
    try {
      const r = await api<any>('/auth/pin/verify', { body: { pin: p } });
      stepUp.current = r.stepUpToken;
      setPinOpen(false);
      setPin('');
      hapticSuccess();
      release.mutate({ stepUpToken: r.stepUpToken });
    } catch (e: any) {
      setPin('');
      setPinErr((x) => x + 1);
      hapticError();
      toast.error(e.message);
    }
  }

  function go() {
    if (user?.security.pinSet && !stepUp.current) {
      setPinOpen(true);
      return;
    }
    release.mutate({ stepUpToken: stepUp.current });
  }

  if (!o) return <div className="h-full theme-dark screen" />;
  const ready = c1 && c2 && c3 && nameResult !== false;
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title={`Сделка #${o.number}`} subtitle="Отпуск USDT из эскроу" onBack={() => nav(`/orders/${o.id}`)} />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <div className="card p-4 text-center">
          <Smartphone size={34} className="mx-auto text-green" />
          <div className="text-[22px] font-extrabold mt-2 leading-tight">Проверьте приложение банка</div>
          <div className="text-[13px] muted mt-2 leading-snug">
            Не чек. Не сообщение покупателя. Не SMS.
            <br />
            Убедитесь, что <b className="text-[--s-text]">{fmt(o.expected.amountFiat, 0)} KGS</b> действительно поступили на ваш счёт {o.expected.receiveTo}.
          </div>
        </div>

        <div className="card mt-3 divide-y line">
          {[
            { on: c1, set: setC1, l: 'Я открыл приложение банка и вижу поступление', v: `${fmt(o.expected.amountFiat, 0)} KGS` },
            { on: c2, set: setC2, l: 'Отправитель', v: o.expected.senderName },
            { on: c3, set: setC3, l: 'Ожидаемый банк', v: `${o.bank.shortName} → ${o.bank.shortName}` },
          ].map((r) => (
            <button key={r.l} onClick={() => r.set(!r.on)} className="w-full flex items-center gap-3 p-3 text-left">
              <div className="flex-1">
                <div className="text-[12px] muted">{r.l}</div>
                <div className="font-bold text-[14px]">{r.v}</div>
              </div>
              <Check on={r.on} />
            </button>
          ))}
        </div>

        <div className="card p-3 mt-3">
          <div className="text-[12px] muted">Сверка ФИО (введите имя отправителя из приложения банка)</div>
          <div className="flex gap-2 mt-2">
            <input value={observed} onChange={(e) => { setObserved(e.target.value); setNameResult(null); }} placeholder="Например: Бекжан Абдыкадыров" className="input flex-1 h-11 px-3 text-[16px]" />
            <Button size="md" variant="soft" onClick={() => check.mutate()} disabled={!observed.trim()} loading={check.isPending}>
              Сверить
            </Button>
          </div>
          {nameResult === true && <div className="text-[12px] text-green mt-2">✓ ФИО совпадает с KYC покупателя</div>}
          {nameResult === false && (
            <div className="danger-card p-3 mt-2 text-[12px]">
              <div className="font-bold text-red">ФИО отправителя не совпадает → НЕ ОТПУСКАТЬ USDT</div>
              <div className="mt-1">Даже если покупатель пишет «это карта жены/брата/друга». Откройте спор — средства останутся в эскроу.</div>
              <Button variant="danger" size="md" className="mt-2 w-full" onClick={() => nav(`/orders/${o.id}/dispute`)}>
                Открыть спор
              </Button>
            </div>
          )}
        </div>

        <div className="warn-card p-3 mt-3 text-[12px] flex gap-2">
          <AlertTriangle size={18} className="shrink-0" />
          <span>Отпуск необратим. После него USDT мгновенно зачисляются покупателю, а спор станет невозможен.</span>
        </div>

        <div className="mt-4">
          <HoldButton label={`ОТПУСТИТЬ ${fmt(o.amountUsdt, 2)} USDT`} disabled={!ready || release.isPending} onComplete={go} />
        </div>
        <Button variant="danger" className="mt-2" onClick={() => nav(`/orders/${o.id}/dispute`)}>
          Деньги не пришли / не совпадают → спор
        </Button>
      </div>

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="PIN-код">
        <div className="text-[12px] muted mb-4">Подтвердите отпуск USDT</div>
        <CodeInput length={4} value={pin} onChange={setPin} onComplete={verifyPin} secret error={pinErr} />
        <div className="h-24" />
      </Sheet>
      <Sheet open={!!otpOpen} onClose={() => setOtpOpen(null)} title="Код из WhatsApp">
        <div className="text-[12px] muted mb-4">{otpOpen?.reason}</div>
        <CodeInput length={6} value={otp} onChange={setOtp} onComplete={(v) => release.mutate({ stepUpToken: stepUp.current, otpCode: v })} />
        {otpOpen?.devCode && (
          <button type="button" onClick={() => setOtp(otpOpen.devCode!)} className="mt-4 mx-auto block px-3 py-1.5 rounded-lg warn-card text-[12px] font-semibold">
            Тестовый режим — код {otpOpen.devCode}, нажмите
          </button>
        )}
        <Button className="mt-4" disabled={otp.length < 6} loading={release.isPending} onClick={() => release.mutate({ stepUpToken: stepUp.current, otpCode: otp })}>
          Подтвердить и отпустить
        </Button>
      </Sheet>
    </div>
  );
}
