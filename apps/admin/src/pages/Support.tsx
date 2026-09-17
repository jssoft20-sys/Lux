import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Btn, Modal, Page, Select, Table, Tag, Toolbar } from '@/components/ui';
import { dt } from '@/lib/format';

export default function SupportPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [sel, setSel] = useState<any>(null);
  const [answer, setAnswer] = useState('');
  const list = useQuery({ queryKey: ['tickets', status], queryFn: () => api<any>(`/support${qs({ status })}`), refetchInterval: 20_000 });
  const reply = useMutation({ mutationFn: () => api(`/support/${sel.id}/answer`, { body: { answer } }), onSuccess: () => { toast.success('Ответ отправлен'); qc.invalidateQueries({ queryKey: ['tickets'] }); setSel(null); setAnswer(''); }, onError: (e: any) => toast.error(e.message) });
  return (
    <Page title="Поддержка" subtitle="Обращения пользователей из приложения">
      <Toolbar><Select value={status} onChange={setStatus} options={[['OPEN', 'Открытые'], ['ANSWERED', 'Отвечены'], ['CLOSED', 'Закрытые'], ['', 'Все']]} /></Toolbar>
      <Table head={['Тема', 'Пользователь', 'Сообщение', 'Сделка', 'Статус', 'Создано', '']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((t: any) => (
          <tr key={t.id}>
            <td className="font-semibold">{t.subject}</td>
            <td><button className="text-green" onClick={() => nav(`/users/${t.userId}`)}>{t.user.fullName ?? t.user.phone}</button></td>
            <td className="max-w-[360px] truncate muted">{t.message}</td>
            <td className="mono muted">{t.orderId ? <button className="text-green" onClick={() => nav(`/p2p/${t.orderId}`)}>{t.orderId.slice(0, 8)}</button> : '—'}</td>
            <td><Tag v={t.status} /></td>
            <td className="muted">{dt(t.createdAt)}</td>
            <td><Btn size="sm" onClick={() => { setSel(t); setAnswer(t.answer ?? ''); }}>Ответить</Btn></td>
          </tr>
        ))}
      </Table>
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.subject ?? ''}>
        <div className="card2 p-3 text-[13px] mb-3">{sel?.message}</div>
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} className="input w-full !h-auto py-2" placeholder="Ответ пользователю (придёт в приложение)" />
        <div className="flex justify-end gap-2 mt-3"><Btn onClick={() => setSel(null)}>Отмена</Btn><Btn variant="green" loading={reply.isPending} disabled={answer.length < 2} onClick={() => reply.mutate()}>Отправить</Btn></div>
      </Modal>
    </Page>
  );
}
