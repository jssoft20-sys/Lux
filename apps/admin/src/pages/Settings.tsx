import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Plug } from 'lucide-react';
import { api } from '@/lib/api';
import { Btn, Page } from '@/components/ui';
import { cn } from '@/lib/format';

const TESTS: Record<string, { service: string; label: string; needsTo?: string }> = {
  whatsapp: { service: 'wappi', label: 'Проверить Wappi', needsTo: 'Номер для тестового сообщения (+996…)' },
  smtp: { service: 'smtp', label: 'Проверить SMTP', needsTo: 'Email для тестового письма' },
  kyc: { service: 'didit', label: 'Проверить Didit' },
  blockchain: { service: 'tron', label: 'Проверить TronGrid' },
  files: { service: 'clamav', label: 'Проверить ClamAV' },
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<any>('/settings') });
  const [group, setGroup] = useState('general');
  const [values, setValues] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  useEffect(() => setValues({}), [group]);
  const save = useMutation({ mutationFn: () => api('/settings', { method: 'PUT', body: { values } }), onSuccess: () => { toast.success('Сохранено'); setValues({}); qc.invalidateQueries({ queryKey: ['settings'] }); }, onError: (e: any) => toast.error(e.message) });
  const test = useMutation({ mutationFn: (service: string) => api(`/settings/test/${service}`, { body: { to: testTo || undefined } }), onSuccess: (r) => setTestResult(r), onError: (e: any) => toast.error(e.message) });
  const items = (q.data?.items ?? []).filter((i: any) => i.group === group);
  const groups: Record<string, { label: string; description: string }> = q.data?.groups ?? {};
  const t = TESTS[group];
  return (
    <Page title="Настройки" subtitle="Хранятся в базе и применяются без перезапуска. Секреты шифруются AES-256-GCM и не возвращаются наружу." actions={<span className={cn('tag', q.data?.env === 'production' ? 'tag-green' : 'tag-yellow')}>{q.data?.env}{q.data?.chainSimulated ? ' · chain simulated' : ''}</span>}>
      <div className="flex gap-4">
        <div className="w-[220px] shrink-0 flex flex-col gap-1">
          {Object.entries(groups).map(([k, g]) => (
            <button key={k} onClick={() => setGroup(k)} className={cn('nav-item text-left', group === k && 'active')}>
              <div><div>{g.label}</div><div className="text-[10px] muted font-normal">{g.description}</div></div>
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="card p-4">
            <div className="grid xl:grid-cols-2 gap-x-6 gap-y-3">
              {items.map((i: any) => (
                <label key={i.key} className={cn('block', i.type === 'text' && 'xl:col-span-2')}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[12px] font-medium">{i.label}</span>
                    <span className={cn('tag', i.source === 'db' ? 'tag-green' : i.source === 'env' ? 'tag-blue' : 'tag-gray')}>{i.source}</span>
                    {i.secret && <span className="tag tag-purple">secret</span>}
                    {i.secret && !i.configured && <span className="tag tag-red">не настроен</span>}
                  </div>
                  {i.type === 'boolean' ? (
                    <select value={values[i.key] ?? i.value} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })} className="input w-full"><option value="true">Включено</option><option value="false">Выключено</option></select>
                  ) : i.type === 'select' ? (
                    <select value={values[i.key] ?? i.value} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })} className="input w-full">{i.options.map((o: string) => <option key={o}>{o}</option>)}</select>
                  ) : i.type === 'text' ? (
                    <textarea value={values[i.key] ?? i.value} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })} rows={2} className="input w-full !h-auto py-2" />
                  ) : (
                    <input type={i.secret ? 'password' : i.type === 'number' ? 'number' : 'text'} value={values[i.key] ?? (i.secret ? '' : i.value)} placeholder={i.secret ? i.value || '•••• введите новое значение' : ''} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })} className="input w-full mono" />
                  )}
                  {i.description && <div className="text-[11px] muted mt-1">{i.description}</div>}
                  {i.key.startsWith('wallet.withdrawals_frozen') && (values[i.key] ?? i.value) === 'true' && <div className="text-[11px] text-red mt-1">⚠ Все выводы остановлены</div>}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-5">
              <Btn variant="green" loading={save.isPending} disabled={!Object.keys(values).length} onClick={() => save.mutate()}>Сохранить ({Object.keys(values).length})</Btn>
              {Object.keys(values).length > 0 && <Btn onClick={() => setValues({})}>Сбросить</Btn>}
              {t && (
                <div className="ml-auto flex items-center gap-2">
                  {t.needsTo && <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={t.needsTo} className="input w-[260px]" />}
                  <Btn loading={test.isPending} onClick={() => test.mutate(t.service)}><Plug size={14} /> {t.label}</Btn>
                </div>
              )}
            </div>
            {testResult && (
              <div className={cn('mt-3 p-3 rounded-lg text-[12px] flex gap-2', testResult.ok ? 'bg-green/10 text-green' : 'bg-red/10 text-red')}>
                {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                <pre className="whitespace-pre-wrap break-all font-mono">{typeof testResult.detail === 'string' ? testResult.detail : JSON.stringify(testResult.detail, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
