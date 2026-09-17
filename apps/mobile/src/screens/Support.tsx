import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';
import { Badge, Button, Header } from '@/components/ui';
import { api } from '@/lib/api';
import { date } from '@/lib/format';

export default function Support() {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => api<any[]>('/me/support') });
  const send = useMutation({
    mutationFn: () => api('/me/support', { body: { subject, message } }),
    onSuccess: () => {
      toast.success('Обращение отправлено');
      setSubject('');
      setMessage('');
      qc.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Поддержка" subtitle="Онлайн 24/7" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <a href="https://wa.me/996555000000" target="_blank" rel="noreferrer" className="card p-3 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-[#25D366]/20 text-[#25D366] flex items-center justify-center">
            <MessageCircle size={20} />
          </span>
          <div>
            <div className="font-bold text-[14px]">WhatsApp поддержки</div>
            <div className="text-[12px] muted">Официальный канал. Сотрудники никогда не просят код или PIN.</div>
          </div>
        </a>
        <div className="text-[13px] font-semibold mt-4 mb-2">Новое обращение</div>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input w-full h-11 px-3 text-[14px]" placeholder="Тема" />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className="input w-full p-3 text-[14px] mt-2" placeholder="Опишите проблему, укажите номер сделки" />
        <Button className="mt-3" disabled={subject.length < 3 || message.length < 5} loading={send.isPending} onClick={() => send.mutate()}>
          Отправить
        </Button>
        <div className="text-[13px] font-semibold mt-5 mb-2">Мои обращения</div>
        <div className="flex flex-col gap-2">
          {q.data?.map((t) => (
            <div key={t.id} className="card p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[14px]">{t.subject}</span>
                <Badge tone={t.status === 'ANSWERED' ? 'green' : t.status === 'CLOSED' ? 'gray' : 'yellow'}>{t.status === 'OPEN' ? 'Открыто' : t.status === 'ANSWERED' ? 'Отвечено' : 'Закрыто'}</Badge>
              </div>
              <div className="text-[12px] muted mt-1">{t.message}</div>
              {t.answer && <div className="info-card p-2 mt-2 text-[12px]">Ответ: {t.answer}</div>}
              <div className="text-[11px] muted mt-1">{date(t.createdAt)}</div>
            </div>
          ))}
          {q.data && q.data.length === 0 && <div className="text-[12px] muted text-center py-4">Обращений нет</div>}
        </div>
      </div>
    </div>
  );
}
