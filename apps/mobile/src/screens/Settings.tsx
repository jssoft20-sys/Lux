import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Header } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useState } from 'react';
import { cn } from '@/lib/format';

export default function Settings() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [nick, setNick] = useState(user?.nickname ?? '');
  const save = useMutation({
    mutationFn: (body: any) => api('/me', { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('Сохранено');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Настройки" />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        <div className="text-[13px] font-semibold mb-2">Публичное имя в P2P</div>
        <div className="flex gap-2">
          <input value={nick} onChange={(e) => setNick(e.target.value)} className="input flex-1 h-11 px-3 text-[16px]" placeholder="Например: AltynTrade" />
          <button onClick={() => save.mutate({ nickname: nick })} className="btn-green px-4 rounded-xl font-semibold text-[13px]">
            Сохранить
          </button>
        </div>
        <div className="text-[13px] font-semibold mt-5 mb-2">Язык</div>
        <div className="card2 p-1 flex">
          {[
            ['ru', 'Русский'],
            ['ky', 'Кыргызча'],
            ['en', 'English'],
          ].map(([code, l]) => (
            <button key={code} onClick={() => save.mutate({ language: code })} className={cn('flex-1 h-9 rounded-xl text-[13px] font-semibold', user?.language === code ? 'tab-active' : 'muted')}>
              {l}
            </button>
          ))}
        </div>
        <div className="card p-3 mt-5 text-[12px] muted flex flex-col gap-1">
          <div>Somex v1.0.0</div>
          <div>Аккаунт создан: {user ? new Date(user.createdAt).toLocaleDateString('ru-RU') : ''}</div>
          <div>ID: {user?.id}</div>
        </div>
        <div className="mt-4 flex flex-col gap-2 text-[13px]">
          <a className="card p-3" href="#">Правила сделок</a>
          <a className="card p-3" href="#">Политика безопасности</a>
          <a className="card p-3" href="#">Политика конфиденциальности</a>
        </div>
      </div>
    </div>
  );
}
