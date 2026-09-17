import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Page, Stat } from '@/components/ui';

export default function SystemPage() {
  const q = useQuery({ queryKey: ['system'], queryFn: () => api<any>('/system'), refetchInterval: 30_000 });
  const d = q.data;
  const ok = (v: boolean) => (v ? <span className="text-green flex items-center gap-1"><CheckCircle2 size={14} /> ok</span> : <span className="text-red flex items-center gap-1"><XCircle size={14} /> нет</span>);
  return (
    <Page title="Система" subtitle="Состояние интеграций и окружения">
      {d && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="card p-4">
            <div className="text-[12px] font-semibold mb-1">Окружение</div>
            <Stat l="NODE_ENV" v={d.env} />
            <Stat l="Node" v={d.node} />
            <Stat l="Uptime" v={`${Math.floor(d.uptimeSec / 60)} мин`} />
            <Stat l="Блокчейн симулируется" v={d.chainSimulated ? 'да (DEV)' : 'нет'} />
            <Stat l="OTP dev echo" v={d.otpDevEcho ? 'да (DEV)' : 'нет'} />
          </div>
          <div className="card p-4">
            <div className="text-[12px] font-semibold mb-1">Интеграции</div>
            <Stat l="Wappi (WhatsApp)" v={ok(d.wappiConfigured)} />
            <Stat l="SMTP" v={ok(d.smtpConfigured)} />
            <Stat l="Didit (KYC)" v={ok(d.diditConfigured)} />
            <Stat l="TronGrid" v={<span>{ok(d.tron.ok)} <span className="muted text-[11px]">{String(d.tron.detail)}</span></span>} />
            <Stat l="ClamAV" v={<span>{ok(d.clamav.ok)} <span className="muted text-[11px]">{String(d.clamav.detail).slice(0, 60)}</span></span>} />
            <Stat l="Хранилище" v={<span>{ok(d.storage.ok)} <span className="muted text-[11px]">{d.storage.detail}</span></span>} />
          </div>
        </div>
      )}
    </Page>
  );
}
