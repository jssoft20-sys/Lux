import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Image as ImageIcon, Upload } from 'lucide-react';
import { Button, Check, Header, Spinner } from '@/components/ui';
import { useOrder } from '@/hooks/useOrder';
import { api } from '@/lib/api';
import { fmt, cn } from '@/lib/format';

export default function ConfirmPayment() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: o } = useOrder(id);
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);
  const [c3, setC3] = useState(false);
  const [file, setFile] = useState<{ id: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(f: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api<any>('/files?kind=RECEIPT', { form: fd });
      setFile({ id: r.id, preview: URL.createObjectURL(f) });
      toast.success(r.scanStatus === 'CLEAN' ? 'Чек проверен антивирусом' : 'Чек загружен');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  const confirm = useMutation({
    mutationFn: () => api(`/p2p/orders/${id}/declare-payment`, { body: { bankCode: o.bank.code, ownAccountConfirmed: c2, exactAmountConfirmed: c1, nameAndBankConfirmed: c3, receiptFileId: file?.id } }),
    onSuccess: () => {
      toast.success('Оплата отмечена. Ожидайте проверки продавцом');
      qc.invalidateQueries({ queryKey: ['order', id] });
      nav(`/orders/${id}/chat`, { replace: true });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!o) return <div className="h-full theme-light screen" />;
  const steps = [
    { on: c1, set: setC1, n: 1, t: <>Я перевел <b>{fmt(o.amountFiat, 0)} KGS</b><br />со своего счёта {o.bank.shortName}</> },
    { on: c2, set: setC2, n: 2, t: <>Счёт принадлежит мне<br />({o.payment?.senderMustBe})</> },
    { on: c3, set: setC3, n: 3, t: <>ФИО и банк совпадают</> },
  ];
  return (
    <div className="h-full theme-light screen flex flex-col">
      <Header />
      <div className="px-5 pb-8 flex-1 overflow-y-auto hide-scroll">
        <div className="text-[26px] font-extrabold tracking-tight">Я отправил оплату</div>
        <div className="mt-5 flex flex-col gap-4">
          {steps.map((s) => (
            <button key={s.n} onClick={() => s.set(!s.on)} className="flex items-center gap-3 text-left">
              <span className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-[14px] border-2', s.on ? 'bg-green border-green text-[#06240f]' : 'border-[#0b100e]/40')}>{s.on ? '✓' : s.n}</span>
              <span className="text-[15px] leading-snug">{s.t}</span>
            </button>
          ))}
          <div className="flex items-start gap-3">
            <span className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-[14px] border-2', file ? 'bg-green border-green text-[#06240f]' : 'border-[#0b100e]/40')}>{file ? '✓' : 4}</span>
            <div className="flex-1">
              <div className="text-[15px] leading-snug">
                Загрузите подтверждение
                <br />
                (чек из приложения банка)
              </div>
              <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <div className="mt-3 card bg-white p-3 flex items-center gap-3">
                <div className="w-16 h-20 rounded-lg bg-[#f3f5f4] flex items-center justify-center overflow-hidden">
                  {uploading ? <Spinner /> : file ? <img src={file.preview} className="w-full h-full object-cover" alt="" /> : <ImageIcon className="muted" />}
                </div>
                <div className="flex-1 text-[12px] muted">{file ? 'Чек прикреплён. Чек — не доказательство оплаты, продавец проверит поступление в банке.' : 'PNG, JPG, HEIC или PDF до 10 MB. Файл проверяется антивирусом.'}</div>
                <button onClick={() => input.current?.click()} className="chip bg-white px-3 h-9 text-[12px] font-semibold flex items-center gap-1">
                  <Upload size={14} /> {file ? 'Заменить' : 'Выбрать'}
                </button>
              </div>
            </div>
          </div>
        </div>
        <Button className="mt-8" disabled={!c1 || !c2 || !c3} loading={confirm.isPending} onClick={() => confirm.mutate()}>
          Подтвердить оплату
        </Button>
        <div className="text-center text-[12px] muted mt-3">
          После подтверждения ожидайте
          <br />
          проверки продавцом.
        </div>
      </div>
    </div>
  );
}
