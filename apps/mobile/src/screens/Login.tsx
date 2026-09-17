import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { LogoMark } from '@/components/Logo';
import { Button, Header } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { hapticError } from '@/lib/haptics';
import { digitsOnly, maskKgLocal, normalizeKgPhone } from '@somex/shared';

export default function Login() {
  const nav = useNavigate();
  const { setPendingPhone } = useAuth();
  const [digits, setDigits] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const phone = normalizeKgPhone(`+996${digits}`);
  useEffect(() => {
    setTimeout(() => input.current?.focus(), 80);
  }, []);

  async function submit() {
    if (!phone) {
      setShake((s) => s + 1);
      hapticError();
      toast.error('Номер Кыргызстана: 9 цифр после +996');
      return;
    }
    setLoading(true);
    try {
      const r = await api<any>('/auth/otp/request', { body: { phone } });
      setPendingPhone(phone);
      sessionStorage.setItem('somex.otp', JSON.stringify({ ...r, phone, at: Date.now() }));
      nav('/otp');
    } catch (e: any) {
      hapticError();
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full theme-light screen flex flex-col">
      <Header onBack={() => nav('/welcome')} />
      <form
        className="flex-1 flex flex-col px-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col items-center mt-2">
          <LogoMark size={66} />
          <div className="text-[30px] font-extrabold tracking-tight mt-1">Somex</div>
        </div>
        <div className="text-center mt-6">
          <div className="text-[26px] font-extrabold tracking-tight">Добро пожаловать!</div>
          <div className="text-[14px] muted mt-1">Введите номер телефона</div>
        </div>
        <motion.label key={shake} animate={shake ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.4 }} className="mt-6 input h-[58px] flex items-center px-4 gap-3 bg-white border-[#e3e8e5]">
          <span className="text-[20px] leading-none" aria-hidden>
            🇰🇬
          </span>
          <span className="text-[18px] font-semibold text-[#0b100e]">+996</span>
          <span className="w-px h-6 bg-[#e3e8e5]" />
          <input
            ref={input}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            enterKeyHint="go"
            placeholder="555 123 456"
            value={maskKgLocal(digits)}
            onChange={(e) => setDigits(digitsOnly(e.target.value).replace(/^996/, '').replace(/^0/, '').slice(0, 9))}
            className="flex-1 min-w-0 bg-transparent outline-none text-[20px] font-semibold number-mono tracking-wide text-[#0b100e] placeholder:text-[#9aa5a0] placeholder:font-medium"
          />
          {phone && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-6 h-6 rounded-full bg-green text-[#06240f] flex items-center justify-center text-[13px] font-bold">
              ✓
            </motion.span>
          )}
        </motion.label>
        <div className="text-[12px] muted mt-2 ml-1">Код подтверждения придёт в WhatsApp</div>
        <Button type="submit" className="mt-5" loading={loading} disabled={!phone}>
          Получить код
        </Button>
      </form>
    </div>
  );
}
