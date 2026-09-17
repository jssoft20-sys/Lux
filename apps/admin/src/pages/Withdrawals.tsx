import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Btn, Page, Pager, ReasonDialog, Select, Table, Tag, Toolbar, useDebounced } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, fmt } from '@/lib/format';

export default function WithdrawalsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [status, setStatus] = useState('APPROVAL_REQUIRED,RISK_REVIEW');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [reject, setReject] = useState<string | null>(null);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['withdrawals', status, dq, page], queryFn: () => api<any>(`/withdrawals${qs({ status, q: dq, page })}`), refetchInterval: 10_000 });
  const inv = () => qc.invalidateQueries({ queryKey: ['withdrawals'] });
  const approve = useMutation({ mutationFn: (id: string) => api(`/withdrawals/${id}/approve`, { body: {} }), onSuccess: () => { toast.success('Одобрено — уйдёт в обработку'); inv(); }, onError: (e: any) => toast.error(e.message) });
  const retry = useMutation({ mutationFn: (id: string) => api(`/withdrawals/${id}/retry`, { body: {} }), onSuccess: () => { toast.success('Повтор поставлен'); inv(); }, onError: (e: any) => toast.error(e.message) });
  const canDecide = can(admin?.role, 'FINANCE', 'RISK', 'COMPLIANCE');
  return (
    <Page title="Выводы USDT" subtitle="Очередь одобрения, risk-review, статус трансляции в сеть">
      <Toolbar q={q} setQ={setQ} placeholder="Адрес, TX, телефон">
        <Select value={status} onChange={setStatus} options={[['APPROVAL_REQUIRED,RISK_REVIEW', 'Ждут решения'], ['RISK_REVIEW', 'Risk review'], ['APPROVED,BROADCASTING', 'В обработке'], ['SENT,CONFIRMED', 'Отправлены'], ['FAILED', 'Ошибки'], ['REJECTED,CANCELLED', 'Отклонены/отменены'], ['AWAITING_OTP', 'Ждут OTP'], ['', 'Все']]} />
      </Toolbar>
      <Table head={['Сумма', 'Статус', 'Риск', 'Пользователь', 'Адрес', 'TX', 'Создан', 'Действия']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((w: any) => (
          <tr key={w.id}>
            <td>
              <div className="mono font-bold">{fmt(w.amount)} USDT</div>
              <div className="muted text-[11px]">комиссия {fmt(w.fee)} · к отправке {fmt(w.netAmount)}</div>
            </td>
            <td><Tag v={w.status} />{w.failureReason && <div className="text-[11px] text-red max-w-[200px] truncate">{w.failureReason}</div>}</td>
            <td>
              <span className={`mono font-bold ${w.riskScore >= 70 ? 'text-red' : w.riskScore >= 40 ? 'text-yellow' : 'text-green'}`}>{w.riskScore}</span> <Tag v={w.riskAction} />
              <div className="flex flex-wrap gap-1 mt-1 max-w-[260px]">{(w.riskSignals as any[])?.map((s, i) => <span key={i} className="tag tag-gray" title={s.detail}>{s.code}</span>)}</div>
            </td>
            <td><button className="text-green" onClick={() => nav(`/users/${w.userId}`)}>{w.user.fullName ?? w.user.phone}</button><div className="muted text-[11px]">{w.user.kycLevel} · риск {w.user.riskScore}</div></td>
            <td className="mono">{w.toAddress.slice(0, 10)}…{w.toAddress.slice(-4)}</td>
            <td className="mono muted">{w.txHash ? `${w.txHash.slice(0, 10)}…` : '—'}</td>
            <td className="muted">{dt(w.createdAt)}</td>
            <td>
              <div className="flex gap-1">
                {canDecide && ['APPROVAL_REQUIRED', 'RISK_REVIEW'].includes(w.status) && (
                  <>
                    <Btn size="sm" variant="green" loading={approve.isPending} onClick={() => approve.mutate(w.id)}>Одобрить</Btn>
                    <Btn size="sm" variant="red" onClick={() => setReject(w.id)}>Отклонить</Btn>
                  </>
                )}
                {can(admin?.role, 'FINANCE') && w.status === 'FAILED' && <Btn size="sm" onClick={() => retry.mutate(w.id)}>Повторить</Btn>}
              </div>
            </td>
          </tr>
        ))}
      </Table>
      {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
      <ReasonDialog open={!!reject} onClose={() => setReject(null)} title="Отклонить вывод (средства вернутся на баланс)" onConfirm={async (reason) => { await api(`/withdrawals/${reject}/reject`, { body: { reason } }); toast.success('Отклонено'); inv(); }} />
    </Page>
  );
}
