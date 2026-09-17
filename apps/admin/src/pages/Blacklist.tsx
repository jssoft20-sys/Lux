import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Btn, Field, Page, Select, Table, Tag, Toolbar } from '@/components/ui';
import { useAdminAuth, can } from '@/store/auth';
import { dt } from '@/lib/format';

const TYPES: Array<[string, string]> = [['PHONE', 'Телефон'], ['WALLET_ADDRESS', 'Адрес кошелька'], ['DOCUMENT', 'Документ'], ['IP', 'IP'], ['DEVICE', 'Устройство'], ['BANK_ACCOUNT', 'Банковский счёт (BANK:номер)'], ['NAME', 'ФИО']];

export default function BlacklistPage() {
  const qc = useQueryClient();
  const { admin } = useAdminAuth();
  const [params] = useSearchParams();
  const [type, setType] = useState('');
  const [form, setForm] = useState({ type: params.get('add') ? 'WALLET_ADDRESS' : 'PHONE', value: params.get('add') ?? '', reason: '' });
  const [check, setCheck] = useState({ type: 'PHONE', value: '', result: null as null | boolean });
  const list = useQuery({ queryKey: ['blacklist', type], queryFn: () => api<any>(`/blacklist${qs({ type })}`) });
  const add = useMutation({ mutationFn: () => api('/blacklist', { body: form }), onSuccess: () => { toast.success('Добавлено'); qc.invalidateQueries({ queryKey: ['blacklist'] }); setForm({ ...form, value: '', reason: '' }); }, onError: (e: any) => toast.error(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => api(`/blacklist/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['blacklist'] }) });
  return (
    <Page title="Чёрный список" subtitle="Значения хранятся как HMAC-хэши — оригиналы не восстановимы из базы">
      <div className="grid xl:grid-cols-3 gap-3 mb-4">
        <div className="card p-4 xl:col-span-2">
          <div className="text-[13px] font-semibold mb-2">Добавить</div>
          <div className="grid grid-cols-4 gap-2">
            <Field label="Тип"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={TYPES} className="w-full" /></Field>
            <Field label="Значение" className="col-span-2"><input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="input w-full mono" placeholder={form.type === 'BANK_ACCOUNT' ? 'OPTIMA:4169580000001234' : ''} /></Field>
            <Field label="Причина"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="input w-full" /></Field>
          </div>
          <Btn variant="red" className="mt-3" disabled={!can(admin?.role, 'RISK', 'COMPLIANCE') || form.value.length < 2 || form.reason.length < 3} loading={add.isPending} onClick={() => add.mutate()}>Добавить в чёрный список</Btn>
        </div>
        <div className="card p-4">
          <div className="text-[13px] font-semibold mb-2">Проверить значение</div>
          <Select value={check.type} onChange={(v) => setCheck({ ...check, type: v, result: null })} options={TYPES} className="w-full" />
          <input value={check.value} onChange={(e) => setCheck({ ...check, value: e.target.value, result: null })} className="input w-full mt-2 mono" />
          <Btn className="mt-2" onClick={async () => setCheck({ ...check, result: (await api<any>('/blacklist/check', { body: { type: check.type, value: check.value } })).listed })}>Проверить</Btn>
          {check.result !== null && <div className={`mt-2 text-[13px] font-semibold ${check.result ? 'text-red' : 'text-green'}`}>{check.result ? 'В ЧЁРНОМ СПИСКЕ' : 'Не найдено'}</div>}
        </div>
      </div>
      <Toolbar><Select value={type} onChange={setType} options={[['', 'Все типы'], ...TYPES]} /></Toolbar>
      <Table head={['Тип', 'Значение (маска)', 'Причина', 'Источник', 'Истекает', 'Добавлен', '']} loading={list.isLoading} empty={list.data?.items.length === 0}>
        {list.data?.items.map((b: any) => (
          <tr key={b.id}>
            <td><Tag className="tag-red">{b.type}</Tag></td>
            <td className="mono">{b.valueMasked}</td>
            <td>{b.reason}</td>
            <td className="muted">{b.source}</td>
            <td className="muted">{b.expiresAt ? dt(b.expiresAt) : 'бессрочно'}</td>
            <td className="muted">{dt(b.createdAt)}</td>
            <td>{can(admin?.role, 'RISK', 'COMPLIANCE') && <Btn size="sm" onClick={() => remove.mutate(b.id)}>Удалить</Btn>}</td>
          </tr>
        ))}
      </Table>
    </Page>
  );
}
