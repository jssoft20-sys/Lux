import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Empty, Header } from '@/components/ui';
import { api } from '@/lib/api';
import { ago, cn } from '@/lib/format';

export default function Notifications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<any>('/me/notifications?limit=50') });
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header
        title="Уведомления"
        right={
          <button onClick={() => api('/me/notifications/read', { method: 'POST' }).then(() => { qc.invalidateQueries({ queryKey: ['notifications'] }); qc.invalidateQueries({ queryKey: ['notif-unread'] }); })} className="text-[12px] text-green font-semibold">
            Прочитать все
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto hide-scroll px-4 pb-8 flex flex-col gap-2">
        {q.data?.items?.map((n: any) => (
          <button key={n.id} onClick={() => { api(`/me/notifications/${n.id}/read`, { method: 'POST' }); if (n.data?.orderId) nav(`/orders/${n.data.orderId}`); }} className={cn('card p-3 text-left', !n.readAt && 'border-green/50')}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[14px]">{n.title}</span>
              <span className="text-[11px] muted">{ago(n.createdAt)}</span>
            </div>
            <div className="text-[12px] muted mt-0.5">{n.body}</div>
          </button>
        ))}
        {q.data && q.data.items.length === 0 && <Empty icon={<Bell />} title="Уведомлений нет" />}
      </div>
    </div>
  );
}
