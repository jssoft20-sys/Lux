import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { Kpi, Page, Tag } from '@/components/ui';
import { ago, dt, fmt } from '@/lib/format';

const COLORS: Record<string, string> = { ALLOW: '#22c55e', REVIEW: '#f5b935', BLOCK: '#ef4444' };

export default function Dashboard() {
  const nav = useNavigate();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<any>('/dashboard/stats'), refetchInterval: 15_000 });
  const charts = useQuery({ queryKey: ['charts'], queryFn: () => api<any>('/dashboard/charts?days=14'), refetchInterval: 60_000 });
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api<any>('/dashboard/activity'), refetchInterval: 10_000 });
  const s = stats.data;
  return (
    <Page title="Дашборд" subtitle="Состояние платформы в реальном времени">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Пользователи" value={s?.users.total ?? '—'} sub={`+${s?.users.today ?? 0} сегодня`} onClick={() => nav('/users')} />
        <Kpi label="В эскроу" value={`${fmt(s?.money.escrowLocked)} USDT`} sub={`Активных сделок: ${s?.queues.ordersActive ?? 0}`} tone="green" onClick={() => nav('/escrow')} />
        <Kpi label="Обязательства" value={`${fmt(s?.money.userLiabilities)} USDT`} sub={`Доступно у юзеров ${fmt(s?.money.userAvailable)}`} onClick={() => nav('/wallets')} />
        <Kpi label="Оборот 24ч" value={`${fmt(s?.volume.day.usdt)} USDT`} sub={`${s?.volume.day.orders ?? 0} сделок · ${fmt(s?.volume.day.kgs, 0)} KGS`} tone="blue" onClick={() => nav('/p2p')} />
        <Kpi label="Комиссии" value={`${fmt(s?.money.feesCollected)} USDT`} sub="За всё время" />
        <Kpi label="Hot wallet" value={s?.money.hotWallet ? `${fmt(s.money.hotWallet.usdt)} USDT` : '—'} sub={s?.money.hotWallet ? `${fmt(s.money.hotWallet.trx)} TRX · лимит ${fmt(s.money.hotWallet.dailyLimit, 0)}/день` : 'не настроен'} tone={s?.money.hotWallet?.frozen ? 'red' : undefined} onClick={() => nav('/wallets')} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-3">
        <Kpi label="KYC на проверке" value={s?.queues.kycPending ?? 0} tone={s?.queues.kycPending ? 'yellow' : undefined} onClick={() => nav('/kyc')} />
        <Kpi label="Депозиты удержаны" value={s?.queues.depositsHeld ?? 0} tone={s?.queues.depositsHeld ? 'red' : undefined} onClick={() => nav('/aml')} />
        <Kpi label="Выводы ждут решения" value={s?.queues.withdrawalsPending ?? 0} tone={s?.queues.withdrawalsPending ? 'yellow' : undefined} onClick={() => nav('/withdrawals')} />
        <Kpi label="Споры открыты" value={s?.queues.disputesOpen ?? 0} tone={s?.queues.disputesOpen ? 'red' : undefined} onClick={() => nav('/disputes')} />
        <Kpi label="Risk-события" value={s?.queues.riskPending ?? 0} sub="ожидают ревью" tone={s?.queues.riskPending ? 'red' : undefined} onClick={() => nav('/risk')} />
        <Kpi label="Активные сделки" value={s?.queues.ordersActive ?? 0} onClick={() => nav('/p2p')} />
      </div>

      <div className="grid xl:grid-cols-3 gap-3 mt-4">
        <div className="card p-4 xl:col-span-2">
          <div className="font-semibold text-[13px] mb-2">Оборот и сделки, 14 дней</div>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <AreaChart data={charts.data?.daily ?? []}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#22c55e" stopOpacity={0.5} />
                    <stop offset="1" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1f2a26" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d) => new Date(d).getDate().toString()} stroke="#5f6b66" fontSize={11} />
                <YAxis stroke="#5f6b66" fontSize={11} width={50} />
                <Tooltip contentStyle={{ background: '#121917', border: '1px solid #1f2a26', borderRadius: 10, fontSize: 12 }} labelFormatter={(d) => new Date(String(d)).toLocaleDateString('ru-RU')} />
                <Area type="monotone" dataKey="volume" name="USDT" stroke="#22c55e" fill="url(#g1)" strokeWidth={2} />
                <Area type="monotone" dataKey="orders" name="Сделки" stroke="#60a5fa" fill="none" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-4">
          <div className="font-semibold text-[13px] mb-2">Risk Engine, 14 дней</div>
          <div className="h-[220px] flex items-center">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={charts.data?.risk ?? []} dataKey="count" nameKey="action" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {(charts.data?.risk ?? []).map((r: any) => (
                    <Cell key={r.action} fill={COLORS[r.action] ?? '#8a9691'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#121917', border: '1px solid #1f2a26', borderRadius: 10, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-3 text-[11px]">
            {(charts.data?.risk ?? []).map((r: any) => (
              <span key={r.action} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: COLORS[r.action] }} /> {r.action} {r.count}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-3 mt-3">
        <div className="card p-4">
          <div className="font-semibold text-[13px] mb-2 flex items-center gap-2">
            <span className="live-dot" /> Подозрительная активность
          </div>
          <div className="flex flex-col divide-y divide-[#161f1b]">
            {activity.data?.risk?.slice(0, 12).map((e: any) => (
              <button key={e.id} onClick={() => nav(`/users/${e.userId}`)} className="py-2 flex items-center gap-3 text-left text-[12px] hover:bg-white/[.02]">
                <Tag v={e.action} />
                <span className="w-16 mono">{e.score}/100</span>
                <span className="w-24 muted">{e.type}</span>
                <span className="flex-1 truncate">
                  {e.user?.fullName ?? e.user?.phone ?? '—'} · {(e.signals as any[]).map((s) => s.code).join(', ')}
                </span>
                <span className="muted">{ago(e.createdAt)}</span>
              </button>
            ))}
            {activity.data?.risk?.length === 0 && <div className="text-[12px] muted py-4 text-center">Пока тихо</div>}
          </div>
        </div>
        <div className="card p-4">
          <div className="font-semibold text-[13px] mb-2">Последние действия (аудит)</div>
          <div className="flex flex-col divide-y divide-[#161f1b]">
            {activity.data?.audit?.slice(0, 12).map((a: any) => (
              <div key={a.id} className="py-2 flex items-center gap-3 text-[12px]">
                <span className={`tag ${a.actorType === 'ADMIN' ? 'tag-purple' : a.actorType === 'SYSTEM' ? 'tag-gray' : 'tag-blue'}`}>{a.actorType}</span>
                <span className="mono flex-1 truncate">{a.action}</span>
                <span className="muted truncate max-w-[160px]">{a.actorLabel ?? a.targetId?.slice(0, 8)}</span>
                <span className="muted">{dt(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card p-4 mt-3">
        <div className="font-semibold text-[13px] mb-2">Статусы сделок, 14 дней</div>
        <div className="h-[160px]">
          <ResponsiveContainer>
            <BarChart data={charts.data?.orderStatuses ?? []}>
              <CartesianGrid stroke="#1f2a26" vertical={false} />
              <XAxis dataKey="status" stroke="#5f6b66" fontSize={11} />
              <YAxis stroke="#5f6b66" fontSize={11} width={30} />
              <Tooltip contentStyle={{ background: '#121917', border: '1px solid #1f2a26', borderRadius: 10, fontSize: 12 }} />
              <Bar dataKey="count" fill="#22c55e" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Page>
  );
}
