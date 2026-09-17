import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';
import { Button, CodeInput, Header } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { hapticError, hapticSuccess } from '@/lib/haptics';
import { formatKgPhone } from '@somex/shared';

export default function Otp() {
  const nav = useNavigate();
  const { pendingPhone, setAccess, setUser } = useAuth();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [left, setLeft] = useState(60);
  const [err, setErr] = useState(0);
  const [meta, setMeta] = useState<any>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('somex.otp') || 'null');
    } catch {
      return null;
    }
  });

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
    if (!pendingPhone || loading) return;
    setLoading(true);
    try {
      const ua = navigator.userAgent;
      const model = /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Web';
      const r = await api<any>('/auth/otp/verify', { body: { phone: pendingPhone, code: c, device: { platform: 'web', model, appVersion: '1.0.0', name: model } } });
      setAccess(r.accessToken);
      setUser(r.user);
      sessionStorage.removeItem('somex.otp');
      hapticSuccess();
      if (r.isNewDevice) toast.warning('Вход с нового устройства');
      nav(r.user.kyc.status === 'APPROVED' ? '/' : '/kyc', { replace: true });
    } catch (e: any) {
      setErr((x) => x + 1);
      setCode('');
      hapticError();
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

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
            Отправлен на <span className="font-semibold text-[#0b100e] number-mono">{pendingPhone ? formatKgPhone(pendingPhone) : ''}</span>
          </div>
        </div>
        <div className="mt-6">
          <CodeInput length={6} value={code} onChange={setCode} onComplete={verify} size="lg" light error={err} />
        </div>
        {meta?.devCode && (
          <button type="button" onClick={() => setCode(meta.devCode)} className="mt-4 mx-auto px-3 py-1.5 rounded-lg bg-[#fff3d6] text-[#6b4a00] text-[12px] font-semibold">
            {meta.testMode ? `Тестовый режим — код ${meta.devCode}, нажмите` : `DEV — код ${meta.devCode}, нажмите`}
          </button>
        )}
        <div className="text-center text-[13px] muted mt-5">
          {left > 0 ? (
            <>
              Отправить повторно через <span className="font-semibold number-mono">{left} с</span>
            </>
          ) : (
            <button type="button" onClick={resend} className="text-green font-semibold">
              Отправить код ещё раз
            </button>
          )}
        </div>
        <div className="mt-auto pb-6">
          <Button loading={loading} disabled={code.length < 6} onClick={() => verify(code)}>
            Войти
          </Button>
          <div className="text-center text-[11px] muted mt-3">Никому не сообщайте код</div>
        </div>
      </div>
    </div>
  );
}
