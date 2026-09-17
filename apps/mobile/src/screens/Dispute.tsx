import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip, ShieldAlert } from 'lucide-react';
import { Button, Header } from '@/components/ui';
import { useOrder } from '@/hooks/useOrder';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';

const REASONS = [
  ['NOT_RECEIVED', 'Деньги не поступили'],
  ['WRONG_AMOUNT', 'Пришла другая сумма'],
  ['NAME_MISMATCH', 'ФИО отправителя не совпадает'],
  ['THIRD_PARTY_PAYMENT', 'Оплата с чужого счёта'],
  ['SELLER_NOT_RELEASING', 'Продавец не отпускает USDT'],
  ['OTHER', 'Другое'],
];

export default function Dispute() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: o } = useOrder(id);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const open = useMutation({
    mutationFn: () => api(`/p2p/orders/${id}/dispute`, { body: { reason, description: text, evidenceFileIds: files } }),
    onSuccess: () => {
      toast.success('Спор открыт. Арбитраж Somex рассмотрит его');
      qc.invalidateQueries({ queryKey: ['order', id] });
      nav(`/orders/${id}/chat`, { replace: true });
    },
    onError: (e: any) => toast.error(e.message),
  });
  async function upload(f: File) {
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<any>('/files?kind=DISPUTE_EVIDENCE', { form: fd });
      setFiles((x) => [...x, r.id]);
      toast.success('Файл добавлен');
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  if (!o) return <div className="h-full theme-dark screen" />;
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Открыть спор" subtitle={`Сделка #${o.number}`} />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <div className="danger-card p-3 text-[12px] flex gap-2">
          <ShieldAlert size={18} className="text-red shrink-0" />
          <span>USDT останутся в эскроу до решения. Арбитраж смотрит системные события, чат, чеки и выписки. Ложные споры снижают рейтинг.</span>
        </div>
        <div className="text-[13px] font-semibold mt-4 mb-2">Причина</div>
        <div className="flex flex-col gap-2">
          {REASONS.filter(([code]) => (o.role === 'BUYER' ? code !== 'NOT_RECEIVED' && code !== 'NAME_MISMATCH' && code !== 'THIRD_PARTY_PAYMENT' : code !== 'SELLER_NOT_RELEASING')).map(([code, label]) => (
            <button key={code} onClick={() => setReason(code)} className={cn('card p-3 text-left text-[14px] font-medium', reason === code && 'border-green bg-green/10')}>
              {label}
            </button>
          ))}
        </div>
        <div className="text-[13px] font-semibold mt-4 mb-2">Опишите ситуацию</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="input w-full p-3 text-[14px]" placeholder="Что произошло, когда, какие суммы и имена вы видите в приложении банка" />
        <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button variant="ghost" size="md" className="mt-3 w-full" onClick={() => input.current?.click()}>
          <Paperclip size={16} /> Приложить доказательство ({files.length})
        </Button>
        <Button variant="danger" className="mt-4" disabled={!reason || text.trim().length < 10} loading={open.isPending} onClick={() => open.mutate()}>
          Открыть спор
        </Button>
      </div>
    </div>
  );
}
