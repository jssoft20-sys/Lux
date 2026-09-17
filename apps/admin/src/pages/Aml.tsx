import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Btn, Drawer, Json, Page, Pager, ReasonDialog, Select, Stat, Table, Tag, Toolbar, useDebounced } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, fmt } from '@/lib/format';

export default function AmlPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [status, setStatus] = useState('HELD');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<any>(null);
  const [reject, setReject] = useState(false);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['deposits', status, dq, page], queryFn: () => api<any>(`/deposits${qs({ status, q: dq, page })}`), refetchInterval: 15_000 });
  const release = useMutation({ mutationFn: (id: string) => api(`/deposits/${id}/release`, { body: { note: 'Проверено вручную' } }), onSuccess: () => { toast.success('Депозит зачислен'); qc.invalidateQueries({ queryKey: ['deposits'] }); setSel(null); }, onError: (e: any) => toast.error(e.message) });
  return (
    <Page title="AML / Депозиты" subtitle="Поступления USDT (TRC20): подтверждения, screening адреса-источника, удержания">
      <Toolbar q={q} setQ={setQ} placeholder="TX, адрес, телефон">
        <Select value={status} onChange={setStatus} options={[['HELD', 'Удержаны (требуют решения)'], ['SCREENING', 'AML-проверка'], ['CONFIRMING', 'Подтверждения'], ['DETECTED', 'Обнаружены'], ['CREDITED', 'Зачислены'], ['REJECTED', 'Отклонены'], ['', 'Все']]} />
      </Toolbar>
      <Table head={['Сумма', 'Статус', 'Риск', 'Пользователь', 'От адреса', 'Подтв.', 'TX', 'Причина', 'Время']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((d: any) => (
          <tr key={d.id} className="clickable" onClick={() => setSel(d)}>
            <td className="mono font-bold">{fmt(d.amount)} USDT</td>
            <td><Tag v={d.status} /></td>
            <td>{d.screeningRisk && <Tag className={d.screeningRisk === 'HIGH' ? 'tag-red' : d.screeningRisk === 'MEDIUM' ? 'tag-yellow' : 'tag-green'}>{d.screeningRisk}</Tag>}</td>
            <td><button className="text-green" onClick={(e) => { e.stopPropagation(); nav(`/users/${d.userId}`); }}>{d.user.fullName ?? d.user.phone}</button></td>
            <td className="mono muted">{d.fromAddress.slice(0, 14)}…</td>
            <td className="mono">{d.confirmations}/{d.requiredConfirmations}</td>
            <td className="mono muted">{d.txHash.slice(0, 12)}…</td>
            <td className="text-yellow max-w-[240px] truncate">{d.heldReason}</td>
            <td className="muted">{dt(d.createdAt)}</td>
          </tr>
        ))}
      </Table>
      {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
      <Drawer open={!!sel} onClose={() => setSel(null)} title="Депозит">
        {sel && (
          <>
            <div className="card p-3">
              <Stat l="Сумма" v={`${fmt(sel.amount)} USDT`} mono />
              <Stat l="Статус" v={<Tag v={sel.status} />} />
              <Stat l="Сеть / TX" v={`${sel.network} · ${sel.txHash}`} mono />
              <Stat l="От" v={sel.fromAddress} mono />
              <Stat l="На" v={sel.toAddress} mono />
              <Stat l="Блок / подтверждений" v={`${sel.blockNumber ?? '—'} / ${sel.confirmations}`} />
              <Stat l="Причина удержания" v={sel.heldReason ?? '—'} />
            </div>
            <div className="mt-3 text-[12px] font-semibold">Результат screening</div>
            <Json data={sel.screeningResult} />
            {can(admin?.role, 'COMPLIANCE', 'FINANCE') && ['HELD', 'SCREENING'].includes(sel.status) && (
              <div className="flex gap-2 mt-4">
                <Btn variant="green" loading={release.isPending} onClick={() => release.mutate(sel.id)}>Зачислить на баланс</Btn>
                <Btn variant="red" onClick={() => setReject(true)}>Отклонить (заморозить средства)</Btn>
                <Btn onClick={() => nav(`/blacklist?add=${sel.fromAddress}`)}>В чёрный список адрес</Btn>
              </div>
            )}
          </>
        )}
      </Drawer>
      <ReasonDialog open={reject} onClose={() => setReject(false)} title="Отклонить депозит" onConfirm={async (reason) => { await api(`/deposits/${sel.id}/reject`, { body: { reason } }); toast.success('Отклонено'); qc.invalidateQueries({ queryKey: ['deposits'] }); setSel(null); }} />
    </Page>
  );
}
