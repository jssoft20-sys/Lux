import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Megaphone, Pause, Play, X } from 'lucide-react';
import { Badge, BankLogo, Button, Empty, Header } from '@/components/ui';
import { api } from '@/lib/api';
import { fmt } from '@/lib/format';

export default function MyAds() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-ads'], queryFn: () => api<any[]>('/p2p/my-ads') });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/p2p/ads/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-ads'] }),
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Мои объявления" right={<Button size="sm" onClick={() => nav('/ads/new')} className="!w-auto">+ Новое</Button>} />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll flex flex-col gap-2">
        {q.data?.map((a) => (
          <div key={a.id} className="card p-3">
            <div className="flex items-center gap-3">
              <BankLogo code={a.bankCode} logo={a.bank?.logo} color={a.bank?.color} size={36} />
              <div className="flex-1">
                <div className="font-bold text-[14px]">
                  {a.side === 'SELL' ? 'Продажа' : 'Покупка'} · {fmt(a.price, 2)} KGS
                </div>
                <div className="text-[11px] muted">
                  {a.limitsLabel} KGS · доступно {fmt(a.availableAmount, 2)} USDT · {a.completedCount} сделок
                </div>
              </div>
              <Badge tone={a.status === 'ACTIVE' ? 'green' : 'gray'}>{a.status === 'ACTIVE' ? 'Активно' : 'Пауза'}</Badge>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: a.id, status: a.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}>
                {a.status === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />} {a.status === 'ACTIVE' ? 'Пауза' : 'Включить'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => update.mutate({ id: a.id, status: 'CLOSED' })}>
                <X size={14} /> Закрыть
              </Button>
            </div>
          </div>
        ))}
        {q.data && q.data.length === 0 && <Empty icon={<Megaphone />} title="Объявлений нет" text="Разместите объявление со своим курсом" action={<Button size="md" onClick={() => nav('/ads/new')}>Создать</Button>} />}
      </div>
    </div>
  );
}
