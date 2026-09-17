import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { Btn, Page, Pager, Table, Tag, Toolbar, useDebounced } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { ago, dt, cn } from '@/lib/format';

export default function DevicesPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [tab, setTab] = useState<'clusters' | 'all'>('clusters');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const clusters = useQuery({ queryKey: ['clusters'], queryFn: () => api<any>('/devices/clusters'), enabled: tab === 'clusters' });
  const list = useQuery({ queryKey: ['devices', dq, page], queryFn: () => api<any>(`/devices${qs({ q: dq, page, limit: 40 })}`), enabled: tab === 'all' });
  const block = async (id: string, blocked: boolean) => { await api(`/devices/${id}/block`, { body: { blocked } }); qc.invalidateQueries({ queryKey: ['devices'] }); qc.invalidateQueries({ queryKey: ['clusters'] }); };
  return (
    <Page title="Устройства и fingerprints" subtitle="Кластеры: одно устройство или IP на несколько аккаунтов — признак мультиаккаунтов и дропов">
      <div className="flex gap-1 border-b border-[#1f2a26] mb-3">
        {(['clusters', 'all'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-2 text-[13px] font-medium border-b-2 -mb-px', tab === t ? 'border-green text-green' : 'border-transparent muted')}>{t === 'clusters' ? 'Кластеры' : 'Все устройства'}</button>)}
      </div>
      {tab === 'clusters' && (
        <div className="grid xl:grid-cols-2 gap-3">
          <div>
            <div className="text-[13px] font-semibold mb-2">Общие устройства ({clusters.data?.devices.length ?? 0})</div>
            {clusters.data?.devices.map((c: any) => (
              <div key={c.fingerprint} className="card p-3 mb-2">
                <div className="mono text-[11px] muted">fp {c.fingerprint.slice(0, 16)}… · {c.accounts.length} аккаунтов</div>
                {c.accounts.map((a: any) => (
                  <div key={a.deviceId} className="flex items-center gap-2 text-[12px] py-1 border-b border-[#161f1b] last:border-0">
                    <Tag v={a.status} /><button className="text-green mono" onClick={() => nav(`/users/${a.id}`)}>{a.phone}</button><span className="muted flex-1 truncate">{a.fullName} · {a.model}</span><span className={cn('mono', a.riskScore >= 70 && 'text-red')}>{a.riskScore}</span><span className="muted">{ago(a.lastSeenAt)}</span>
                  </div>
                ))}
              </div>
            ))}
            {clusters.data?.devices.length === 0 && <div className="card p-4 text-[12px] muted">Кластеров нет</div>}
          </div>
          <div>
            <div className="text-[13px] font-semibold mb-2">Общие IP (≥3 аккаунтов) ({clusters.data?.ips.length ?? 0})</div>
            {clusters.data?.ips.map((c: any) => (
              <div key={c.ip} className="card p-3 mb-2">
                <div className="mono text-[11px] muted">{c.ip} · {c.accounts.length} аккаунтов</div>
                {c.accounts.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-[12px] py-1 border-b border-[#161f1b] last:border-0">
                    <Tag v={a.status} /><button className="text-green mono" onClick={() => nav(`/users/${a.id}`)}>{a.phone}</button><span className="muted flex-1 truncate">{a.fullName}</span><span className="muted">{a.hits} · {ago(a.lastSeenAt)}</span>
                  </div>
                ))}
              </div>
            ))}
            {clusters.data?.ips.length === 0 && <div className="card p-4 text-[12px] muted">Кластеров нет</div>}
          </div>
        </div>
      )}
      {tab === 'all' && (
        <>
          <Toolbar q={q} setQ={setQ} placeholder="fingerprint, модель, телефон" />
          <Table head={['Пользователь', 'Устройство', 'Fingerprint', 'IP', 'Первый вход', 'Последний', 'Флаги', '']} loading={list.isLoading} empty={list.data?.items.length === 0}>
            {list.data?.items.map((d: any) => (
              <tr key={d.id}>
                <td><button className="text-green" onClick={() => nav(`/users/${d.user.id}`)}>{d.user.fullName ?? d.user.phone}</button></td>
                <td>{d.model ?? d.platform} {d.appVersion && <span className="muted">v{d.appVersion}</span>}</td>
                <td className="mono muted">{d.fingerprint.slice(0, 14)}…</td>
                <td className="mono">{d.lastIp}</td>
                <td className="muted">{dt(d.firstSeenAt)}</td>
                <td className="muted">{ago(d.lastSeenAt)}</td>
                <td>{d.trusted && <Tag className="tag-green">доверенное</Tag>} {d.blocked && <Tag className="tag-red">заблокировано</Tag>}</td>
                <td>{can(admin?.role, 'RISK', 'COMPLIANCE') && <Btn size="sm" variant={d.blocked ? 'ghost' : 'red'} onClick={() => block(d.id, !d.blocked)}>{d.blocked ? 'Разблокировать' : 'Блокировать'}</Btn>}</td>
              </tr>
            ))}
          </Table>
          {list.data && <Pager page={list.data.page} pages={Math.ceil(list.data.total / list.data.limit)} total={list.data.total} onPage={setPage} />}
        </>
      )}
    </Page>
  );
}
