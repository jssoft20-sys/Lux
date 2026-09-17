import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ChevronDown, FileText, MoreVertical, Paperclip, Send } from 'lucide-react';
import { Avatar, Header, Spinner } from '@/components/ui';
import { useOrder } from '@/hooks/useOrder';
import { api, fetchFileBlob } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import { fmt, time, cn } from '@/lib/format';

function PrivateImage({ id, className }: { id: string; className?: string }) {
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    let alive = true;
    fetchFileBlob(id).then((u) => alive && setSrc(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);
  return src ? <img src={src} alt="" className={className} /> : <div className={cn('skeleton', className)} />;
}

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: o } = useOrder(id);
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const msgs = useQuery({ queryKey: ['messages', id], enabled: !!id, queryFn: () => api<any[]>(`/p2p/orders/${id}/messages`), refetchInterval: 8000 });

  useEffect(() => {
    const s = getSocket();
    if (!s || !id) return;
    const onMsg = (m: any) => {
      if (m.orderId !== id) return;
      qc.setQueryData(['messages', id], (old: any[] | undefined) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
    };
    s.on('message', onMsg);
    return () => {
      s.off('message', onMsg);
    };
  }, [id, qc]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.data?.length]);

  const send = useMutation({
    mutationFn: (body: { text?: string; fileId?: string }) => api<any>(`/p2p/orders/${id}/messages`, { body }),
    onSuccess: (m) => {
      qc.setQueryData(['messages', id], (old: any[] | undefined) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
      setText('');
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function attach(f: File) {
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<any>('/files?kind=CHAT', { form: fd });
      send.mutate({ fileId: r.id, text: f.name });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  if (!o) return <div className="h-full theme-dark screen" />;
  const canChat = o.permissions.canChat;
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header
        title={`Сделка #${o.number}`}
        subtitle={<span className="text-green">{o.side === 'BUY' ? 'Покупка' : 'Продажа'} {fmt(o.amountUsdt, 2)} USDT</span>}
        onBack={() => nav(`/orders/${o.id}`)}
        right={
          <button onClick={() => nav(`/orders/${o.id}`)} className="w-10 h-10 rounded-full flex items-center justify-center">
            <MoreVertical size={20} />
          </button>
        }
      />
      <div className="px-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar name={o.buyer.name} size={30} />
          <div className="leading-tight">
            <div className="text-[10px] muted">{o.role === 'BUYER' ? 'Вы' : 'Покупатель'}</div>
            <div className="text-[12px] font-semibold">{o.buyer.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="leading-tight text-right">
            <div className="text-[10px] muted">{o.role === 'SELLER' ? 'Вы' : 'Продавец'}</div>
            <div className="text-[12px] font-semibold">{o.seller.name}</div>
          </div>
          <Avatar name={o.seller.name} size={30} />
        </div>
      </div>

      {/* pinned card */}
      <div className="mx-4 card overflow-hidden">
        <button onClick={() => setPinned(!pinned)} className="w-full flex items-center justify-between px-3 py-2 text-[12px]">
          <span className="font-semibold">
            Сделка #{o.number} · {fmt(o.amountUsdt, 2)} USDT · 🔒 {o.escrow.locked ? 'защищены в эскроу' : o.escrow.state === 'RELEASED' ? 'переданы покупателю' : 'возвращены'}
          </span>
          <ChevronDown size={16} className={cn('transition', pinned && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {pinned && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="px-3 pb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span className="muted">Покупатель</span>
                <span className="font-semibold truncate">{o.buyer.fullName ?? o.buyer.name} ✓ KYC</span>
                <span className="muted">Продавец</span>
                <span className="font-semibold truncate">{o.seller.fullName ?? o.seller.name} ✓ KYC</span>
                <span className="muted">Банк</span>
                <span className="font-semibold">
                  {o.bank.shortName} → {o.bank.shortName}
                </span>
                <span className="muted">Сумма</span>
                <span className="font-semibold number-mono">{fmt(o.amountFiat, 0)} KGS</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 overflow-y-auto hide-scroll px-4 py-3 flex flex-col gap-2">
        {msgs.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {msgs.data?.map((m) => {
          if (m.type === 'SYSTEM') {
            return (
              <div key={m.id} className="self-center max-w-[92%] text-center text-[11px] px-3 py-1.5 rounded-xl card2 muted">
                {m.text}
              </div>
            );
          }
          const mine = m.senderId === user?.id;
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('max-w-[78%] rounded-2xl px-3 py-2 text-[13px]', mine ? 'self-end bg-green text-[#06240f] rounded-br-md' : 'self-start card2 rounded-bl-md', m.flagged && 'ring-2 ring-red/60')}>
              {m.fileId && m.type === 'IMAGE' && <PrivateImage id={m.fileId} className="rounded-lg mb-1 max-h-48 w-full object-cover" />}
              {m.fileId && m.type === 'FILE' && (
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={18} /> <span className="text-[12px] font-semibold truncate">{m.text || 'Файл'}</span>
                </div>
              )}
              {m.text && !(m.fileId && m.type === 'FILE') && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
              <div className={cn('text-[10px] mt-0.5 text-right', mine ? 'text-[#06240f]/70' : 'muted')}>
                {time(m.createdAt)} {mine && m.readAt ? '✓✓' : mine ? '✓' : ''}
              </div>
            </motion.div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="px-3 pb-3 safe-bottom">
        {canChat ? (
          <div className="card2 flex items-center gap-1 pl-3 pr-1 py-1">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && send.mutate({ text: text.trim() })} placeholder="Напишите сообщение..." className="flex-1 bg-transparent outline-none text-[14px] h-10" />
            <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
            <button onClick={() => fileInput.current?.click()} className="w-10 h-10 flex items-center justify-center muted">
              <Paperclip size={20} />
            </button>
            <button onClick={() => text.trim() && send.mutate({ text: text.trim() })} disabled={!text.trim() || send.isPending} className="w-10 h-10 rounded-xl btn-green flex items-center justify-center disabled:opacity-40">
              <Send size={18} />
            </button>
          </div>
        ) : (
          <div className="text-center text-[12px] muted py-2">Чат закрыт — сделка завершена</div>
        )}
        <div className="text-center text-[10px] muted mt-1">Не переходите в WhatsApp/Telegram. Somex не защищает сделки вне приложения.</div>
      </div>
    </div>
  );
}
