import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Zap, ShieldCheck, Lock, MapPin } from 'lucide-react';
import { MountainScene } from '@/components/MountainScene';
import { LogoMark } from '@/components/Logo';
import { Button } from '@/components/ui';
import { useAuth } from '@/store/auth';

const points = [
  { icon: Zap, text: 'Быстрые сделки' },
  { icon: ShieldCheck, text: 'Проверенные пользователи' },
  { icon: Lock, text: 'Безопасно и прозрачно' },
  { icon: MapPin, text: 'Для Кыргызстана' },
];

export default function Welcome() {
  const nav = useNavigate();
  const { setOnboarded } = useAuth();
  return (
    <div className="relative h-full theme-dark screen">
      <MountainScene />
      <div className="relative z-10 h-full flex flex-col px-6 safe-top pb-6">
        <div className="flex justify-center mt-4">
          <span className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-white/10 border border-white/15 text-white/90 backdrop-blur">USDT P2P</span>
        </div>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex flex-col items-center mt-6">
          <div className="float">
            <LogoMark size={92} />
          </div>
          <div className="text-[44px] font-extrabold tracking-tight mt-2 leading-none">Somex</div>
          <div className="text-[15px] text-white/75 mt-2">Люди. Деньги. Возможности.</div>
        </motion.div>
        <div className="mt-8 flex flex-col gap-3">
          {points.map((p, i) => (
            <motion.div key={p.text} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.08 }} className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-green/20 border border-green/50 flex items-center justify-center text-green">
                <p.icon size={14} />
              </span>
              <span className="text-[14px] font-medium text-white/90">{p.text}</span>
            </motion.div>
          ))}
        </div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="mt-auto">
          <div className="font-hand text-[30px] text-white/90 -rotate-3 mb-8 ml-1" style={{ textShadow: '0 2px 12px rgba(0,0,0,.6)' }}>
            Бирге күчтүүбүз!
          </div>
          <Button
            onClick={() => {
              setOnboarded();
              nav('/login');
            }}
          >
            Начать
          </Button>
          <button onClick={() => nav('/login')} className="w-full text-center text-[13px] text-white/70 mt-4">
            Уже есть аккаунт? <span className="text-green font-semibold">Войти</span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
