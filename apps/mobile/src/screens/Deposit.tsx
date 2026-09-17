import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Copy, Info } from 'lucide-react';
import { Badge, Button, Header, Skeleton } from '@/components/ui';
import { api, copyText } from '@/lib/api';
import { fmt, date } from '@/lib/format';

export default function Deposit() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const simulate = useMutation({
    mutationFn: (amount: string) => api('/wallet/deposits/simulate', { body: { amount } }),
    onSuccess: () => {
      toast.success('Тестовый депозит зачислен');
      qc.invalidateQueries({ queryKey: ['deposits'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const info = useQuery({ queryKey: ['deposit-address'], queryFn: () => api<any>('/wallet/deposit-address?network=TRON'), retry: false });
  const list = useQuery({ queryKey: ['deposits'], queryFn: () => api<any>('/wallet/deposits?limit=10'), refetchInterval: 15_000 });
  const d = info.data;
  const tone = (s: string) => (s === 'CREDITED' ? 'green' : s === 'HELD' || s === 'REJECTED' ? 'red' : 'yellow');
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Пополнить USDT" subtitle="TRON (TRC20)" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <div className="card2 p-1 flex">
          <button className="flex-1 h-9 rounded-xl tab-active text-[13px] font-semibold">TRON · TRC20</button>
          <button className="flex-1 h-9 rounded-xl muted text-[13px] font-semibold" onClick={() => toast.info('Сеть BSC появится позже')}>
            BSC · BEP20
          </button>
        </div>
        {info.isLoading && <Skeleton className="h-72 mt-4" />}
        {info.error && <div className="danger-card p-3 mt-4 text-[13px]">{(info.error as any).message}</div>}
        {d && (
          <>
            <div className="card p-4 mt-4 flex flex-col items-center">
              <div className="bg-white p-3 rounded-2xl">
                <QRCodeSVG value={d.address} size={168} level="M" />
              </div>
              <div className="text-[12px] muted mt-3">Ваш адрес для USDT (TRC20)</div>
              <div className="text-[13px] font-semibold number-mono break-all text-center mt-1">{d.address}</div>
              <Button size="md" variant="soft" className="mt-3" onClick={() => copyText(d.address).then((ok) => toast[ok ? 'success' : 'error'](ok ? 'Адрес скопирован' : 'Не удалось скопировать'))}>
                <Copy size={16} /> Скопировать адрес
              </Button>
            </div>
            {d.simulated && (
              <div className="warn-card p-3 mt-3 text-[12px]">
                <div className="font-bold">Тестовый режим: блокчейн симулируется</div>
                <div className="mt-1">Реальные переводы не отслеживаются. Зачислите тестовые USDT одной кнопкой, чтобы проверить сделки и вывод.</div>
                <div className="flex gap-2 mt-2">
                  {['100', '1000', '5000'].map((a) => (
                    <button key={a} disabled={simulate.isPending} onClick={() => simulate.mutate(a)} className="flex-1 h-9 rounded-xl bg-[#6b4a00] text-white text-[12px] font-bold">
                      +{a} USDT
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="warn-card p-3 mt-3 text-[12px]">{d.warning}</div>
            <div className="card p-3 mt-3">
              <div className="text-[13px] font-semibold flex items-center gap-2">
                <Info size={16} className="text-green" /> Как пополнить
              </div>
              <ol className="list-decimal pl-5 mt-2 text-[12px] muted flex flex-col gap-1">
                {d.instructions.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          </>
        )}
        <div className="text-[13px] font-semibold mt-5 mb-2">Последние депозиты</div>
        <div className="flex flex-col gap-2">
          {list.data?.items?.map((x: any) => (
            <div key={x.id} className="card p-3">
              <div className="flex items-center justify-between">
                <span className="font-bold number-mono">+{fmt(x.amount, 2)} USDT</span>
                <Badge tone={tone(x.status)}>{x.status === 'CREDITED' ? 'Зачислен' : x.status === 'HELD' ? 'Проверка происхождения' : x.status === 'REJECTED' ? 'Отклонён' : x.status === 'SCREENING' ? 'AML-проверка' : `Подтверждения ${x.confirmations}/${x.requiredConfirmations}`}</Badge>
              </div>
              {['DETECTED', 'CONFIRMING'].includes(x.status) && (
                <div className="h-1.5 rounded-full card2 mt-2 overflow-hidden">
                  <div className="h-full bg-green transition-all" style={{ width: `${Math.min(100, (x.confirmations / x.requiredConfirmations) * 100)}%` }} />
                </div>
              )}
              <div className="text-[11px] muted mt-1 truncate">
                {date(x.createdAt)} · {x.txHash}
              </div>
              {x.heldReason && <div className="text-[11px] text-yellow mt-1">{x.heldReason}</div>}
            </div>
          ))}
          {list.data && list.data.items.length === 0 && <div className="text-[12px] muted text-center py-4">Депозитов пока нет</div>}
        </div>
      </div>
    </div>
  );
}
