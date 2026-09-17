import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';
import { Button, Header } from '@/components/ui';
import { Keypad } from '@/components/Keypad';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatKgPhone } from '@somex/shared';

export default function Otp() {
  const nav = useNavigate();
  const { pendingPhone, setTokens, setUser } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useState(60);
  const [meta, setMeta] = useState<any>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('somex.otp') || 'null');
    } catch {
      return null;
    }
  });
  const [err, setErr] = useState(0);

  useEffect(() => {
    if (!pendingPhone) nav('/login', { replace: true });
  }, [pendingPhone, nav]);

  useEffect(() => {
    const started = meta?.at ?? Date.now();
    const resend = meta?.resendAfterSec ?? 60;
    const t = setInterval(() => setLeft(Math.max(0, resend - Math.floor((Date.now() - started) / 1000))), 500);
    return () => clearInterval(t);
  }, [meta]);

  async function verify(c: string) {
    if (!pendingPhone) return;
    setLoading(true);
    try {
      const ua = navigator.userAgent;
      const model = /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Web';
      const r = await api<any>('/auth/otp/verify', { body: { phone: pendingPhone, code: c, device: { platform: 'web', model, appVersion: '1.0.0', name: model } } });
      setTokens(r.accessToken, r.refreshToken);
      setUser(r.user);
      sessionStorage.removeItem('somex.otp');
      if (r.isNewDevice) toast.warning('Вход с нового устройства: вывод и отпуск USDT ограничены на 24 часа');
      nav(r.user.kyc.status === 'APPROVED' ? '/' : '/kyc', { replace: true });
    } catch (e: any) {
      setErr((x) => x + 1);
      setCode('');
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (code.length === 6) verify(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function resend() {
    if (!pendingPhone || left > 0) return;
    try {
      const r = await api<any>('/auth/otp/request', { body: { phone: pendingPhone } });
      const m = { ...r, phone: pendingPhone, at: Date.now() };
      sessionStorage.setItem('somex.otp', JSON.stringify(m));
      setMeta(m);
      toast.success('Код отправлен повторно');
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="h-full theme-light screen flex flex-col">
      <Header onBack={() => nav('/login')} />
      <div className="flex-1 flex flex-col px-6">
        <div className="w-16 h-16 rounded-2xl bg-[#e7f9ef] text-[#128c7e] flex items-center justify-center mx-auto">
          <MessageCircle size={32} />
        </div>
        <div className="text-center mt-4">
          <div className="text-[24px] font-extrabold tracking-tight">Код из WhatsApp</div>
          <div className="text-[14px] muted mt-1">
            Мы отправили 6-значный код на
            <br />
            <span className="font-semibold text-[#0b100e]">{pendingPhone ? formatKgPhone(pendingPhone) : ''}</span>
          </div>
        </div>
        <motion.div key={err} animate={err ? { x: [0, -8, 8, -6, 6, 0] } : {}} className="flex justify-center gap-2.5 mt-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`w-[46px] h-[56px] rounded-xl border-2 flex items-center justify-center text-[24px] font-bold number-mono bg-white ${code.length === i ? 'border-green' : code[i] ? 'border-[#0b100e]/40' : 'border-[#e3e8e5]'}`}>
              {code[i] ?? ''}
            </div>
          ))}
        </motion.div>
        {meta?.devCode && (
          <button onClick={() => setCode(meta.devCode)} className="mt-4 mx-auto px-3 py-1.5 rounded-lg bg-[#fff3d6] text-[#6b4a00] text-[12px] font-semibold">
            DEV: код {meta.devCode} — нажмите, чтобы подставить
          </button>
        )}
        <div className="text-center text-[13px] muted mt-4">
          {left > 0 ? (
            <>
              Отправить повторно через <span className="font-semibold number-mono">{left} с</span>
            </>
          ) : (
            <button onClick={resend} className="text-green font-semibold">
              Отправить код ещё раз
            </button>
          )}
        </div>
        <div className="text-center text-[12px] muted mt-2">Никому не сообщайте код. Сотрудники Somex его не спрашивают.</div>
        <div className="mt-auto pb-5">
          <Button className="mb-3" loading={loading} disabled={code.length < 6} onClick={() => verify(code)}>
            Войти
          </Button>
          <Keypad onKey={(k) => setCode((c) => (c.length < 6 ? c + k : c))} onDelete={() => setCode((c) => c.slice(0, -1))} />
        </div>
      </div>
    </div>
  );
}
