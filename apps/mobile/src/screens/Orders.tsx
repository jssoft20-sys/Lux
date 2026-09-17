import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { Avatar, Badge, Empty, Skeleton, Pressable } from '@/components/ui';
import { Timer } from '@/components/OrderBits';
import { api } from '@/lib/api';
import { fmt, date, STATUS_LABEL, cn } from '@/lib/format';

export default function Orders() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const q = useQuery({ queryKey: ['orders', tab], queryFn: () => api<any>(`/p2p/orders?filter=${tab}&limit=50`), refetchInterval: 15_000 });
  const tone = (s: string) => (s === 'CREATED' ? 'yellow' : s === 'PAID' ? 'blue' : s === 'RELEASED' || s === 'RESOLVED_RELEASE' ? 'green' : s === 'DISPUTED' ? 'red' : 'gray');
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <div className="safe-top px-4 pb-3">
        <div className="text-[22px] font-extrabold">Сделки</div>
        <div className="card2 p-1 flex mt-3">
          {(['active', 'completed'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('flex-1 h-9 rounded-xl text-[13px] font-semibold', tab === t ? 'tab-active' : 'muted')}>
              {t === 'active' ? 'Активные' : 'Завершённые'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto hide-scroll px-4 pb-28 flex flex-col gap-2">
        {q.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[84px]" />)}
        {q.data?.items?.map((o: any) => (
          <Pressable key={o.id} onClick={() => nav(`/orders/${o.id}`)} className="card p-3 w-full">
            <div className="flex items-center gap-3">
              <Avatar name={o.counterparty.name} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[14px]">#{o.number}</span>
                  <Badge tone={tone(o.status)}>{STATUS_LABEL[o.status]}</Badge>
                </div>
                <div className="text-[12px] muted truncate">
                  {o.side === 'BUY' ? 'Покупка' : 'Продажа'} · {o.counterparty.name} · {o.bank.shortName}
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold number-mono text-[14px]">{fmt(o.amountUsdt, 2)} USDT</div>
                <div className="text-[11px] muted number-mono">{fmt(o.amountFiat, 0)} KGS</div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] muted">
              <span>{date(o.createdAt)}</span>
              {o.status === 'CREATED' && (
                <span>
                  Оплата до <Timer until={o.expiresAt} />
                </span>
              )}
              {o.unreadMessages > 0 && <span className="text-green font-semibold">{o.unreadMessages} новых сообщений</span>}
            </div>
          </Pressable>
        ))}
        {q.data && q.data.items.length === 0 && <Empty icon={<ReceiptText />} title={tab === 'active' ? 'Активных сделок нет' : 'Завершённых сделок нет'} text="Выберите предложение на главной, чтобы начать" />}
      </div>
    </div>
  );
}
