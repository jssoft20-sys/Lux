import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Btn, Drawer, Json, Page, Pager, ReasonDialog, Select, Stat, Table, Tag, Toolbar, useDebounced } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt } from '@/lib/format';

export default function KycPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [status, setStatus] = useState('IN_REVIEW');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [reject, setReject] = useState(false);
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['kyc', status, dq, page], queryFn: () => api<any>(`/kyc${qs({ status, q: dq, page })}`), refetchInterval: 20_000 });
  const detail = useQuery({ queryKey: ['kyc-detail', sel], enabled: !!sel, queryFn: () => api<any>(`/kyc/${sel}`) });
  const approve = useMutation({ mutationFn: (level: string) => api(`/kyc/${sel}/approve`, { body: { level } }), onSuccess: () => { toast.success('KYC одобрен'); qc.invalidateQueries({ queryKey: ['kyc'] }); setSel(null); }, onError: (e: any) => toast.error(e.message) });
  const d = detail.data;
  return (
    <Page title="KYC — верификация" subtitle="Очередь ручной проверки: дубликаты документов, страна, возраст, AML-совпадения">
      <Toolbar q={q} setQ={setQ} placeholder="Телефон или ФИО">
        <Select value={status} onChange={setStatus} options={[['IN_REVIEW', 'На проверке'], ['IN_PROGRESS', 'В процессе'], ['APPROVED', 'Одобрены'], ['DECLINED', 'Отклонены'], ['', 'Все']]} />
      </Toolbar>
      <Table head={['Пользователь', 'Статус', 'Провайдер', 'ФИО по документу', 'Документ', 'Face/Live', 'Замечания', 'Создана']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((k: any) => (
          <tr key={k.id} className="clickable" onClick={() => setSel(k.id)}>
            <td>
              <div className="font-semibold">{k.user.fullName ?? '—'}</div>
              <div className="mono muted">{k.user.phone}</div>
            </td>
            <td><Tag v={k.status} /></td>
            <td className="muted">{k.provider}</td>
            <td>{k.fullName ?? '—'}</td>
            <td className="mono">{k.documentType ?? ''} {k.documentNumberMasked ?? ''} {k.documentCountry ?? ''}</td>
            <td className="mono">{k.faceMatchScore ?? '—'} / {k.livenessScore ?? '—'}</td>
            <td className="text-yellow max-w-[260px] truncate">{k.reviewNote ?? k.declineReason ?? ''}</td>
            <td className="muted">{dt(k.createdAt)}</td>
          </tr>
        ))}
      </Table>
      {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
      <Drawer open={!!sel} onClose={() => setSel(null)} title="Проверка KYC">
        {d && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3">
                <Stat l="Статус" v={<Tag v={d.status} />} />
                <Stat l="Пользователь" v={<button className="text-green" onClick={() => nav(`/users/${d.user.id}`)}>{d.user.phone}</button>} />
                <Stat l="Риск пользователя" v={d.user.riskScore} />
                <Stat l="Аккаунт создан" v={dt(d.user.createdAt)} />
              </div>
              <div className="card p-3">
                <Stat l="ФИО" v={d.fullName ?? '—'} />
                <Stat l="Дата рождения" v={d.dateOfBirth ? new Date(d.dateOfBirth).toLocaleDateString('ru-RU') : '—'} />
                <Stat l="Документ" v={`${d.documentType ?? ''} ${d.documentNumberMasked ?? ''} (${d.documentCountry ?? '—'})`} />
                <Stat l="Face match / Liveness" v={`${d.faceMatchScore ?? '—'} / ${d.livenessScore ?? '—'}`} />
                <Stat l="AML hits" v={d.amlHits} />
              </div>
            </div>
            {d.reviewNote && <div className="card p-3 mt-3 text-[12px] text-yellow">Замечания системы: {d.reviewNote}</div>}
            {d.duplicates?.length > 0 && (
              <div className="card p-3 mt-3 text-[12px]">
                <div className="font-semibold text-red">Документ уже использован:</div>
                {d.duplicates.map((x: any) => (
                  <button key={x.id} onClick={() => nav(`/users/${x.id}`)} className="block text-green mono mt-1">{x.phone} · {x.status}</button>
                ))}
              </div>
            )}
            <div className="mt-3 text-[12px] font-semibold">Ответ провайдера</div>
            <Json data={d.rawResult} />
            {can(admin?.role, 'COMPLIANCE') && ['IN_REVIEW', 'IN_PROGRESS', 'DECLINED'].includes(d.status) && (
              <div className="flex gap-2 mt-4">
                <Btn variant="green" loading={approve.isPending} onClick={() => approve.mutate('VERIFIED')}>Одобрить · VERIFIED</Btn>
                <Btn variant="green" onClick={() => approve.mutate('ADVANCED')}>Одобрить · ADVANCED</Btn>
                <Btn variant="red" onClick={() => setReject(true)}>Отклонить</Btn>
              </div>
            )}
          </>
        )}
      </Drawer>
      <ReasonDialog open={reject} onClose={() => setReject(false)} title="Отклонить KYC" label="Причина (увидит пользователь)" onConfirm={async (reason) => { await api(`/kyc/${sel}/reject`, { body: { reason } }); toast.success('Отклонено'); qc.invalidateQueries({ queryKey: ['kyc'] }); setSel(null); }} />
    </Page>
  );
}
