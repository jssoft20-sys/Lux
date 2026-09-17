import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { Star, Check as CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui';
import { useOrder } from '@/hooks/useOrder';
import { api } from '@/lib/api';
import { fmt, cn } from '@/lib/format';

export default function OrderComplete() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: o } = useOrder(id);
  const [stars, setStars] = useState(0);
  const [rated, setRated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => confetti({ particleCount: 90, spread: 70, origin: { y: 0.35 }, colors: ['#22c55e', '#4ade80', '#facc15', '#ffffff'] }), 300);
    return () => clearTimeout(t);
  }, []);
  const rate = useMutation({
    mutationFn: (s: number) => api(`/p2p/orders/${id}/rate`, { body: { stars: s } }),
    onSuccess: () => {
      setRated(true);
      toast.success('Спасибо за оценку!');
    },
    onError: (e: any) => toast.error(e.message),
  });
  if (!o) return <div className="h-full theme-dark screen" />;
  const buyer = o.role === 'BUYER';
  const refund = o.status === 'RESOLVED_REFUND';
  return (
    <div className="h-full theme-dark screen flex flex-col px-5 safe-top pb-8">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="relative w-[120px] h-[120px] rounded-full bg-green/20 flex items-center justify-center pulse-ring">
          <div className="w-[92px] h-[92px] rounded-full btn-green green-glow flex items-center justify-center">
            <CheckIcon size={48} strokeWidth={3.5} />
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="text-[26px] font-extrabold mt-6">{refund ? 'Спор решён' : 'Сделка завершена!'}</div>
          <div className="text-[14px] muted mt-1">{refund ? 'USDT возвращены продавцу' : buyer ? 'Вы получили' : 'Вы продали'}</div>
          <div className="text-[34px] font-extrabold number-mono mt-1">
            {fmt(buyer ? o.buyerReceives : o.amountUsdt, 2)} <span className="text-[20px]">USDT</span>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="card p-3 mt-6 text-[12px] muted text-left w-full">
          {buyer ? 'Продавец подтвердил получение денег. USDT переведены на ваш баланс.' : `Покупатель получил USDT. ${fmt(o.amountFiat, 0)} KGS остаются на вашем счёте в ${o.bank.shortName}.`}
        </motion.div>
      </div>
      <Button onClick={() => nav('/', { replace: true })}>Отлично!</Button>
      {o.permissions.canRate && (
        <div className="card p-4 mt-3 text-center">
          <div className="text-[13px] font-semibold">Оцените {buyer ? 'продавца' : 'покупателя'}</div>
          <div className="flex justify-center gap-2 mt-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <motion.button key={s} whileTap={{ scale: 1.3 }} disabled={rated} onClick={() => { setStars(s); rate.mutate(s); }}>
                <Star size={30} className={cn(s <= stars ? 'text-yellow' : 'text-[#3a4741]')} fill={s <= stars ? '#f5b935' : 'none'} />
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
