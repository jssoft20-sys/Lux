import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MessagesSquare } from 'lucide-react';
import { Avatar, Badge, Empty, Skeleton, Pressable } from '@/components/ui';
import { api } from '@/lib/api';
import { ago, fmt, STATUS_LABEL } from '@/lib/format';

export default function Chats() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['orders', 'active'], queryFn: () => api<any>('/p2p/orders?filter=active&limit=50'), refetchInterval: 15_000 });
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <div className="safe-top px-4 pb-3 text-[22px] font-extrabold">Чаты</div>
      <div className="flex-1 overflow-y-auto hide-scroll px-4 pb-28 flex flex-col gap-2">
        {q.isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[72px]" />)}
        {q.data?.items?.map((o: any) => (
          <Pressable key={o.id} onClick={() => nav(`/orders/${o.id}/chat`)} className="card p-3 flex items-center gap-3 w-full">
            <div className="relative">
              <Avatar name={o.counterparty.name} size={44} />
              {o.counterparty.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green border-2 border-[#141c19]" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[14px] truncate">{o.counterparty.name}</span>
                <span className="text-[11px] muted">{ago(o.createdAt)}</span>
              </div>
              <div className="text-[12px] muted truncate">
                Сделка #{o.number} · {fmt(o.amountUsdt, 2)} USDT · {STATUS_LABEL[o.status]}
              </div>
            </div>
            {o.unreadMessages > 0 && <Badge tone="green">{o.unreadMessages}</Badge>}
          </Pressable>
        ))}
        {q.data && q.data.items.length === 0 && <Empty icon={<MessagesSquare />} title="Нет активных чатов" text="Чат открывается автоматически при создании сделки" />}
      </div>
    </div>
  );
}
