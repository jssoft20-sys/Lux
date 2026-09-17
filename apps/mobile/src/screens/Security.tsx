import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Fingerprint, KeyRound, LogOut, Smartphone, Trash2 } from 'lucide-react';
import { Badge, Button, Header, Sheet, Toggle } from '@/components/ui';
import { Keypad } from '@/components/Keypad';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { ago, cn } from '@/lib/format';

export default function Security() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user, logout } = useAuth();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<any[]>('/me/devices') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<any[]>('/me/sessions') });
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const setPinM = useMutation({
    mutationFn: (p: string) => api('/auth/pin', { body: { pin: p } }),
    onSuccess: () => {
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
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Безопасность" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        {locked && <div className="warn-card p-3 text-[12px] mb-3">Вход с нового устройства: вывод и отпуск USDT требуют дополнительного подтверждения до {new Date(locked).toLocaleString('ru-RU')}.</div>}
        <div className="card divide-y line">
          <button onClick={() => setPinOpen(true)} className="w-full flex items-center gap-3 p-3 text-left">
            <KeyRound size={18} className="text-green" />
            <span className="flex-1 text-[14px] font-medium">PIN-код для отпуска USDT и вывода</span>
            <Badge tone={user?.security.pinSet ? 'green' : 'yellow'}>{user?.security.pinSet ? 'Установлен' : 'Не задан'}</Badge>
          </button>
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
                  {d.lastIp} · {ago(d.lastSeenAt)} {d.trusted ? '· доверенное' : ''}
                </div>
              </div>
              {!d.current && (
                <button onClick={() => removeDevice.mutate(d.id)} className="text-red">
                  <Trash2 size={16} />
                </button>
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
                <button onClick={() => revoke.mutate(s.id)} className="text-[12px] text-red">
                  Завершить
                </button>
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
      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title={pin.length < 4 ? 'Новый PIN-код' : 'Повторите PIN-код'}>
        <div className="flex justify-center gap-3 my-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className={cn('w-4 h-4 rounded-full border-2', (pin.length < 4 ? pin : pin2).length > i ? 'bg-green border-green' : 'line')} />
          ))}
        </div>
        <Keypad
          light={false}
          onKey={(k) => {
            if (pin.length < 4) setPin(pin + k);
            else {
              const p2 = (pin2 + k).slice(0, 4);
              setPin2(p2);
              if (p2.length === 4) {
                if (p2 === pin) setPinM.mutate(pin);
                else {
                  toast.error('PIN-коды не совпадают');
                  setPin('');
                  setPin2('');
                }
              }
            }
          }}
          onDelete={() => (pin.length < 4 ? setPin(pin.slice(0, -1)) : setPin2(pin2.slice(0, -1)))}
        />
      </Sheet>
    </div>
  );
}
