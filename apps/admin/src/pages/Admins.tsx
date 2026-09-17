import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Btn, Field, Modal, Page, Table, Tag } from '@/components/ui';
import { dt } from '@/lib/format';

const ROLES = ['SUPERADMIN', 'COMPLIANCE', 'FINANCE', 'RISK', 'SUPPORT', 'VIEWER'];
const ROLE_DESC: Record<string, string> = { SUPERADMIN: 'Всё, включая настройки и администраторов', COMPLIANCE: 'KYC, AML, споры, заморозки, чёрный список', FINANCE: 'Выводы, депозиты, hot wallet, корректировки, курс', RISK: 'Risk engine, устройства, чёрный список, заморозки', SUPPORT: 'Тикеты, заморозка, сессии, объявления', VIEWER: 'Только чтение' };

export default function AdminsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admins'], queryFn: () => api<any[]>('/admins') });
  const [form, setForm] = useState<any>(null);
  const save = useMutation({ mutationFn: () => (form.id ? api(`/admins/${form.id}`, { method: 'PUT', body: { name: form.name, role: form.role, status: form.status, ipAllowlist: form.ipAllowlist, password: form.password || undefined } }) : api('/admins', { body: { email: form.email, name: form.name, role: form.role, password: form.password, ipAllowlist: form.ipAllowlist } })), onSuccess: () => { toast.success('Сохранено'); qc.invalidateQueries({ queryKey: ['admins'] }); setForm(null); }, onError: (e: any) => toast.error(e.message) });
  const resetTotp = useMutation({ mutationFn: (id: string) => api(`/admins/${id}/reset-totp`, { body: {} }), onSuccess: () => { toast.success('2FA сброшен, потребуется новая настройка'); qc.invalidateQueries({ queryKey: ['admins'] }); } });
  return (
    <Page title="Администраторы и роли" subtitle="Каждому администратору — минимально необходимая роль. 2FA обязателен, IP allowlist по желанию." actions={<Btn variant="green" onClick={() => setForm({ email: '', name: '', role: 'VIEWER', password: '', ipAllowlist: [] })}>+ Добавить</Btn>}>
      <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-2 mb-4">
        {ROLES.map((r) => <div key={r} className="card p-3"><Tag v={r === 'SUPERADMIN' ? 'ADVANCED' : 'VERIFIED'}>{r}</Tag><div className="text-[11px] muted mt-1">{ROLE_DESC[r]}</div></div>)}
      </div>
      <Table head={['Имя', 'Email', 'Роль', 'Статус', '2FA', 'IP allowlist', 'Последний вход', '']} loading={list.isLoading}>
        {list.data?.map((a) => (
          <tr key={a.id}>
            <td className="font-semibold">{a.name}</td>
            <td className="mono">{a.email}</td>
            <td><Tag className={a.role === 'SUPERADMIN' ? 'tag-purple' : 'tag-blue'}>{a.role}</Tag></td>
            <td><Tag v={a.status === 'ACTIVE' ? 'ACTIVE' : 'BANNED'}>{a.status}</Tag></td>
            <td>{a.totpEnabled ? <Tag className="tag-green">включён</Tag> : <Tag className="tag-yellow">не настроен</Tag>}</td>
            <td className="mono muted">{a.ipAllowlist.join(', ') || 'любой'}</td>
            <td className="muted">{dt(a.lastLoginAt)}</td>
            <td><div className="flex gap-1"><Btn size="sm" onClick={() => setForm({ ...a, password: '' })}>Изменить</Btn><Btn size="sm" variant="yellow" onClick={() => resetTotp.mutate(a.id)}>Сбросить 2FA</Btn></div></td>
          </tr>
        ))}
      </Table>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Изменить администратора' : 'Новый администратор'}>
        {form && (
          <div className="grid grid-cols-2 gap-3">
            {!form.id && <Field label="Email" className="col-span-2"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input w-full" /></Field>}
            <Field label="Имя"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" /></Field>
            <Field label="Роль"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input w-full">{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
            {form.id && <Field label="Статус"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input w-full"><option>ACTIVE</option><option>DISABLED</option></select></Field>}
            <Field label={form.id ? 'Новый пароль (опц., ≥12)' : 'Пароль (≥12 символов)'}><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input w-full" /></Field>
            <Field label="IP allowlist (через запятую, CIDR)" className="col-span-2"><input value={form.ipAllowlist.join(', ')} onChange={(e) => setForm({ ...form, ipAllowlist: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} className="input w-full mono" /></Field>
            <div className="col-span-2 flex justify-end gap-2"><Btn onClick={() => setForm(null)}>Отмена</Btn><Btn variant="green" loading={save.isPending} onClick={() => save.mutate()}>Сохранить</Btn></div>
          </div>
        )}
      </Modal>
    </Page>
  );
}
