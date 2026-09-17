import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Btn, Page, Pager, ReasonDialog, Select, Table, Tag, Toolbar } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, fmt } from '@/lib/format';

export default function AdsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [act, setAct] = useState<{ id: string; status: string } | null>(null);
  const list = useQuery({ queryKey: ['ads', status, page], queryFn: () => api<any>(`/p2p/ads${qs({ status, page, limit: 40 })}`), refetchInterval: 20_000 });
  return (
    <Page title="Объявления" subtitle="Модерация и приостановка объявлений">
      <Toolbar>
        <Select value={status} onChange={setStatus} options={[['ACTIVE', 'Активные'], ['PAUSED', 'На паузе'], ['CLOSED', 'Закрытые'], ['', 'Все']]} />
      </Toolbar>
      <Table head={['Сторона', 'Цена', 'Лимиты KGS', 'Доступно USDT', 'Банк', 'Регион', 'Пользователь', 'Сделок', 'Статус', 'Создано', '']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((a: any) => (
          <tr key={a.id}>
            <td><Tag className={a.side === 'SELL' ? 'tag-green' : 'tag-blue'}>{a.side === 'SELL' ? 'Продаёт' : 'Покупает'}</Tag></td>
            <td className="mono font-bold">{fmt(a.price)}</td>
            <td className="mono">{fmt(a.minAmountFiat, 0)} – {fmt(a.maxAmountFiat, 0)}</td>
            <td className="mono">{fmt(a.availableAmount)} / {fmt(a.totalAmount)}</td>
            <td>{a.bankCode}</td>
            <td>{a.region}</td>
            <td><button className="text-green" onClick={() => nav(`/users/${a.userId}`)}>{a.user.nickname ?? a.user.fullName ?? a.user.phone}</button></td>
            <td>{a.completedCount}</td>
            <td><Tag v={a.status} /></td>
            <td className="muted">{dt(a.createdAt)}</td>
            <td>
              {can(admin?.role, 'COMPLIANCE', 'RISK', 'SUPPORT') && a.status !== 'CLOSED' && (
                <div className="flex gap-1">
                  <Btn size="sm" variant={a.status === 'ACTIVE' ? 'yellow' : 'green'} onClick={() => setAct({ id: a.id, status: a.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}>{a.status === 'ACTIVE' ? 'Пауза' : 'Включить'}</Btn>
                  <Btn size="sm" variant="red" onClick={() => setAct({ id: a.id, status: 'CLOSED' })}>Закрыть</Btn>
                </div>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
      <ReasonDialog open={!!act} onClose={() => setAct(null)} title={`Объявление → ${act?.status}`} variant={act?.status === 'ACTIVE' ? 'green' : 'red'} onConfirm={async (reason) => { await api(`/p2p/ads/${act!.id}/status`, { body: { status: act!.status, reason } }); toast.success('Готово'); qc.invalidateQueries({ queryKey: ['ads'] }); }} />
    </Page>
  );
}
