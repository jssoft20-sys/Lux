import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Field, Page, Table, Tag } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt, fmt } from '@/lib/format';

export default function BanksPage() {
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api<any[]>('/banks') });
  const rates = useQuery({ queryKey: ['rates'], queryFn: () => api<any[]>('/rates') });
  const [price, setPrice] = useState('');
  const update = useMutation({ mutationFn: ({ code, body }: { code: string; body: any }) => api(`/banks/${code}`, { method: 'PATCH', body }), onSuccess: () => qc.invalidateQueries({ queryKey: ['banks'] }), onError: (e: any) => toast.error(e.message) });
  const setRate = useMutation({ mutationFn: () => api('/rates/USDT-KGS', { body: { price } }), onSuccess: () => { toast.success('Курс обновлён'); qc.invalidateQueries({ queryKey: ['rates'] }); }, onError: (e: any) => toast.error(e.message) });
  const rate = rates.data?.find((r) => r.asset === 'USDT');
  return (
    <Page title="Банки и справочный курс" subtitle="Банки и кошельки Кыргызстана для сделок, правило «банк → тот же банк»">
      <div className="card p-4 mb-4 flex items-end gap-3">
        <div>
          <div className="text-[11px] muted uppercase font-semibold">USDT / KGS справочный курс</div>
          <div className="text-[26px] font-extrabold mono">{rate ? fmt(rate.price) : '—'} <span className="text-[13px] muted">{rate?.source} · {dt(rate?.updatedAt)}</span></div>
        </div>
        {can(admin?.role, 'FINANCE') && (
          <>
            <Field label="Новый курс"><input value={price} onChange={(e) => setPrice(e.target.value)} className="input w-32 mono" placeholder="88.60" /></Field>
            <Btn variant="green" loading={setRate.isPending} disabled={!price} onClick={() => setRate.mutate()}>Обновить</Btn>
          </>
        )}
      </div>
      <Table head={['Лого', 'Код', 'Название', 'Тип', 'Видно имя плательщика', 'Формат счёта', 'Включён', 'Порядок']} loading={banks.isLoading}>
        {banks.data?.map((b) => (
          <tr key={b.code}>
            <td><img src={`/banks/${b.logo}`} alt="" className="w-8 h-8 rounded-lg" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /></td>
            <td className="mono">{b.code}</td>
            <td className="font-semibold">{b.name}</td>
            <td><Tag className={b.kind === 'BANK' ? 'tag-green' : 'tag-yellow'}>{b.kind}</Tag></td>
            <td><input type="checkbox" checked={b.showsSenderName} onChange={(e) => update.mutate({ code: b.code, body: { showsSenderName: e.target.checked } })} /></td>
            <td className="muted">{b.accountHint}</td>
            <td><input type="checkbox" checked={b.enabled} onChange={(e) => update.mutate({ code: b.code, body: { enabled: e.target.checked } })} /></td>
            <td><input type="number" defaultValue={b.order} onBlur={(e) => Number(e.target.value) !== b.order && update.mutate({ code: b.code, body: { order: Number(e.target.value) } })} className="input w-16 mono" /></td>
          </tr>
        ))}
      </Table>
    </Page>
  );
}
