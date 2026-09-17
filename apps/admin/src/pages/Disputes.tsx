import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Gavel } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Btn, Drawer, Field, Page, Pager, Select, Stat, Table, Tag, Toolbar } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, fmt, cn } from '@/lib/format';
import { AdminImage } from './Orders';

export default function DisputesPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [status, setStatus] = useState('OPEN,UNDER_REVIEW');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['disputes', status, page], queryFn: () => api<any>(`/disputes${qs({ status, page })}`), refetchInterval: 15_000 });
  const detail = useQuery({ queryKey: ['dispute', id], enabled: !!id, queryFn: () => api<any>(`/disputes/${id}`) });
  const [resolution, setResolution] = useState<'RELEASE' | 'REFUND' | 'PARTIAL'>('RELEASE');
  const [note, setNote] = useState('');
  const [buyerAmount, setBuyerAmount] = useState('');
  const resolve = useMutation({ mutationFn: () => api(`/disputes/${id}/resolve`, { body: { resolution, note, buyerAmount: resolution === 'PARTIAL' ? buyerAmount : undefined } }), onSuccess: () => { toast.success('Спор решён'); qc.invalidateQueries({ queryKey: ['disputes'] }); nav('/disputes'); }, onError: (e: any) => toast.error(e.message) });
  const assign = useMutation({ mutationFn: () => api(`/disputes/${id}/assign`, { body: {} }), onSuccess: () => { toast.success('Назначено вам'); qc.invalidateQueries({ queryKey: ['dispute', id] }); qc.invalidateQueries({ queryKey: ['disputes'] }); } });
  const d = detail.data;
  const o = d?.order;
  return (
    <Page title="Споры и арбитраж" subtitle="Решение по системным событиям, чату и доказательствам. USDT остаются в эскроу до решения.">
      <Toolbar>
        <Select value={status} onChange={setStatus} options={[['OPEN,UNDER_REVIEW', 'Открытые'], ['OPEN', 'Новые'], ['UNDER_REVIEW', 'В работе'], ['RESOLVED_RELEASE,RESOLVED_REFUND,RESOLVED_PARTIAL', 'Решённые'], ['', 'Все']]} />
      </Toolbar>
      <Table head={['Сделка', 'Статус', 'Причина', 'Открыл', 'Сумма', 'Покупатель', 'Продавец', 'Открыт']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((x: any) => (
          <tr key={x.id} className="clickable" onClick={() => nav(`/disputes/${x.id}`)}>
            <td className="mono">#{x.order?.number}</td>
            <td><Tag v={x.status} /></td>
            <td>{x.reason}</td>
            <td>{x.openedBy.fullName ?? x.openedBy.phone}</td>
            <td className="mono">{fmt(x.order?.amountUsdt)} USDT / {fmt(x.order?.amountFiat, 0)} KGS</td>
            <td>{x.order?.buyer.fullName}</td>
            <td>{x.order?.seller.fullName}</td>
            <td className="muted">{dt(x.createdAt)}</td>
          </tr>
        ))}
      </Table>
      {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
      <Drawer open={!!id} onClose={() => nav('/disputes')} title={d ? `Арбитраж · сделка #${o?.number}` : 'Спор'} width={960}>
        {d && o && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Tag v={d.status} /> <span className="font-semibold">{d.reason}</span>
              <span className="muted text-[12px]">открыл {d.openedBy.fullName ?? d.openedBy.phone} · {dt(d.createdAt)}</span>
              {d.assignedToId && <span className="tag tag-purple">назначен</span>}
              {can(admin?.role, 'COMPLIANCE', 'SUPPORT') && d.status === 'OPEN' && <Btn size="sm" className="ml-auto" onClick={() => assign.mutate()}>Взять в работу</Btn>}
            </div>
            <div className="card p-3 mt-3 text-[13px]">{d.description}</div>
            {d.evidenceFileIds?.length > 0 && <div className="flex gap-2 mt-2 flex-wrap">{d.evidenceFileIds.map((f: string) => <AdminImage key={f} id={f} className="h-32 rounded-lg" />)}</div>}
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="card p-3">
                <div className="text-[12px] font-semibold mb-1">Сделка</div>
                <Stat l="USDT в эскроу" v={`${fmt(o.amountUsdt)}`} mono />
                <Stat l="KGS" v={fmt(o.amountFiat, 0)} mono />
                <Stat l="Банк" v={`${o.bank.shortName} → ${o.bank.shortName}`} />
                <Stat l="Оплата отмечена" v={dt(o.paidAt)} />
              </div>
              <div className="card p-3">
                <div className="text-[12px] font-semibold mb-1">Покупатель (должен был отправить)</div>
                <Stat l="ФИО" v={o.buyerUser.fullName} />
                <Stat l="Со счёта" v={o.expected?.buyerAccountMasked ?? '—'} mono />
                <Stat l="Риск" v={o.buyerUser.riskScore} />
                <Stat l="Декларация" v={o.declaration ? 'да' : 'нет'} />
              </div>
              <div className="card p-3">
                <div className="text-[12px] font-semibold mb-1">Продавец (должен был получить)</div>
                <Stat l="ФИО" v={o.sellerUser.fullName} />
                <Stat l="На счёт" v={o.payment?.accountNumber ?? '—'} mono />
                <Stat l="Риск" v={o.sellerUser.riskScore} />
              </div>
            </div>
            {o.declaration?.receiptFileId && (
              <div className="card p-3 mt-3">
                <div className="text-[12px] font-semibold mb-1">Чек покупателя (не является доказательством сам по себе)</div>
                <AdminImage id={o.declaration.receiptFileId} className="max-h-[360px] rounded-lg" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="card p-3">
                <div className="text-[12px] font-semibold mb-2">Хронология</div>
                {o.events.map((e: any) => (
                  <div key={e.id} className="text-[12px] py-1 border-b border-[#161f1b] last:border-0 flex gap-2"><span className="muted w-24 shrink-0">{dt(e.createdAt)}</span><span className="mono">{e.type}</span><span className="muted">{e.actorType}</span></div>
                ))}
              </div>
              <div className="card p-3 max-h-[360px] overflow-y-auto">
                <div className="text-[12px] font-semibold mb-2">Чат</div>
                {o.messages.map((m: any) => (
                  <div key={m.id} className={cn('text-[12px] py-1.5 border-b border-[#161f1b] last:border-0', m.type === 'SYSTEM' && 'muted italic', m.flagged && 'text-red')}>
                    <span className="muted mr-2">{dt(m.createdAt)}</span>
                    {m.type !== 'SYSTEM' && <b className="mr-1">{m.senderId === o.buyerUser.id ? 'Покупатель' : 'Продавец'}:</b>}
                    {m.text} {m.fileId && <AdminImage id={m.fileId} className="h-20 rounded mt-1" />}
                  </div>
                ))}
              </div>
            </div>
            {can(admin?.role, 'COMPLIANCE') && ['OPEN', 'UNDER_REVIEW'].includes(d.status) && (
              <div className="card p-4 mt-3 border-green/40">
                <div className="font-semibold flex items-center gap-2"><Gavel size={16} className="text-green" /> Решение арбитража</div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {([['RELEASE', 'USDT покупателю', 'Оплата подтверждена — продавец получил деньги'], ['REFUND', 'Вернуть продавцу', 'Оплаты не было / с чужого счёта'], ['PARTIAL', 'Частично', 'Разделить сумму']] as const).map(([v, l, s]) => (
                    <button key={v} onClick={() => setResolution(v)} className={cn('card p-3 text-left', resolution === v && 'border-green bg-green/10')}>
                      <div className="font-semibold text-[13px]">{l}</div>
                      <div className="text-[11px] muted">{s}</div>
                    </button>
                  ))}
                </div>
                {resolution === 'PARTIAL' && <Field label="USDT покупателю" className="mt-3"><input value={buyerAmount} onChange={(e) => setBuyerAmount(e.target.value)} className="input w-48 mono" /></Field>}
                <Field label="Обоснование (увидят обе стороны, попадёт в аудит)" className="mt-3"><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input w-full !h-auto py-2" /></Field>
                <Btn variant="green" className="mt-3" loading={resolve.isPending} disabled={note.trim().length < 5} onClick={() => resolve.mutate()}>Вынести решение</Btn>
              </div>
            )}
            {d.resolution && <div className="card p-3 mt-3 text-[13px]"><b>Решение:</b> {d.resolution} — {d.resolutionNote} <span className="muted">({dt(d.resolvedAt)})</span></div>}
          </>
        )}
      </Drawer>
    </Page>
  );
}
