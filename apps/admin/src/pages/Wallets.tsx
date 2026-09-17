import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, RefreshCw, Snowflake } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Btn, Field, Json, Kpi, Modal, Page, Pager, Select, Stat, Table, Tag } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, fmt, cn } from '@/lib/format';

export default function WalletsPage() {
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const w = useQuery({ queryKey: ['wallet'], queryFn: () => api<any>('/wallet'), refetchInterval: 20_000 });
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const ledger = useQuery({ queryKey: ['ledger', type, page], queryFn: () => api<any>(`/wallet/ledger${qs({ type, page, limit: 40 })}`) });
  const [limits, setLimits] = useState<{ dailyLimit: string; singleLimit: string } | null>(null);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const sync = useMutation({ mutationFn: () => api('/wallet/hot/sync', { body: {} }), onSuccess: () => { toast.success('Синхронизировано'); qc.invalidateQueries({ queryKey: ['wallet'] }); }, onError: (e: any) => toast.error(e.message) });
  const setHot = useMutation({ mutationFn: (body: any) => api('/wallet/hot/limits', { body }), onSuccess: () => { toast.success('Сохранено'); qc.invalidateQueries({ queryKey: ['wallet'] }); setLimits(null); setFreezeOpen(false); }, onError: (e: any) => toast.error(e.message) });
  const globalFreeze = useMutation({ mutationFn: (v: boolean) => api('/settings', { method: 'PUT', body: { values: { 'wallet.withdrawals_frozen': String(v) } } }), onSuccess: () => { toast.success('Глобальная заморозка обновлена'); qc.invalidateQueries({ queryKey: ['wallet'] }); }, onError: (e: any) => toast.error(e.message) });
  const d = w.data;
  const hot = d?.hotWallet;
  const rec = d?.reconciliation;
  return (
    <Page
      title="Кошельки и леджер"
      subtitle="Hot wallet, обязательства перед пользователями, сверка двойной записи"
      actions={
        <>
          {can(admin?.role, 'FINANCE') && <Btn onClick={() => sync.mutate()} loading={sync.isPending}><RefreshCw size={14} /> Синхронизировать hot wallet</Btn>}
          {can(admin?.role, 'FINANCE') && <Btn variant={hot?.frozen ? 'green' : 'red'} onClick={() => setFreezeOpen(true)}><Snowflake size={14} /> {hot?.frozen ? 'Разморозить выводы' : 'ЭКСТРЕННАЯ ЗАМОРОЗКА'}</Btn>}
        </>
      }
    >
      {d?.chainSimulated && <div className="card p-3 mb-3 text-[12px] text-yellow flex items-center gap-2"><AlertTriangle size={14} /> Блокчейн в режиме симуляции (DEV_SIMULATE_CHAIN=true): депозиты и трансляции эмулируются.</div>}
      <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
        <Kpi label="Hot wallet USDT" value={hot ? fmt(hot.balanceCached) : '—'} sub={hot ? `${fmt(hot.nativeBalance)} TRX на комиссии · синк ${dt(hot.lastSyncAt)}` : 'не настроен'} tone={hot?.frozen ? 'red' : 'green'} />
        <Kpi label="Обязательства" value={`${fmt(Number(d?.userAvailable ?? 0) + Number(d?.escrowLocked ?? 0))}`} sub={`доступно ${fmt(d?.userAvailable)} + эскроу ${fmt(d?.escrowLocked)}`} />
        <Kpi label="Выводы в очереди" value={d?.pendingWithdrawals?.count ?? 0} sub={`${fmt(d?.pendingWithdrawals?.amount)} USDT`} tone="yellow" />
        <Kpi label="Депозитных адресов" value={d?.depositAddresses ?? 0} sub="HD-деривация из xpub" />
        <Kpi label="Сверка леджера" value={rec ? (rec.ok ? 'OK' : 'ОШИБКА') : '—'} sub={rec ? `Σ = ${rec.ledgerSum} · ${rec.mismatches.length} расхождений` : ''} tone={rec?.ok ? 'green' : 'red'} />
      </div>
      <div className="grid xl:grid-cols-2 gap-3 mt-3">
        <div className="card p-4">
          <div className="text-[12px] font-semibold mb-1">Hot wallet (TRON)</div>
          <Stat l="Адрес" v={hot?.address ?? '—'} mono />
          <Stat l="Лимит на транзакцию" v={`${fmt(hot?.singleLimit, 0)} USDT`} mono />
          <Stat l="Лимит в сутки" v={`${fmt(hot?.dailyLimit, 0)} USDT`} mono />
          <Stat l="Отправлено сегодня" v={`${fmt(hot?.sentToday)} USDT`} mono />
          <Stat l="Статус" v={hot?.frozen ? <Tag className="tag-red">ЗАМОРОЖЕН</Tag> : <Tag className="tag-green">Активен</Tag>} />
          {can(admin?.role, 'FINANCE') && <Btn size="sm" className="mt-3" onClick={() => setLimits({ dailyLimit: hot?.dailyLimit ?? '50000', singleLimit: hot?.singleLimit ?? '10000' })}>Изменить лимиты</Btn>}
          <div className="text-[11px] muted mt-3">Приватный ключ hot wallet хранится зашифрованным (AES-256-GCM) и используется только воркером выводов. Для production рекомендуется HSM/KMS и multisig cold storage — см. docs/SECURITY.md.</div>
        </div>
        <div className="card p-4">
          <div className="text-[12px] font-semibold mb-1">Платформенные счета леджера</div>
          {rec && Object.entries(rec.platform).map(([k, v]) => <Stat key={k} l={k} v={`${fmt(v as string)} USDT`} mono />)}
          <Stat l="Обязательства (по кэшу балансов)" v={`${fmt(rec?.userLiabilities)} USDT`} mono />
          {rec && rec.mismatches.length > 0 && <Json data={rec.mismatches} />}
          <div className="text-[11px] muted mt-2">PLATFORM_HOT_WALLET — внешний контр-счёт (сеть). Инвариант: Σ всех проводок = 0; user balances = -(external + fees + adjustments).</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4 mb-2">
        <div className="text-[13px] font-semibold">Проводки</div>
        <Select value={type} onChange={setType} options={[['', 'Все типы'], ['DEPOSIT', 'DEPOSIT'], ['WITHDRAWAL', 'WITHDRAWAL'], ['WITHDRAWAL_LOCK', 'WITHDRAWAL_LOCK'], ['ORDER_LOCK', 'ORDER_LOCK'], ['ORDER_RELEASE', 'ORDER_RELEASE'], ['ORDER_UNLOCK', 'ORDER_UNLOCK'], ['ORDER_REFUND', 'ORDER_REFUND'], ['ADJUSTMENT', 'ADJUSTMENT']]} />
      </div>
      <Table head={['Дата', 'Journal', 'Пользователь', 'Счёт', 'Δ', 'Тип', 'Ref', 'Memo']} loading={ledger.isLoading} empty={ledger.data?.items.length === 0}>
        {ledger.data?.items.map((l: any) => (
          <tr key={l.id}>
            <td className="muted">{dt(l.createdAt)}</td>
            <td className="mono muted">{l.journalId.slice(0, 8)}</td>
            <td className="mono muted">{l.userId?.slice(0, 8) ?? '—'}</td>
            <td className="mono">{l.account}</td>
            <td className={cn('mono font-bold', Number(l.delta) > 0 ? 'text-green' : 'text-red')}>{Number(l.delta) > 0 ? '+' : ''}{fmt(l.delta)}</td>
            <td>{l.refType}</td>
            <td className="mono muted">{l.refId?.slice(0, 8)}</td>
            <td className="muted">{l.memo}</td>
          </tr>
        ))}
      </Table>
      {ledger.data && <Pager page={ledger.data.page} pages={Math.ceil(ledger.data.total / ledger.data.limit)} total={ledger.data.total} onPage={setPage} />}
      <Modal open={!!limits} onClose={() => setLimits(null)} title="Лимиты hot wallet">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Лимит в сутки (USDT)"><input value={limits?.dailyLimit ?? ''} onChange={(e) => setLimits({ ...limits!, dailyLimit: e.target.value })} className="input w-full mono" /></Field>
          <Field label="Лимит на транзакцию (USDT)"><input value={limits?.singleLimit ?? ''} onChange={(e) => setLimits({ ...limits!, singleLimit: e.target.value })} className="input w-full mono" /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-4"><Btn onClick={() => setLimits(null)}>Отмена</Btn><Btn variant="green" onClick={() => setHot.mutate(limits)}>Сохранить</Btn></div>
      </Modal>
      <Modal open={freezeOpen} onClose={() => setFreezeOpen(false)} title={hot?.frozen ? 'Снять заморозку выводов' : 'Экстренная заморозка выводов'}>
        <div className="text-[13px] muted">{hot?.frozen ? 'Воркер снова начнёт транслировать одобренные выводы.' : 'Все трансляции выводов остановятся немедленно. Пользователи смогут создавать заявки, но они будут копиться в очереди. Используйте при подозрении на компрометацию.'}</div>
        <div className="flex justify-end gap-2 mt-4">
          <Btn onClick={() => setFreezeOpen(false)}>Отмена</Btn>
          <Btn variant={hot?.frozen ? 'green' : 'red'} onClick={() => { setHot.mutate({ frozen: !hot?.frozen }); globalFreeze.mutate(!hot?.frozen); }}>{hot?.frozen ? 'Разморозить' : 'ЗАМОРОЗИТЬ ВСЁ'}</Btn>
        </div>
      </Modal>
    </Page>
  );
}
