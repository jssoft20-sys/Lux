import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/store/auth';
import { LogoMark } from '@/components/Logo';
import { Btn } from '@/components/ui';

export default function Login() {
  const nav = useNavigate();
  const { setAccess, setAdmin } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfa, setMfa] = useState<{ tmpToken: string; setup?: { secret: string; qrDataUrl: string } } | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function finish(r: any) {
    setAccess(r.accessToken);
    setAdmin(r.admin);
    nav('/', { replace: true });
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api<any>('/auth/login', { body: { email, password } });
      if (r.mfaRequired) setMfa({ tmpToken: r.tmpToken, setup: r.setup });
      else await finish(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  async function totp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await finish(await api<any>('/auth/totp', { body: { tmpToken: mfa!.tmpToken, code } }));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="h-full flex items-center justify-center p-6" style={{ background: 'radial-gradient(900px 500px at 50% -10%, #10261c 0%, #0a0e0d 60%)' }}>
      <div className="card w-[400px] p-7">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <div className="text-[20px] font-extrabold leading-tight">Somex Admin</div>
            <div className="text-[11px] muted uppercase tracking-widest">Control Center</div>
          </div>
        </div>
        {!mfa ? (
          <form onSubmit={login} className="mt-6 flex flex-col gap-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className="input h-11" autoFocus />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Пароль" className="input h-11" />
            <Btn variant="green" className="h-11 mt-1" loading={loading} type="submit">
              Войти
            </Btn>
            <div className="text-[11px] muted text-center">Доступ только для сотрудников. Все действия записываются в аудит.</div>
          </form>
        ) : (
          <form onSubmit={totp} className="mt-6 flex flex-col gap-3">
            {mfa.setup ? (
              <div className="card2 p-3 text-[12px]">
                <div className="font-semibold flex items-center gap-1 text-yellow">
                  <ShieldCheck size={14} /> Обязательная настройка 2FA
                </div>
                <div className="muted mt-1">Отсканируйте QR в Google Authenticator / 1Password и введите код.</div>
                <img src={mfa.setup.qrDataUrl} alt="QR" className="w-40 h-40 mx-auto my-3 rounded-lg bg-white" />
                <div className="mono text-center break-all">{mfa.setup.secret}</div>
              </div>
            ) : (
              <div className="text-[13px] muted">Введите код из приложения-аутентификатора</div>
            )}
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="123456" className="input h-11 text-center text-[20px] tracking-[0.4em] mono" autoFocus />
            <Btn variant="green" className="h-11" loading={loading} type="submit" disabled={code.length < 6}>
              Подтвердить
            </Btn>
            <button type="button" onClick={() => setMfa(null)} className="text-[12px] muted">
              Назад
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
