import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, Lock, Unlock } from 'lucide-react';
import { Badge, Header, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { fmt, date, cn } from '@/lib/format';

const REF: Record<string, string> = { DEPOSIT: 'Пополнение', WITHDRAWAL: 'Вывод', WITHDRAWAL_LOCK: 'Резерв под вывод', WITHDRAWAL_UNLOCK: 'Возврат резерва', ORDER_LOCK: 'Эскроу по сделке', ORDER_UNLOCK: 'Возврат из эскроу', ORDER_REFUND: 'Возврат из эскроу', ORDER_RELEASE: 'Сделка завершена', ORDER_PARTIAL: 'Решение спора', ADJUSTMENT: 'Корректировка', FEE: 'Комиссия' };

export default function History() {
  const [tab, setTab] = useState<'all' | 'deposits' | 'withdrawals'>('all');
  const ledger = useQuery({ queryKey: ['history'], queryFn: () => api<any>('/me/history?limit=100'), enabled: tab === 'all' });
  const deposits = useQuery({ queryKey: ['deposits'], queryFn: () => api<any>('/wallet/deposits?limit=50'), enabled: tab === 'deposits' });
  const withdrawals = useQuery({ queryKey: ['withdrawals'], queryFn: () => api<any>('/wallet/withdrawals?limit=50'), enabled: tab === 'withdrawals', refetchInterval: 10_000 });
  const WS: Record<string, [string, 'green' | 'yellow' | 'red' | 'gray' | 'blue']> = { AWAITING_OTP: ['Ожидает код', 'yellow'], RISK_REVIEW: ['Проверка безопасности', 'red'], APPROVAL_REQUIRED: ['Ожидает одобрения', 'yellow'], APPROVED: ['В обработке', 'blue'], BROADCASTING: ['Отправка', 'blue'], SENT: ['Отправлен', 'green'], CONFIRMED: ['Подтверждён', 'green'], FAILED: ['Ошибка', 'red'], REJECTED: ['Отклонён', 'red'], CANCELLED: ['Отменён', 'gray'] };
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="История" />
      <div className="px-4">
        <div className="card2 p-1 flex">
          {(['all', 'deposits', 'withdrawals'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('flex-1 h-9 rounded-xl text-[12px] font-semibold', tab === t ? 'tab-active' : 'muted')}>
              {t === 'all' ? 'Все' : t === 'deposits' ? 'Депозиты' : 'Выводы'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto hide-scroll px-4 py-3 pb-8 flex flex-col gap-2">
        {tab === 'all' && ledger.isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        {tab === 'all' &&
          ledger.data?.items?.map((e: any) => {
            const pos = Number(e.delta) > 0;
            const lock = e.refType.includes('LOCK') || e.refType === 'ORDER_RELEASE' && !pos;
            return (
              <div key={e.id} className="card p-3 flex items-center gap-3">
                <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center', pos ? 'bg-green/15 text-green' : 'bg-red/10 text-red')}>{lock ? pos ? <Unlock size={16} /> : <Lock size={16} /> : pos ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold">{REF[e.refType] ?? e.refType}</div>
                  <div className="text-[11px] muted truncate">{e.memo || ''} · {date(e.createdAt)}</div>
                </div>
                <span className={cn('font-bold number-mono text-[14px]', pos ? 'text-green' : '')}>
                  {pos ? '+' : ''}
                  {fmt(e.delta, 2)}
                </span>
              </div>
            );
          })}
        {tab === 'deposits' &&
          deposits.data?.items?.map((x: any) => (
            <div key={x.id} className="card p-3">
              <div className="flex items-center justify-between">
                <span className="font-bold number-mono">+{fmt(x.amount, 2)} USDT</span>
                <Badge tone={x.status === 'CREDITED' ? 'green' : x.status === 'HELD' ? 'red' : 'yellow'}>{x.status}</Badge>
              </div>
              <div className="text-[11px] muted truncate mt-1">{date(x.createdAt)} · {x.txHash}</div>
            </div>
          ))}
        {tab === 'withdrawals' &&
          withdrawals.data?.items?.map((w: any) => (
            <div key={w.id} className="card p-3">
              <div className="flex items-center justify-between">
                <span className="font-bold number-mono">-{fmt(w.amount, 2)} USDT</span>
                <Badge tone={WS[w.status]?.[1] ?? 'gray'}>{WS[w.status]?.[0] ?? w.status}</Badge>
              </div>
              <div className="text-[11px] muted truncate mt-1">
                {date(w.createdAt)} · {w.toAddress}
              </div>
              {w.txHash && <div className="text-[11px] text-green truncate">TX {w.txHash}</div>}
              {w.rejectedReason && <div className="text-[11px] text-red">{w.rejectedReason}</div>}
            </div>
          ))}
        {((tab === 'all' && ledger.data?.items?.length === 0) || (tab === 'deposits' && deposits.data?.items?.length === 0) || (tab === 'withdrawals' && withdrawals.data?.items?.length === 0)) && <div className="text-center text-[12px] muted py-8">Пока пусто</div>}
      </div>
    </div>
  );
}
