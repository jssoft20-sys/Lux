import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { countdown, STATUS_LABEL, STATUS_TONE, cn } from '@/lib/format';

export function Timer({ until, className }: { until: string; className?: string }) {
  const [c, setC] = useState(() => countdown(until));
  useEffect(() => {
    const t = setInterval(() => setC(countdown(until)), 1000);
    return () => clearInterval(t);
  }, [until]);
  return (
    <span className={cn('number-mono font-extrabold', c.total < 120 && 'text-red', className)}>
      {c.label}
    </span>
  );
}

export function StatusCard({ order }: { order: any }) {
  const tone = STATUS_TONE[order.status] ?? 'status-gray';
  const label = order.role === 'SELLER' && order.status === 'CREATED' ? 'Ожидание перевода' : order.role === 'SELLER' && order.status === 'PAID' ? 'Проверьте поступление' : STATUS_LABEL[order.status];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('rounded-2xl px-4 py-3 flex items-center justify-between', tone)}>
      <span className="flex items-center gap-2 font-bold text-[15px]">
        <Clock size={18} /> {label}
      </span>
      {order.status === 'CREATED' && <Timer until={order.expiresAt} className="text-[18px]" />}
    </motion.div>
  );
}

export function EscrowPill({ amount }: { amount: string }) {
  return <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-green">🔒 {Number(amount).toFixed(2)} USDT защищены</span>;
}
