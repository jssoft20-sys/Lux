import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Btn, Page, Pager, Select, Table, Tag, Toolbar } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, cn } from '@/lib/format';

export default function RiskPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [tab, setTab] = useState<'events' | 'rules'>('events');
  const [status, setStatus] = useState('PENDING');
  const [action, setAction] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const events = useQuery({ queryKey: ['risk-events', status, action, type, page], queryFn: () => api<any>(`/risk/events${qs({ status, action, type, page, limit: 40 })}`), refetchInterval: 10_000, enabled: tab === 'events' });
  const rules = useQuery({ queryKey: ['risk-rules'], queryFn: () => api<any[]>('/risk/rules'), enabled: tab === 'rules' });
  const review = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => api(`/risk/events/${id}/review`, { body: { status } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['risk-events'] }), onError: (e: any) => toast.error(e.message) });
  const updateRule = useMutation({ mutationFn: ({ code, body }: { code: string; body: any }) => api(`/risk/rules/${code}`, { method: 'PATCH', body }), onSuccess: () => { toast.success('Правило обновлено'); qc.invalidateQueries({ queryKey: ['risk-rules'] }); }, onError: (e: any) => toast.error(e.message) });
  return (
    <Page title="Risk Engine" subtitle="Скрытый score 0–100 на каждую операцию. REVIEW — на проверку, BLOCK — операция остановлена.">
      <div className="flex gap-1 border-b border-[#1f2a26] mb-3">
        {(['events', 'rules'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-2 text-[13px] font-medium border-b-2 -mb-px', tab === t ? 'border-green text-green' : 'border-transparent muted')}>{t === 'events' ? 'События' : 'Правила и веса'}</button>)}
      </div>
      {tab === 'events' && (
        <>
          <Toolbar>
            <Select value={status} onChange={setStatus} options={[['PENDING', 'Ожидают ревью'], ['CONFIRMED_FRAUD', 'Подтверждённый фрод'], ['FALSE_POSITIVE', 'Ложные'], ['NOTED', 'Отмечены'], ['', 'Все']]} />
            <Select value={action} onChange={setAction} options={[['', 'Любое решение'], ['BLOCK', 'BLOCK'], ['REVIEW', 'REVIEW'], ['ALLOW', 'ALLOW']]} />
            <Select value={type} onChange={setType} options={[['', 'Все типы'], ['LOGIN', 'LOGIN'], ['DEVICE_CHANGE', 'DEVICE_CHANGE'], ['ORDER_CREATE', 'ORDER_CREATE'], ['ORDER_RELEASE', 'ORDER_RELEASE'], ['WITHDRAWAL', 'WITHDRAWAL'], ['DEPOSIT', 'DEPOSIT'], ['KYC', 'KYC'], ['PAYMENT_METHOD', 'PAYMENT_METHOD']]} />
          </Toolbar>
          <Table head={['Время', 'Решение', 'Score', 'Тип', 'Пользователь', 'Сигналы', 'IP', 'Ревью', '']} loading={events.isLoading} empty={events.data?.items.length === 0}>
            {events.data?.items.map((e: any) => (
              <tr key={e.id}>
                <td className="muted whitespace-nowrap">{dt(e.createdAt)}</td>
                <td><Tag v={e.action} /></td>
                <td className={cn('mono font-bold', e.score >= 70 ? 'text-red' : e.score >= 40 ? 'text-yellow' : 'text-green')}>{e.score}</td>
                <td className="mono">{e.type}</td>
                <td>{e.user ? <button className="text-green" onClick={() => nav(`/users/${e.user.id}`)}>{e.user.fullName ?? e.user.phone}</button> : '—'}<div className="muted text-[11px]">{e.user?.status} · риск {e.user?.riskScore}</div></td>
                <td><div className="flex flex-wrap gap-1 max-w-[380px]">{(e.signals as any[]).map((s, i) => <span key={i} className="tag tag-gray" title={s.detail}>{s.code} +{s.weight}</span>)}</div></td>
                <td className="mono muted">{e.ip}</td>
                <td><Tag v={e.reviewStatus} /></td>
                <td>{can(admin?.role, 'RISK', 'COMPLIANCE') && e.reviewStatus === 'PENDING' && (
                  <div className="flex gap-1">
                    <Btn size="sm" variant="red" onClick={() => review.mutate({ id: e.id, status: 'CONFIRMED_FRAUD' })}>Фрод</Btn>
                    <Btn size="sm" onClick={() => review.mutate({ id: e.id, status: 'FALSE_POSITIVE' })}>Ложное</Btn>
                    <Btn size="sm" onClick={() => review.mutate({ id: e.id, status: 'NOTED' })}>OK</Btn>
                  </div>
                )}</td>
              </tr>
            ))}
          </Table>
          {events.data && <Pager page={events.data.page} pages={Math.ceil(events.data.total / events.data.limit)} total={events.data.total} onPage={setPage} />}
        </>
      )}
      {tab === 'rules' && (
        <Table head={['Код', 'Правило', 'Вес', 'Включено', 'Обновлено']} loading={rules.isLoading}>
          {rules.data?.map((r) => (
            <tr key={r.code}>
              <td className="mono">{r.code}</td>
              <td>{r.name}</td>
              <td>
                <input type="number" min={0} max={100} defaultValue={r.weight} disabled={!can(admin?.role, 'RISK')} onBlur={(e) => Number(e.target.value) !== r.weight && updateRule.mutate({ code: r.code, body: { weight: Number(e.target.value) } })} className="input w-20 mono" />
              </td>
              <td><input type="checkbox" checked={r.enabled} disabled={!can(admin?.role, 'RISK')} onChange={(e) => updateRule.mutate({ code: r.code, body: { enabled: e.target.checked } })} /></td>
              <td className="muted">{dt(r.updatedAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Page>
  );
}
