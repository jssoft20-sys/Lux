import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Kpi, Page, Table, Tag } from '@/components/ui';
import { dt, fmt } from '@/lib/format';

export default function EscrowPage() {
  const nav = useNavigate();
  const w = useQuery({ queryKey: ['wallet'], queryFn: () => api<any>('/wallet'), refetchInterval: 15_000 });
  const list = useQuery({ queryKey: ['orders', 'escrow'], queryFn: () => api<any>('/p2p/orders?status=CREATED,PAID,DISPUTED&limit=100'), refetchInterval: 10_000 });
  const items = list.data?.items ?? [];
  const byStatus = (s: string) => items.filter((o: any) => o.status === s).reduce((a: number, o: any) => a + Number(o.amountUsdt), 0);
  return (
    <Page title="Эскроу" subtitle="USDT, заблокированные под активные сделки. Освобождаются только продавцом или арбитражем.">
      <div className="grid md:grid-cols-4 gap-3">
        <Kpi label="Всего в эскроу" value={`${fmt(w.data?.escrowLocked)} USDT`} tone="green" />
        <Kpi label="Ожидают оплату" value={`${fmt(byStatus('CREATED'))} USDT`} sub={`${items.filter((o: any) => o.status === 'CREATED').length} сделок`} tone="yellow" />
        <Kpi label="Оплачены, ждут продавца" value={`${fmt(byStatus('PAID'))} USDT`} sub={`${items.filter((o: any) => o.status === 'PAID').length} сделок`} tone="blue" />
        <Kpi label="В споре" value={`${fmt(byStatus('DISPUTED'))} USDT`} sub={`${items.filter((o: any) => o.status === 'DISPUTED').length} сделок`} tone="red" />
      </div>
      <div className="mt-4">
        <Table head={['#', 'Статус', 'В эскроу', 'KGS', 'Продавец (владелец USDT)', 'Покупатель', 'Истекает', 'Создана']} loading={list.isLoading} empty={items.length === 0}>
          {items.map((o: any) => (
            <tr key={o.id} className="clickable" onClick={() => nav(`/p2p/${o.id}`)}>
              <td className="mono">#{o.number}</td>
              <td><Tag v={o.status} /></td>
              <td className="mono font-bold text-green">🔒 {fmt(o.amountUsdt)} USDT</td>
              <td className="mono">{fmt(o.amountFiat, 0)}</td>
              <td>{o.seller.fullName ?? o.seller.phone}</td>
              <td>{o.buyer.fullName ?? o.buyer.phone}</td>
              <td className="muted">{o.status === 'CREATED' ? dt(o.expiresAt) : '—'}</td>
              <td className="muted">{dt(o.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Page>
  );
}
