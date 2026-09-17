import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Fingerprint, KeyRound, LogOut, Smartphone, Trash2 } from 'lucide-react';
import { Badge, Button, CodeInput, Header, Pressable, Sheet, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { ago, cn } from '@/lib/format';
import { hapticError, hapticSuccess } from '@/lib/haptics';

export default function Security() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<any[]>('/me/devices') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<any[]>('/me/sessions') });
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState(0);
  const setPinM = useMutation({
    mutationFn: (p: string) => api('/auth/pin', { body: { pin: p } }),
    onSuccess: () => {
      hapticSuccess();
      toast.success('PIN установлен');
      qc.invalidateQueries({ queryKey: ['me'] });
      setPinOpen(false);
      setPin('');
      setPin2('');
    },
    onError: (e: any) => toast.error(e.message),
  });
  const bio = useMutation({ mutationFn: (enabled: boolean) => api('/auth/biometric', { body: { enabled } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  const removeDevice = useMutation({ mutationFn: (id: string) => api(`/me/devices/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }), onError: (e: any) => toast.error(e.message) });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/me/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }) });
  const locked = user?.security.sensitiveOpsLockedUntil;
  const stage = pin.length < 4 ? 1 : 2;
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Безопасность" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        {locked && <div className="warn-card p-3 text-[12px] mb-3">Вход с нового устройства: вывод и отпуск USDT требуют подтверждения до {new Date(locked).toLocaleString('ru-RU')}.</div>}
        <div className="card divide-y line overflow-hidden">
          <Pressable onClick={() => { setPin(''); setPin2(''); setPinOpen(true); }} className="w-full flex items-center gap-3 p-3 press-row" scale={0.99}>
            <KeyRound size={18} className="text-green" />
            <span className="flex-1 text-[14px] font-medium">PIN-код</span>
            <Badge tone={user?.security.pinSet ? 'green' : 'yellow'}>{user?.security.pinSet ? 'Установлен' : 'Не задан'}</Badge>
          </Pressable>
          <div className="flex items-center gap-3 p-3">
            <Fingerprint size={18} className="text-green" />
            <span className="flex-1 text-[14px] font-medium">Face ID / отпечаток</span>
            <Toggle on={!!user?.security.biometricEnabled} onChange={(v) => bio.mutate(v)} />
          </div>
        </div>
        <div className="text-[13px] font-semibold mt-5 mb-2">Устройства</div>
        <div className="card divide-y line">
          {devices.data?.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3">
              <Smartphone size={18} className={cn(d.current ? 'text-green' : 'muted')} />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium truncate">
                  {d.model || d.platform || 'Устройство'} {d.current && <span className="text-green text-[11px]">· это устройство</span>}
                </div>
                <div className="text-[11px] muted">
                  {d.lastIp} · {ago(d.lastSeenAt)}
                </div>
              </div>
              {!d.current && (
                <Pressable onClick={() => removeDevice.mutate(d.id)} className="text-red p-1" scale={0.85}>
                  <Trash2 size={16} />
                </Pressable>
              )}
            </div>
          ))}
        </div>
        <div className="text-[13px] font-semibold mt-5 mb-2">Активные сессии</div>
        <div className="card divide-y line">
          {sessions.data?.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate">
                  {s.device?.model || 'Web'} · {s.ip} {s.current && <span className="text-green text-[11px]">· текущая</span>}
                </div>
                <div className="text-[11px] muted truncate">{s.userAgent}</div>
              </div>
              {!s.current && (
                <Pressable onClick={() => revoke.mutate(s.id)} className="text-[12px] text-red" scale={0.9}>
                  Завершить
                </Pressable>
              )}
            </div>
          ))}
        </div>
        <Button
          variant="danger"
          className="mt-5"
          onClick={async () => {
            await api('/auth/logout-all', { method: 'POST' });
            toast.success('Все остальные сессии завершены');
            qc.invalidateQueries({ queryKey: ['sessions'] });
          }}
        >
          <LogOut size={16} /> Завершить все другие сессии
        </Button>
      </div>
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={stage === 1 ? 'Новый PIN-код' : 'Повторите PIN-код'}>
        <div className="text-[12px] muted mb-4">4 цифры. Нужен для отпуска USDT и вывода.</div>
        {stage === 1 ? (
          <CodeInput key="p1" length={4} value={pin} onChange={setPin} secret error={err} />
        ) : (
          <CodeInput
            key="p2"
            length={4}
            value={pin2}
            onChange={setPin2}
            secret
            error={err}
            onComplete={(v) => {
              if (v === pin) setPinM.mutate(pin);
              else {
                hapticError();
                setErr((x) => x + 1);
                toast.error('PIN-коды не совпадают');
                setPin('');
                setPin2('');
              }
            }}
          />
        )}
        <div className="h-24" />
      </Sheet>
    </div>
  );
}
