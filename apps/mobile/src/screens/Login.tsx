import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { LogoMark } from '@/components/Logo';
import { Button, Header } from '@/components/ui';
import { Keypad } from '@/components/Keypad';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { maskKgLocal, normalizeKgPhone } from '@somex/shared';

export default function Login() {
  const nav = useNavigate();
  const { setPendingPhone } = useAuth();
  const [digits, setDigits] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(0);
  const phone = normalizeKgPhone(`+996${digits}`);

  async function submit() {
    if (!phone) {
      setShake((s) => s + 1);
      toast.error('Введите номер Кыргызстана: 9 цифр после +996');
      return;
    }
    setLoading(true);
    try {
      const r = await api<any>('/auth/otp/request', { body: { phone } });
      setPendingPhone(phone);
      sessionStorage.setItem('somex.otp', JSON.stringify({ ...r, phone, at: Date.now() }));
      nav('/otp');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full theme-light screen flex flex-col">
      <Header onBack={() => nav('/welcome')} />
      <div className="flex-1 flex flex-col px-6">
        <div className="flex flex-col items-center mt-2">
          <LogoMark size={66} />
          <div className="text-[30px] font-extrabold tracking-tight mt-1">Somex</div>
        </div>
        <div className="text-center mt-6">
          <div className="text-[26px] font-extrabold tracking-tight">Добро пожаловать!</div>
          <div className="text-[14px] muted mt-1 leading-snug">
            Введите номер телефона
            <br />и мы отправим код
          </div>
        </div>
        <motion.div key={shake} animate={shake ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.4 }} className="mt-6 input h-[56px] flex items-center px-4 gap-3 bg-white border-[#e3e8e5]">
          <span className="text-[20px] leading-none" aria-label="Кыргызстан">
            🇰🇬
          </span>
          <span className="text-[17px] font-semibold text-[#0b100e]">+996</span>
          <span className="w-px h-6 bg-[#e3e8e5]" />
          <span className={`text-[17px] font-medium number-mono tracking-wide ${digits ? 'text-[#0b100e]' : 'text-[#9aa5a0]'}`}>{digits ? maskKgLocal(digits) : '555 123 456'}</span>
          {digits.length > 0 && digits.length < 9 && <span className="ml-auto text-[11px] muted">{9 - digits.length} цифр</span>}
          {phone && <span className="ml-auto text-green text-[12px] font-semibold">✓</span>}
        </motion.div>
        <Button className="mt-4" onClick={submit} loading={loading} disabled={!phone}>
          Получить код
        </Button>
        <div className="text-center text-[13px] muted mt-3">
          Без почты. Только номер. Код придёт в <span className="font-semibold text-[#128c7e]">WhatsApp</span>.
        </div>
        <div className="mt-auto pb-5">
          <Keypad onKey={(k) => setDigits((d) => (d.length < 9 ? d + k : d))} onDelete={() => setDigits((d) => d.slice(0, -1))} />
        </div>
      </div>
    </div>
  );
}
