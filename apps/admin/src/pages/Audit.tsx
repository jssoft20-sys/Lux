import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Btn, Json, Page, Pager, Table, Toolbar, useDebounced } from '@/components/ui';
import { dt } from '@/lib/format';

export default function AuditPage() {
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  const da = useDebounced(action);
  const list = useQuery({ queryKey: ['audit', dq, da, page], queryFn: () => api<any>(`/audit${qs({ q: dq, action: da, page, limit: 50 })}`), refetchInterval: 15_000 });
  const verify = useQuery({ queryKey: ['audit-verify'], queryFn: () => api<any>('/audit/verify'), refetchInterval: 60_000 });
  return (
    <Page
      title="Аудит"
      subtitle="Неизменяемый журнал всех действий администраторов и чувствительных действий пользователей. Каждая запись содержит хэш предыдущей."
      actions={
        <div className={`tag ${verify.data?.ok ? 'tag-green' : 'tag-red'}`}>
          {verify.data?.ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />} Цепочка {verify.data ? (verify.data.ok ? `целостна (${verify.data.checked})` : `НАРУШЕНА на seq ${verify.data.brokenAtSeq}`) : '…'}
        </div>
      }
    >
      <Toolbar q={q} setQ={setQ} placeholder="email админа, ID цели, действие">
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="action, напр. withdrawal." className="input w-[220px] mono" />
      </Toolbar>
      <Table head={['Seq', 'Время', 'Актор', 'Действие', 'Цель', 'IP', 'Хэш']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((a: any) => (
          <>
            <tr key={a.id} className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)}>
              <td className="mono muted">{a.seq}</td>
              <td className="muted whitespace-nowrap">{dt(a.createdAt)}</td>
              <td><span className={`tag ${a.actorType === 'ADMIN' ? 'tag-purple' : a.actorType === 'SYSTEM' ? 'tag-gray' : 'tag-blue'}`}>{a.actorType}</span> <span className="muted">{a.actorLabel ?? a.actorId?.slice(0, 8)}</span></td>
              <td className="mono">{a.action}</td>
              <td className="mono muted">{a.targetType} {a.targetId?.slice(0, 8)}</td>
              <td className="mono muted">{a.ip}</td>
              <td className="mono muted">{a.hash.slice(0, 10)}…</td>
            </tr>
            {open === a.id && (
              <tr key={`${a.id}-x`}>
                <td colSpan={7}><div className="grid grid-cols-3 gap-2"><div><div className="text-[11px] muted">before</div><Json data={a.before} /></div><div><div className="text-[11px] muted">after</div><Json data={a.after} /></div><div><div className="text-[11px] muted">meta</div><Json data={a.meta} /></div></div></td>
              </tr>
            )}
          </>
        ))}
      </Table>
      {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
    </Page>
  );
}
