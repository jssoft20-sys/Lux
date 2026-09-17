import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs, fetchAdminFile } from '@/lib/api';
import { Btn, Drawer, Json, Page, Pager, ReasonDialog, Select, Stat, Table, Tag, Toolbar, useDebounced } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, fmt, cn } from '@/lib/format';

export function AdminImage({ id, className }: { id: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    fetchAdminFile(id).then(setSrc).catch(() => undefined);
  }, [id]);
  return src ? <img src={src} className={className} alt="" /> : <div className={cn('card2', className)} />;
}

export function OrderDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const q = useQuery({ queryKey: ['admin-order', id], enabled: !!id, queryFn: () => api<any>(`/p2p/orders/${id}`), refetchInterval: 10_000 });
  const [cancel, setCancel] = useState(false);
  const o = q.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={o ? `Сделка #${o.number}` : 'Сделка'} width={900}>
      {o && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Tag v={o.status} />
            <span className="tag tag-gray">{o.bank.shortName} → {o.bank.shortName}</span>
            <span className="mono">{fmt(o.amountUsdt)} USDT · {fmt(o.amountFiat, 0)} KGS @ {fmt(o.price)}</span>
            <span className={cn('tag', o.riskScore >= 70 ? 'tag-red' : o.riskScore >= 40 ? 'tag-yellow' : 'tag-green')}>риск {o.riskScore}</span>
            <span className="muted text-[12px] ml-auto">создана {dt(o.createdAt)} · истекает {dt(o.expiresAt)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="card p-3">
              <div className="text-[12px] font-semibold mb-1">Покупатель</div>
              <Stat l="ФИО (KYC)" v={<button className="text-green" onClick={() => nav(`/users/${o.buyerUser.id}`)}>{o.buyerUser.fullName ?? '—'}</button>} />
              <Stat l="Телефон" v={o.buyerUser.phone} mono />
              <Stat l="Статус / риск" v={<span><Tag v={o.buyerUser.status} /> {o.buyerUser.riskScore}</span>} />
              <Stat l="Платит со счёта" v={o.expected?.buyerAccountMasked ?? '—'} mono />
            </div>
            <div className="card p-3">
              <div className="text-[12px] font-semibold mb-1">Продавец</div>
              <Stat l="ФИО (KYC)" v={<button className="text-green" onClick={() => nav(`/users/${o.sellerUser.id}`)}>{o.sellerUser.fullName ?? '—'}</button>} />
              <Stat l="Телефон" v={o.sellerUser.phone} mono />
              <Stat l="Статус / риск" v={<span><Tag v={o.sellerUser.status} /> {o.sellerUser.riskScore}</span>} />
              <Stat l="Получает на" v={`${o.payment?.holderName ?? ''} · ${o.payment?.accountNumber ?? o.payment?.accountMasked ?? '—'}`} mono />
            </div>
          </div>
          {o.declaration && (
            <div className="card p-3 mt-3 text-[12px]">
              <div className="font-semibold mb-1">Декларация оплаты покупателя</div>
              <div className="flex gap-2 flex-wrap">
                <Tag className={o.declaration.ownAccountConfirmed ? 'tag-green' : 'tag-red'}>свой счёт</Tag>
                <Tag className={o.declaration.exactAmountConfirmed ? 'tag-green' : 'tag-red'}>точная сумма</Tag>
                <Tag className={o.declaration.nameAndBankConfirmed ? 'tag-green' : 'tag-red'}>ФИО и банк</Tag>
                <span className="muted">банк {o.declaration.bankCode} · {dt(o.declaration.declaredAt)} · IP {o.declaration.ip}</span>
              </div>
              {o.declaration.receiptFileId && <AdminImage id={o.declaration.receiptFileId} className="mt-2 max-h-[280px] rounded-lg" />}
            </div>
          )}
          {o.releaseConfirmation && <div className="card p-3 mt-3 text-[12px]"><b>Отпуск продавцом:</b> метод {o.releaseConfirmation.method}, OTP {o.releaseConfirmation.otp ? 'да' : 'нет'}, {dt(o.releaseConfirmation.at)}, IP {o.releaseConfirmation.ip}</div>}
          {o.dispute && (
            <div className="card p-3 mt-3 text-[12px] border-red/40">
              <div className="font-semibold text-red">Спор: {o.dispute.reason} <Tag v={o.dispute.status} /></div>
              <div className="mt-1">{o.dispute.description}</div>
              <div className="flex gap-2 mt-2 flex-wrap">{o.dispute.evidenceFileIds?.map((f: string) => <AdminImage key={f} id={f} className="h-24 rounded" />)}</div>
              <Btn size="sm" className="mt-2" onClick={() => nav(`/disputes/${o.dispute.id}`)}>Открыть арбитраж</Btn>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="card p-3">
              <div className="text-[12px] font-semibold mb-2">Системные события (неизменяемые)</div>
              {o.events.map((e: any) => (
                <div key={e.id} className="text-[12px] py-1 border-b border-[#161f1b] last:border-0 flex gap-2">
                  <span className="muted w-24 shrink-0">{dt(e.createdAt)}</span>
                  <span className={`tag ${e.actorType === 'SYSTEM' ? 'tag-gray' : e.actorType === 'ADMIN' ? 'tag-purple' : 'tag-blue'}`}>{e.actorType}</span>
                  <span className="mono">{e.type}</span>
                </div>
              ))}
            </div>
            <div className="card p-3 max-h-[420px] overflow-y-auto">
              <div className="text-[12px] font-semibold mb-2">Чат</div>
              {o.messages.map((m: any) => (
                <div key={m.id} className={cn('text-[12px] py-1.5 border-b border-[#161f1b] last:border-0', m.type === 'SYSTEM' && 'muted italic', m.flagged && 'text-red')}>
                  <span className="muted mr-2">{dt(m.createdAt)}</span>
                  {m.type !== 'SYSTEM' && <b className="mr-1">{m.senderId === o.buyerUser.id ? 'Покупатель' : 'Продавец'}:</b>}
                  {m.text} {m.fileId && <AdminImage id={m.fileId} className="h-20 rounded mt-1" />} {m.flagged && <span className="tag tag-red ml-1">{m.flagReason}</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 text-[12px] font-semibold">Risk-сигналы при создании</div>
          <Json data={o.riskSignals} />
          {can(admin?.role, 'COMPLIANCE', 'RISK', 'SUPPORT') && ['CREATED', 'PAID'].includes(o.status) && (
            <Btn variant="red" className="mt-3" onClick={() => setCancel(true)}>Отменить сделку (вернуть USDT продавцу)</Btn>
          )}
          <ReasonDialog open={cancel} onClose={() => setCancel(false)} title="Отменить сделку администратором" onConfirm={async (reason) => { await api(`/p2p/orders/${o.id}/cancel`, { body: { reason } }); toast.success('Отменено'); qc.invalidateQueries({ queryKey: ['admin-order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); }} />
        </>
      )}
    </Drawer>
  );
}

export default function OrdersPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [minRisk, setMinRisk] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['orders', status, dq, minRisk, page], queryFn: () => api<any>(`/p2p/orders${qs({ status, q: dq, minRisk, page, limit: 30 })}`), refetchInterval: 10_000 });
  return (
    <Page title="P2P сделки" subtitle="Все сделки в реальном времени: таймеры, эскроу, чат, вмешательство">
      <Toolbar q={q} setQ={setQ} placeholder="# сделки или телефон">
        <Select value={status} onChange={setStatus} options={[['', 'Все статусы'], ['CREATED,PAID,DISPUTED', 'Активные'], ['CREATED', 'Ожидают оплату'], ['PAID', 'Оплачены'], ['DISPUTED', 'В споре'], ['RELEASED,RESOLVED_RELEASE', 'Завершены'], ['CANCELLED,EXPIRED,RESOLVED_REFUND', 'Отменены']]} />
        <Select value={minRisk} onChange={setMinRisk} options={[['', 'Любой риск'], ['40', 'Риск ≥ 40'], ['70', 'Риск ≥ 70']]} />
      </Toolbar>
      <Table head={['#', 'Статус', 'USDT', 'KGS', 'Банк', 'Покупатель', 'Продавец', 'Риск', 'Спор', 'Создана']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((o: any) => (
          <tr key={o.id} className="clickable" onClick={() => nav(`/p2p/${o.id}`)}>
            <td className="mono">#{o.number}</td>
            <td><Tag v={o.status} /></td>
            <td className="mono">{fmt(o.amountUsdt)}</td>
            <td className="mono">{fmt(o.amountFiat, 0)}</td>
            <td>{o.bankCode}</td>
            <td><div>{o.buyer.fullName ?? '—'}</div><div className="mono muted text-[11px]">{o.buyer.phone}</div></td>
            <td><div>{o.seller.fullName ?? '—'}</div><div className="mono muted text-[11px]">{o.seller.phone}</div></td>
            <td><span className={cn('mono font-bold', o.riskScore >= 70 ? 'text-red' : o.riskScore >= 40 ? 'text-yellow' : 'text-green')}>{o.riskScore}</span></td>
            <td>{o.dispute && <Tag v={o.dispute.status} />}</td>
            <td className="muted">{dt(o.createdAt)}</td>
          </tr>
        ))}
      </Table>
      {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
      <OrderDrawer id={id ?? null} onClose={() => nav('/p2p')} />
    </Page>
  );
}
