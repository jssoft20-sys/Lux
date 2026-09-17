import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Trash2, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Empty, Header, Pressable } from '@/components/ui';
import { api } from '@/lib/api';
import { ago, cn } from '@/lib/format';
import { haptic } from '@/lib/haptics';

function Item({ n, onOpen, onDelete }: { n: any; onOpen: () => void; onDelete: () => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -80, height: 0, marginBottom: 0 }} className="relative overflow-hidden rounded-[18px]">
      <div className="absolute inset-y-0 right-0 w-24 bg-red/80 rounded-[18px] flex items-center justify-end pr-5 text-white">
        <Trash2 size={20} />
      </div>
      <motion.div
        drag="x"
        dragConstraints={{ left: -96, right: 0 }}
        dragElastic={{ left: 0.2, right: 0 }}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          if (info.offset.x < -70 || info.velocity.x < -600) {
            haptic(12);
            onDelete();
          }
        }}
        className={cn('card p-3 relative bg-[--s-card]', !n.readAt && 'border-green/50')}
        style={{ background: 'var(--s-card)' }}
      >
        <Pressable onClick={onOpen} className="w-full" scale={0.99}>
          <div className="flex items-start gap-2">
            {!n.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-green shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={cn('text-[14px] truncate', n.readAt ? 'font-medium' : 'font-bold')}>{n.title}</span>
                <span className="text-[11px] muted shrink-0">{ago(n.createdAt)}</span>
              </div>
              <div className="text-[12px] muted mt-0.5">{n.body}</div>
            </div>
          </div>
        </Pressable>
        <button onClick={onDelete} aria-label="Удалить" className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center muted opacity-60 active:opacity-100">
          <Trash2 size={14} />
        </button>
      </motion.div>
    </motion.div>
  );
}

export default function Notifications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<any>('/me/notifications?limit=50') });
  const inv = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notif-unread'] });
  };
  const del = useMutation({
    mutationFn: (id: string) => api(`/me/notifications/${id}`, { method: 'DELETE' }),
    onMutate: (id) => qc.setQueryData(['notifications'], (old: any) => (old ? { ...old, items: old.items.filter((x: any) => x.id !== id) } : old)),
    onSuccess: inv,
    onError: (e: any) => toast.error(e.message),
  });
  const clearRead = useMutation({ mutationFn: () => api('/me/notifications?read=1', { method: 'DELETE' }), onSuccess: () => { toast.success('Прочитанные удалены'); inv(); } });
  const readAll = useMutation({ mutationFn: () => api('/me/notifications/read', { method: 'POST' }), onSuccess: inv });
  const items = q.data?.items ?? [];
  const hasUnread = items.some((n: any) => !n.readAt);
  const hasRead = items.some((n: any) => n.readAt);
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header
        title="Уведомления"
        right={
          <div className="flex items-center gap-1">
            {hasUnread && (
              <Pressable onClick={() => readAll.mutate()} className="w-9 h-9 rounded-full card flex items-center justify-center" scale={0.85} aria-label="Прочитать все">
                <CheckCheck size={16} className="text-green" />
              </Pressable>
            )}
            {hasRead && (
              <Pressable onClick={() => clearRead.mutate()} className="w-9 h-9 rounded-full card flex items-center justify-center" scale={0.85} aria-label="Удалить прочитанные">
                <Trash2 size={16} className="text-red" />
              </Pressable>
            )}
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto hide-scroll px-4 pb-8 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((n: any) => (
            <Item
              key={n.id}
              n={n}
              onDelete={() => del.mutate(n.id)}
              onOpen={() => {
                if (!n.readAt) api(`/me/notifications/${n.id}/read`, { method: 'POST' }).then(inv);
                if (n.data?.orderId) nav(`/orders/${n.data.orderId}`);
                else if (n.data?.withdrawalId || n.data?.depositId) nav('/wallet/history');
              }}
            />
          ))}
        </AnimatePresence>
        {q.data && items.length === 0 && <Empty icon={<Bell />} title="Уведомлений нет" />}
        {items.length > 0 && <div className="text-center text-[11px] muted mt-2">Свайп влево — удалить</div>}
      </div>
    </div>
  );
}
