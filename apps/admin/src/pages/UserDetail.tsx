import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Link2, Lock, ShieldOff, Snowflake, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { Btn, Field, Json, Modal, Page, ReasonDialog, Stat, Table, Tag } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { ago, dt, fmt, cn } from '@/lib/format';

export default function UserDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const q = useQuery({ queryKey: ['user', id], queryFn: () => api<any>(`/users/${id}`), refetchInterval: 20_000 });
  const [dialog, setDialog] = useState<null | 'freeze' | 'ban' | 'restrict' | 'unfreeze' | 'adjust' | 'flags'>(null);
  const [tab, setTab] = useState<'overview' | 'orders' | 'money' | 'risk' | 'devices' | 'kyc' | 'ledger'>('overview');
  const [delta, setDelta] = useState('');
  const [flags, setFlags] = useState<{ kycLevel?: string; withdrawalsFrozen?: boolean; tradingFrozen?: boolean }>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['user', id] });
  const act = useMutation({ mutationFn: ({ path, body }: { path: string; body?: unknown }) => api(`/users/${id}/${path}`, { body: body ?? {} }), onSuccess: () => { toast.success('Готово'); refresh(); }, onError: (e: any) => toast.error(e.message) });
  const u = q.data;
  if (!u) return <Page title="Пользователь">Загрузка…</Page>;
  const risky = u.riskScore >= 70;
  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          {u.fullName ?? u.nickname ?? u.phone} <Tag v={u.status} /> <Tag v={u.kycLevel} />
          {risky && (
            <span className="tag tag-red">
              <AlertTriangle size={12} /> риск {u.riskScore}
            </span>
          )}
        </span>
      }
      subtitle={
        <span className="mono">
          {u.phone} · id {u.id} · создан {dt(u.createdAt)} · последний вход {ago(u.lastLoginAt)} с {u.lastIp ?? '—'}
        </span>
      }
      actions={
        <>
          {can(admin?.role, 'COMPLIANCE', 'RISK', 'SUPPORT') && u.status !== 'FROZEN' && (
            <Btn variant="yellow" onClick={() => setDialog('freeze')}>
              <Snowflake size={14} /> Заморозить
            </Btn>
          )}
          {can(admin?.role, 'COMPLIANCE', 'RISK') && u.status !== 'ACTIVE' && (
            <Btn variant="green" onClick={() => setDialog('unfreeze')}>
              <Unlock size={14} /> Разморозить
            </Btn>
          )}
          {can(admin?.role, 'COMPLIANCE', 'RISK') && u.status !== 'BANNED' && (
            <Btn variant="red" onClick={() => setDialog('ban')}>
              <ShieldOff size={14} /> Забанить
            </Btn>
          )}
          {can(admin?.role, 'COMPLIANCE', 'RISK') && (
            <Btn onClick={() => { setFlags({ kycLevel: u.kycLevel, withdrawalsFrozen: u.withdrawalsFrozen, tradingFrozen: u.tradingFrozen }); setDialog('flags'); }}>
              <Lock size={14} /> Лимиты и флаги
            </Btn>
          )}
          {can(admin?.role, 'COMPLIANCE', 'RISK', 'SUPPORT') && <Btn onClick={() => act.mutate({ path: 'force-logout' })}>Завершить сессии</Btn>}
          {can(admin?.role, 'COMPLIANCE', 'RISK', 'SUPPORT') && u.sensitiveOpsLockedUntil && new Date(u.sensitiveOpsLockedUntil) > new Date() && <Btn variant="yellow" onClick={() => act.mutate({ path: 'clear-cooldown' })}>Снять ограничение (cooldown)</Btn>}
          {can(admin?.role, 'FINANCE') && <Btn onClick={() => setDialog('adjust')}>Корректировка баланса</Btn>}
        </>
      }
    >
      <div className="grid xl:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-[12px] font-semibold mb-1">Баланс</div>
          <Stat l="Доступно" v={`${fmt(u.balance?.available)} USDT`} mono />
          <Stat l="В эскроу / резерве" v={`${fmt(u.balance?.locked)} USDT`} mono />
          <Stat l="Сделок завершено" v={u.completedOrders} />
          <Stat l="Споров проиграно" v={u.disputesLost} />
          <Stat l="Рейтинг" v={u.ratingCount ? `${(u.ratingSum / u.ratingCount).toFixed(2)} (${u.ratingCount})` : '—'} />
        </div>
        <div className="card p-4">
          <div className="text-[12px] font-semibold mb-1">Безопасность</div>
          <Stat l="Устройств" v={u.devices.length} />
          <Stat l="Сессий активно" v={u.sessions.length} />
          <Stat l="PIN" v={u.pinSet ? 'установлен' : 'нет'} />
          <Stat l="Cooldown до" v={u.sensitiveOpsLockedUntil && new Date(u.sensitiveOpsLockedUntil) > new Date() ? dt(u.sensitiveOpsLockedUntil) : '—'} />
          <Stat l="Флаги" v={<span>{u.withdrawalsFrozen && <Tag className="tag-red">выводы ⛔</Tag>} {u.tradingFrozen && <Tag className="tag-red">торговля ⛔</Tag>} {!u.withdrawalsFrozen && !u.tradingFrozen && '—'}</span>} />
        </div>
        <div className="card p-4">
          <div className="text-[12px] font-semibold mb-1">KYC</div>
          <Stat l="Статус" v={<Tag v={u.kycStatus} />} />
          <Stat l="ФИО" v={u.fullName ?? '—'} />
          <Stat l="Дата рождения" v={u.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString('ru-RU') : '—'} />
          <Stat l="Документ" v={u.kycVerifications[0]?.documentNumberMasked ?? '—'} mono />
          <Stat l="Страна" v={u.documentCountry ?? '—'} />
        </div>
        <div className="card p-4">
          <div className="text-[12px] font-semibold mb-1 flex items-center gap-1">
            <Link2 size={12} /> Связанные аккаунты ({u.linkedAccounts.length})
          </div>
          {u.linkedAccounts.length === 0 && <div className="text-[12px] muted">Не обнаружены</div>}
          {u.linkedAccounts.slice(0, 6).map((l: any) => (
            <button key={l.id} onClick={() => nav(`/users/${l.id}`)} className="w-full text-left py-1.5 text-[12px] flex items-center gap-2 border-b border-[#161f1b] last:border-0">
              <Tag v={l.status} />
              <span className="mono">{l.phone}</span>
              <span className="muted flex-1 truncate">{l.reasons.join(', ')}</span>
              <span className={cn('mono', l.riskScore >= 70 && 'text-red')}>{l.riskScore}</span>
            </button>
          ))}
        </div>
      </div>
      {u.adminNote && <div className="card p-3 mt-3 text-[12px]"><b>Заметка:</b> {u.adminNote}</div>}

      <div className="flex gap-1 mt-4 border-b border-[#1f2a26]">
        {(['overview', 'orders', 'money', 'risk', 'devices', 'kyc', 'ledger'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('px-3 py-2 text-[13px] font-medium border-b-2 -mb-px', tab === t ? 'border-green text-green' : 'border-transparent muted')}>
            {{ overview: 'Обзор', orders: `Сделки (${u.orders.length})`, money: `Депозиты/выводы`, risk: `Risk (${u.riskEvents.length})`, devices: `Устройства`, kyc: 'KYC', ledger: 'Леджер' }[t]}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {tab === 'overview' && (
          <div className="grid xl:grid-cols-2 gap-3">
            <div className="card p-4">
              <div className="text-[12px] font-semibold mb-2">Способы оплаты</div>
              {u.paymentMethods.map((p: any) => (
                <div key={p.id} className="flex items-center gap-3 py-1.5 text-[12px] border-b border-[#161f1b] last:border-0">
                  <span className="font-semibold w-20">{p.bankCode}</span>
                  <span className="mono">{p.accountMasked}</span>
                  <span className="muted flex-1 truncate">{p.holderName}</span>
                  <Tag v={p.status} /> {!p.nameMatchesKyc && <Tag className="tag-red">ФИО ≠ KYC</Tag>}
                </div>
              ))}
              {u.paymentMethods.length === 0 && <div className="text-[12px] muted">Нет</div>}
            </div>
            <div className="card p-4">
              <div className="text-[12px] font-semibold mb-2">IP-адреса (30 дней)</div>
              {u.ips.map((ip: any) => (
                <div key={ip.id} className="flex items-center gap-3 py-1 text-[12px] border-b border-[#161f1b] last:border-0">
                  <span className="mono">{ip.ip}</span>
                  <span className="muted">{ip.country ?? '—'}</span>
                  {ip.isProxy && <Tag className="tag-red">VPN/Proxy</Tag>}
                  <span className="muted ml-auto">{ip.hits} · {ago(ip.lastSeenAt)}</span>
                </div>
              ))}
            </div>
            <div className="card p-4 xl:col-span-2">
              <div className="text-[12px] font-semibold mb-2">Споры</div>
              {u.disputes.length === 0 && <div className="text-[12px] muted">Нет</div>}
              {u.disputes.map((d: any) => (
                <button key={d.id} onClick={() => nav(`/disputes/${d.id}`)} className="w-full text-left flex items-center gap-3 py-1.5 text-[12px] border-b border-[#161f1b] last:border-0">
                  <Tag v={d.status} /> <span>{d.reason}</span> <span className="muted flex-1 truncate">{d.description}</span> <span className="muted">{dt(d.createdAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === 'orders' && (
          <Table head={['#', 'Роль', 'Статус', 'USDT', 'KGS', 'Банк', 'Риск', 'Создана']} empty={u.orders.length === 0}>
            {u.orders.map((o: any) => (
              <tr key={o.id} className="clickable" onClick={() => nav(`/p2p/${o.id}`)}>
                <td className="mono">#{o.number}</td>
                <td>{o.role === 'BUYER' ? 'Покупатель' : 'Продавец'}</td>
                <td><Tag v={o.status} /></td>
                <td className="mono">{fmt(o.amountUsdt)}</td>
                <td className="mono">{fmt(o.amountFiat, 0)}</td>
                <td>{o.bankCode}</td>
                <td className="mono">{o.riskScore}</td>
                <td className="muted">{dt(o.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
        {tab === 'money' && (
          <div className="grid xl:grid-cols-2 gap-3">
            <Table head={['Депозит', 'Статус', 'От', 'TX']} empty={u.deposits.length === 0}>
              {u.deposits.map((d: any) => (
                <tr key={d.id}>
                  <td className="mono">{fmt(d.amount)} USDT</td>
                  <td><Tag v={d.status} /> {d.screeningRisk && <Tag className={d.screeningRisk === 'HIGH' ? 'tag-red' : d.screeningRisk === 'MEDIUM' ? 'tag-yellow' : 'tag-green'}>{d.screeningRisk}</Tag>}</td>
                  <td className="mono muted">{d.fromAddress.slice(0, 10)}…</td>
                  <td className="mono muted">{d.txHash.slice(0, 12)}…</td>
                </tr>
              ))}
            </Table>
            <Table head={['Вывод', 'Статус', 'Адрес', 'Риск']} empty={u.withdrawals.length === 0}>
              {u.withdrawals.map((w: any) => (
                <tr key={w.id}>
                  <td className="mono">{fmt(w.amount)} USDT</td>
                  <td><Tag v={w.status} /></td>
                  <td className="mono muted">{w.toAddress.slice(0, 10)}…</td>
                  <td className="mono">{w.riskScore} <Tag v={w.riskAction} /></td>
                </tr>
              ))}
            </Table>
          </div>
        )}
        {tab === 'risk' && (
          <div className="flex flex-col gap-2">
            {u.riskEvents.map((e: any) => (
              <div key={e.id} className="card p-3 text-[12px]">
                <div className="flex items-center gap-2">
                  <Tag v={e.action} /> <span className="mono font-bold">{e.score}</span> <span className="muted">{e.type}</span> <Tag v={e.reviewStatus} /> <span className="muted ml-auto">{dt(e.createdAt)} · {e.ip}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(e.signals as any[]).map((s, i) => (
                    <span key={i} className="tag tag-gray" title={s.detail}>
                      {s.code} +{s.weight}
                      {s.detail ? ` · ${s.detail}` : ''}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {u.riskEvents.length === 0 && <div className="text-[12px] muted">Событий нет</div>}
          </div>
        )}
        {tab === 'devices' && (
          <div className="grid xl:grid-cols-2 gap-3">
            <Table head={['Устройство', 'Fingerprint', 'IP', 'Активность', '']} empty={u.devices.length === 0}>
              {u.devices.map((d: any) => (
                <tr key={d.id}>
                  <td>{d.model ?? d.platform ?? '—'} {d.trusted && <Tag className="tag-green">доверенное</Tag>} {d.blocked && <Tag className="tag-red">заблокировано</Tag>}</td>
                  <td className="mono muted">{d.fingerprint.slice(0, 12)}…</td>
                  <td className="mono">{d.lastIp}</td>
                  <td className="muted">{ago(d.lastSeenAt)}</td>
                  <td>{can(admin?.role, 'RISK', 'COMPLIANCE') && <Btn size="sm" variant={d.blocked ? 'ghost' : 'red'} onClick={() => api(`/devices/${d.id}/block`, { body: { blocked: !d.blocked } }).then(refresh)}>{d.blocked ? 'Разблокировать' : 'Блокировать'}</Btn>}</td>
                </tr>
              ))}
            </Table>
            <Table head={['Сессия', 'IP', 'UA', 'Последняя активность']} empty={u.sessions.length === 0}>
              {u.sessions.map((s: any) => (
                <tr key={s.id}>
                  <td className="mono muted">{s.id.slice(0, 8)}</td>
                  <td className="mono">{s.ip}</td>
                  <td className="muted truncate max-w-[200px]">{s.userAgent}</td>
                  <td className="muted">{ago(s.lastUsedAt)}</td>
                </tr>
              ))}
            </Table>
            {can(admin?.role, 'COMPLIANCE', 'RISK', 'SUPPORT') && <Btn variant="red" onClick={() => act.mutate({ path: 'reset-devices' })}>Сбросить все устройства</Btn>}
          </div>
        )}
        {tab === 'kyc' && (
          <div className="flex flex-col gap-2">
            {u.kycVerifications.map((k: any) => (
              <div key={k.id} className="card p-3 text-[12px]">
                <div className="flex items-center gap-2">
                  <Tag v={k.status} /> <span className="muted">{k.provider}</span> <span className="muted ml-auto">{dt(k.createdAt)}</span>
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 mt-2">
                  <Stat l="ФИО" v={k.fullName ?? '—'} />
                  <Stat l="Документ" v={`${k.documentType ?? '—'} ${k.documentNumberMasked ?? ''}`} />
                  <Stat l="Face match" v={k.faceMatchScore ?? '—'} />
                  <Stat l="Liveness" v={k.livenessScore ?? '—'} />
                </div>
                {k.reviewNote && <div className="mt-2 text-yellow">{k.reviewNote}</div>}
                {k.declineReason && <div className="mt-2 text-red">{k.declineReason}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === 'ledger' && (
          <Table head={['Дата', 'Счёт', 'Δ', 'Тип', 'Ref', 'Memo']} empty={u.ledger.length === 0}>
            {u.ledger.map((l: any) => (
              <tr key={l.id}>
                <td className="muted">{dt(l.createdAt)}</td>
                <td className="mono">{l.account}</td>
                <td className={cn('mono font-bold', Number(l.delta) > 0 ? 'text-green' : 'text-red')}>{Number(l.delta) > 0 ? '+' : ''}{fmt(l.delta)}</td>
                <td>{l.refType}</td>
                <td className="mono muted">{l.refId?.slice(0, 8)}</td>
                <td className="muted">{l.memo}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <ReasonDialog open={dialog === 'freeze'} onClose={() => setDialog(null)} title="Заморозить аккаунт" variant="yellow" onConfirm={(reason) => act.mutateAsync({ path: 'freeze', body: { reason } })}>
        <div className="text-[12px] muted mb-3">Пользователь сохранит доступ только на чтение. Активные сделки останутся в эскроу. Все сессии будут завершены.</div>
      </ReasonDialog>
      <ReasonDialog open={dialog === 'ban'} onClose={() => setDialog(null)} title="Забанить аккаунт" onConfirm={(reason) => act.mutateAsync({ path: 'ban', body: { reason } })}>
        <div className="text-[12px] text-red mb-3">Вход будет запрещён, объявления сняты. Средства остаются на балансе до решения комплаенса.</div>
      </ReasonDialog>
      <ReasonDialog open={dialog === 'unfreeze'} onClose={() => setDialog(null)} title="Вернуть статус ACTIVE" variant="green" onConfirm={(reason) => act.mutateAsync({ path: 'unfreeze', body: { reason } })} />
      <Modal open={dialog === 'adjust'} onClose={() => setDialog(null)} title="Корректировка баланса (леджер ADJUSTMENT)">
        <Field label="Δ USDT (отрицательное — списание)">
          <input value={delta} onChange={(e) => setDelta(e.target.value)} className="input w-full mono" placeholder="-10.5" />
        </Field>
        <ReasonInline onConfirm={(reason) => act.mutateAsync({ path: 'balance-adjust', body: { delta, reason } }).then(() => setDialog(null))} onCancel={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === 'flags'} onClose={() => setDialog(null)} title="Лимиты и флаги">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Уровень KYC">
            <select value={flags.kycLevel} onChange={(e) => setFlags({ ...flags, kycLevel: e.target.value })} className="input w-full">
              {['BASIC', 'VERIFIED', 'ADVANCED'].map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <div className="flex flex-col gap-2 justify-end text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!flags.withdrawalsFrozen} onChange={(e) => setFlags({ ...flags, withdrawalsFrozen: e.target.checked })} /> Заморозить выводы</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!flags.tradingFrozen} onChange={(e) => setFlags({ ...flags, tradingFrozen: e.target.checked })} /> Заморозить торговлю</label>
          </div>
        </div>
        <ReasonInline onConfirm={(reason) => act.mutateAsync({ path: 'flags', body: { ...flags, reason } }).then(() => setDialog(null))} onCancel={() => setDialog(null)} />
      </Modal>
    </Page>
  );
}

function ReasonInline({ onConfirm, onCancel }: { onConfirm: (r: string) => Promise<unknown>; onCancel: () => void }) {
  const [r, setR] = useState('');
  const [l, setL] = useState(false);
  return (
    <>
      <Field label="Причина (в аудит)" className="mt-3">
        <input value={r} onChange={(e) => setR(e.target.value)} className="input w-full" />
      </Field>
      <div className="flex justify-end gap-2 mt-4">
        <Btn onClick={onCancel}>Отмена</Btn>
        <Btn variant="green" loading={l} disabled={r.trim().length < 3} onClick={async () => { setL(true); try { await onConfirm(r); } finally { setL(false); } }}>Применить</Btn>
      </div>
    </>
  );
}
