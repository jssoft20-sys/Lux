import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { BadgeCheck, Camera, FileText, ScanFace, ShieldCheck } from 'lucide-react';
import { Button, Header, Spinner } from '@/components/ui';
import { api } from '@/lib/api';

export default function Kyc({ callback = false }: { callback?: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['kyc'], queryFn: () => api<any>('/kyc/status'), refetchInterval: (q) => (['IN_PROGRESS', 'IN_REVIEW'].includes(q.state.data?.status) ? 5000 : false) });
  const [sandbox, setSandbox] = useState<{ fullName: string; documentNumber: string; dateOfBirth: string }>({ fullName: '', documentNumber: '', dateOfBirth: '' });
  const [sandboxOpen, setSandboxOpen] = useState(false);

  useEffect(() => {
    if (callback) api('/kyc/refresh', { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['kyc'] })).catch(() => undefined);
  }, [callback, qc]);

  const start = useMutation({
    mutationFn: () => api<any>('/kyc/session', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.mode === 'didit' && r.url) window.open(r.url, '_blank');
      if (r.mode === 'sandbox') setSandboxOpen(true);
      qc.invalidateQueries({ queryKey: ['kyc'] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const complete = useMutation({
    mutationFn: () => api<any>('/kyc/sandbox/complete', { body: sandbox }),
    onSuccess: () => {
      toast.success('Верификация пройдена');
      qc.invalidateQueries({ queryKey: ['kyc'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      setSandboxOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const d = status.data;
  const approved = d?.status === 'APPROVED';
  const steps = [
    { icon: FileText, t: 'Документ', s: 'Паспорт или ID-карта КР' },
    { icon: Camera, t: 'Селфи', s: 'Сравнение с фото документа' },
    { icon: ScanFace, t: 'Liveness', s: 'Проверка, что вы живой человек' },
    { icon: ShieldCheck, t: 'Проверка', s: 'Списки, возраст, дубликаты' },
  ];

  return (
    <div className="h-full theme-dark screen flex flex-col">
      <Header title="Верификация (KYC)" subtitle="Один раз — и все возможности открыты" onBack={() => nav(-1)} />
      <div className="px-4 pb-8 flex-1 overflow-y-auto hide-scroll">
        {status.isLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {d && (
          <>
            <div className="card p-4 flex items-center gap-3">
              <span className={`w-12 h-12 rounded-full flex items-center justify-center ${approved ? 'bg-green/20 text-green' : 'bg-yellow/20 text-yellow'}`}>
                <BadgeCheck size={26} />
              </span>
              <div className="flex-1">
                <div className="font-bold">{approved ? 'Проверенный пользователь' : d.status === 'IN_REVIEW' ? 'Документы на проверке' : d.status === 'IN_PROGRESS' ? 'Верификация начата' : d.status === 'DECLINED' ? 'Не пройдена' : 'Не пройдена'}</div>
                <div className="text-[12px] muted">
                  Уровень: <span className="text-green font-semibold">{d.level}</span>
                  {d.fullName ? ` · ${d.fullName}` : ''}
                </div>
                {d.verification?.declineReason && <div className="text-[12px] text-red mt-1">{d.verification.declineReason}</div>}
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {d.levels.map((l: any) => (
                <div key={l.code} className={`card p-3 flex items-center gap-3 ${d.level === l.code ? 'border-green' : ''}`}>
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-lg ${d.level === l.code ? 'bg-green text-[#06240f]' : 'status-gray'}`}>{l.title}</span>
                  <span className="text-[12px] muted">{l.description}</span>
                </div>
              ))}
            </div>
            {!approved && (
              <>
                <div className="mt-5 text-[13px] font-semibold muted">Как это проходит</div>
                <div className="mt-2 flex flex-col gap-2">
                  {steps.map((s, i) => (
                    <motion.div key={s.t} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="flex items-center gap-3 card2 p-3">
                      <span className="w-9 h-9 rounded-xl bg-green/15 text-green flex items-center justify-center">
                        <s.icon size={18} />
                      </span>
                      <div>
                        <div className="text-[14px] font-semibold">{s.t}</div>
                        <div className="text-[12px] muted">{s.s}</div>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <div className="info-card p-3 mt-4 text-[12px]">ФИО из документа станет вашим именем для всех банковских переводов. Оплата возможна только со счетов на это имя.</div>
                {d.status !== 'IN_REVIEW' && (
                  <Button className="mt-5" loading={start.isPending} onClick={() => start.mutate()}>
                    {d.status === 'IN_PROGRESS' && d.verification?.url ? 'Продолжить верификацию' : 'Начать верификацию'}
                  </Button>
                )}
                {d.provider === 'sandbox' && !sandboxOpen && d.status === 'IN_PROGRESS' && (
                  <Button variant="ghost" className="mt-2" onClick={() => setSandboxOpen(true)}>
                    Открыть форму (sandbox)
                  </Button>
                )}
              </>
            )}
            {approved && (
              <Button className="mt-6" onClick={() => nav('/')}>
                К сделкам
              </Button>
            )}
            {sandboxOpen && (
              <div className="card p-4 mt-4">
                <div className="font-bold">Sandbox-верификация</div>
                <div className="text-[12px] muted mb-3">Didit не настроен — режим разработки. Введите данные как в документе.</div>
                <input className="input w-full h-12 px-3 mb-2" placeholder="ФИО как в паспорте (Фамилия Имя Отчество)" value={sandbox.fullName} onChange={(e) => setSandbox({ ...sandbox, fullName: e.target.value })} />
                <input className="input w-full h-12 px-3 mb-2" placeholder="Номер документа (ID1234567)" value={sandbox.documentNumber} onChange={(e) => setSandbox({ ...sandbox, documentNumber: e.target.value })} />
                <input className="input w-full h-12 px-3 mb-3" type="date" value={sandbox.dateOfBirth} onChange={(e) => setSandbox({ ...sandbox, dateOfBirth: e.target.value })} />
                <Button loading={complete.isPending} onClick={() => complete.mutate()} disabled={!sandbox.fullName || !sandbox.documentNumber || !sandbox.dateOfBirth}>
                  Завершить проверку
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
