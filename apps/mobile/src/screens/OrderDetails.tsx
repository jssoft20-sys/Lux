import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Copy, HelpCircle, MessageCircle, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Avatar, BankLogo, Button, Header, Row, Sheet, Skeleton } from '@/components/ui';
import { EscrowPill, StatusCard } from '@/components/OrderBits';
import { useOrder } from '@/hooks/useOrder';
import { api } from '@/lib/api';
import { fmt, cn } from '@/lib/format';

export default function OrderDetails() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useOrder(id);
  const o = q.data;
  const [help, setHelp] = useState<'how' | 'rules' | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const cancel = useMutation({
    mutationFn: () => api(`/p2p/orders/${id}/cancel`, { body: { reason: 'Отменено покупателем' } }),
    onSuccess: () => {
      toast.success('Сделка отменена');
      qc.invalidateQueries({ queryKey: ['order', id] });
      setCancelOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const copy = (v: string) => {
    navigator.clipboard?.writeText(v).then(() => toast.success('Скопировано'));
  };

  if (!o) {
    return (
      <div className="h-full theme-dark screen">
        <Header title="Сделка" />
        <div className="px-4 flex flex-col gap-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }
  const buyer = o.role === 'BUYER';
  const done = ['RELEASED', 'RESOLVED_RELEASE'].includes(o.status);
  if (done && !sessionStorage.getItem(`seen-complete-${o.id}`)) {
    sessionStorage.setItem(`seen-complete-${o.id}`, '1');
    nav(`/orders/${o.id}/complete`, { replace: true });
  }

  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header
        title={`Сделка #${o.number}`}
        subtitle={<span className="text-green">{buyer ? 'Покупка' : 'Продажа'} USDT · {o.bank.shortName} → {o.bank.shortName}</span>}
        right={
          <button onClick={() => nav(`/orders/${o.id}/chat`)} className="relative w-10 h-10 rounded-full card flex items-center justify-center press">
            <MessageCircle size={20} className="text-green" />
            {o.unreadMessages > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-green text-[#06240f] text-[10px] font-bold flex items-center justify-center">{o.unreadMessages}</span>}
          </button>
        }
      />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <StatusCard order={o} />

        <div className="card p-3 mt-3">
          <Row label="Сумма" value={`${fmt(o.amountFiat, 0)} KGS`} mono />
          <Row label={buyer ? 'Вы получите' : 'Вы отдаёте'} value={`${fmt(buyer ? o.buyerReceives : o.amountUsdt, 2)} USDT`} mono className="border-t line" />
          <Row label="Цена за 1 USDT" value={`${fmt(o.price, 2)} KGS`} mono className="border-t line" />
          <div className="border-t line pt-2.5">
            <EscrowPill amount={o.amountUsdt} />
          </div>
        </div>

        {buyer ? (
          <div className="card p-3 mt-3">
            <div className="flex items-center gap-3 pb-3 border-b line">
              <Avatar name={o.seller.name} size={40} />
              <div className="flex-1">
                <div className="text-[12px] muted">Продавец</div>
                <div className="font-bold flex items-center gap-1">
                  {o.seller.name} <ShieldCheck size={14} className="text-green" />
                </div>
                <div className="text-[11px] muted number-mono">
                  <span className="text-green">●</span> {o.seller.completionRate}% | {fmt(o.seller.completedOrders, 0)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 py-3 border-b line">
              <BankLogo code={o.bank.code} logo={o.bank.logo} color={o.bank.color} size={40} />
              <div>
                <div className="text-[12px] muted">Банк продавца</div>
                <div className="font-bold">{o.bank.name}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 py-3 border-b line">
              <Avatar name={o.payment?.holderName} size={40} />
              <div>
                <div className="text-[12px] muted">ФИО получателя</div>
                <div className="font-bold">{o.payment?.holderName}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-3">
              <span className="w-10 h-10 rounded-full bg-red/15 text-red flex items-center justify-center text-[18px]">🇰🇬</span>
              <div className="flex-1">
                <div className="text-[12px] muted">Номер счёта</div>
                <div className="font-bold number-mono tracking-wide">{(o.payment?.accountNumber ?? o.payment?.accountMasked ?? '').replace(/(\d{4})(?=\d)/g, '$1 ')}</div>
              </div>
              {o.payment?.accountNumber && (
                <button onClick={() => copy(o.payment.accountNumber)} className="w-9 h-9 rounded-xl card2 flex items-center justify-center press">
                  <Copy size={16} />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="card p-3 mt-3">
            <div className="text-[12px] muted">Ожидайте {fmt(o.expected?.amountFiat, 0)} KGS</div>
            <div className="mt-2 flex items-center gap-3">
              <Avatar name={o.expected?.senderName} size={40} />
              <div>
                <div className="text-[12px] muted">Отправитель</div>
                <div className="font-bold">{o.expected?.senderName}</div>
              </div>
              <ShieldCheck size={16} className="text-green ml-auto" />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <BankLogo code={o.bank.code} logo={o.bank.logo} color={o.bank.color} size={40} />
              <div>
                <div className="text-[12px] muted">Банк</div>
                <div className="font-bold">
                  {o.bank.shortName} → {o.bank.shortName}
                </div>
              </div>
            </div>
            <div className="danger-card p-3 mt-3 text-[12px] flex gap-2">
              <ShieldAlert size={18} className="text-red shrink-0" />
              <span>
                Принимайте перевод <b>ТОЛЬКО</b> от этого человека. {o.expected?.nameMismatchAction}
              </span>
            </div>
          </div>
        )}

        {o.status === 'CREATED' && buyer && (
          <>
            <div className="warn-card p-3 mt-3 text-[12px] flex gap-2">
              <AlertTriangle size={18} className="shrink-0" />
              <span>
                Отправитель должен быть <b>{o.payment?.senderMustBe}</b> со своего счёта {o.bank.shortName}. Не переводите через кассу, терминал, чужую карту или счёт третьего лица.
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <Button variant="ghost" size="md" className="flex-1" onClick={() => setHelp('how')}>
                <HelpCircle size={16} /> Как оплатить?
              </Button>
              <Button variant="ghost" size="md" className="flex-1" onClick={() => setHelp('rules')}>
                <ScrollText size={16} /> Правила
              </Button>
            </div>
            <Button className="mt-3" onClick={() => nav(`/orders/${o.id}/confirm`)}>
              Я отправил оплату
            </Button>
            <Button variant="danger" className="mt-2" onClick={() => setCancelOpen(true)}>
              Отменить сделку
            </Button>
          </>
        )}
        {o.status === 'CREATED' && !buyer && (
          <div className="info-card p-3 mt-3 text-[12px]">Покупатель переводит деньги. Как только он отметит оплату — проверьте поступление в приложении банка и отпустите USDT.</div>
        )}
        {o.status === 'PAID' && buyer && (
          <>
            <div className="info-card p-3 mt-3 text-[12px]">Продавец проверяет поступление в приложении банка. Обычно это занимает 1–5 минут. Если продавец не отвечает более 15 минут — откройте спор.</div>
            <Button variant="ghost" className="mt-3" onClick={() => nav(`/orders/${o.id}/chat`)}>
              <MessageCircle size={18} /> Написать продавцу
            </Button>
            <Button variant="danger" className="mt-2" onClick={() => nav(`/orders/${o.id}/dispute`)}>
              Открыть спор
            </Button>
          </>
        )}
        {o.status === 'PAID' && !buyer && (
          <>
            <Button className="mt-3" onClick={() => nav(`/orders/${o.id}/release`)}>
              Проверить и отпустить USDT
            </Button>
            <Button variant="danger" className="mt-2" onClick={() => nav(`/orders/${o.id}/dispute`)}>
              ФИО/сумма не совпадают → спор
            </Button>
          </>
        )}
        {o.status === 'DISPUTED' && (
          <div className="danger-card p-3 mt-3 text-[13px]">
            <div className="font-bold">Открыт спор</div>
            <div className="text-[12px] mt-1">USDT остаются в эскроу до решения арбитража Somex. Приложите доказательства в чате: чеки, выписку, скриншоты из приложения банка.</div>
            <Button variant="ghost" size="md" className="mt-3 w-full" onClick={() => nav(`/orders/${o.id}/chat`)}>
              Открыть чат
            </Button>
          </div>
        )}
        {['CANCELLED', 'EXPIRED', 'RESOLVED_REFUND'].includes(o.status) && <div className="card p-3 mt-3 text-[13px] muted">{o.cancelReason || 'Сделка закрыта. USDT возвращены продавцу.'}</div>}
        {done && (
          <Button className="mt-3" onClick={() => nav(`/orders/${o.id}/complete`)}>
            Сделка завершена — открыть
          </Button>
        )}
      </div>

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="Отменить сделку?">
        <div className="text-[13px] muted">Если вы уже перевели деньги — <b className="text-red">не отменяйте</b>. Нажмите «Я отправил оплату» и приложите чек.</div>
        <Button variant="danger" className="mt-4" loading={cancel.isPending} onClick={() => cancel.mutate()}>
          Да, отменить
        </Button>
        <Button variant="ghost" className="mt-2" onClick={() => setCancelOpen(false)}>
          Назад
        </Button>
      </Sheet>
      <Sheet open={help !== null} onClose={() => setHelp(null)} title={help === 'how' ? 'Как оплатить' : 'Правила сделки'}>
        {help === 'how' ? (
          <ol className="list-decimal pl-5 flex flex-col gap-2 text-[13px]">
            <li>Откройте приложение {o.bank.name} на своём телефоне.</li>
            <li>Переведите ровно {fmt(o.amountFiat, 0)} KGS на счёт получателя из карточки сделки.</li>
            <li>Не пишите «USDT», «крипта», «Somex» в комментарии к переводу.</li>
            <li>Сохраните чек и вернитесь в Somex → «Я отправил оплату».</li>
          </ol>
        ) : (
          <ul className="list-disc pl-5 flex flex-col gap-2 text-[13px]">
            {(o.payment?.rules ?? ['Оплата только со своего счёта на своё имя', 'Чек не является доказательством оплаты', 'Не переходите в WhatsApp/Telegram', 'Споры решает арбитраж Somex по системным событиям и чату']).map((r: string) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </Sheet>
    </div>
  );
}
