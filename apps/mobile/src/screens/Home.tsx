import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, ChevronDown, Clock, History as HistoryIcon, Plus, ArrowUpRight, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { Avatar, BankLogo, Button, Skeleton, Sheet, Toggle, Pressable } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useBanks, useRate } from '@/hooks/useProfile';
import { fmt, cn } from '@/lib/format';
import { REGIONS } from '@somex/shared';

interface Filters {
  bank?: string;
  region?: string;
  amount?: string;
  priceMin?: string;
  priceMax?: string;
  online?: boolean;
  verifiedOnly: boolean;
}

function TetherIcon() {
  return (
    <div className="w-14 h-14 rounded-2xl bg-green/15 border border-green/40 flex items-center justify-center green-glow">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
        <path d="M12 2 3 6.5v2L12 13l9-4.5v-2L12 2z" fill="#22C55E" opacity=".35" />
        <path d="M6 6h12v3h-4.2v1.4c3 .2 5.2.9 5.2 1.7s-2.2 1.5-5.2 1.7V21h-3.6v-7.2c-3-.2-5.2-.9-5.2-1.7s2.2-1.5 5.2-1.7V9H6V6zm4.2 6.9c-2.4-.1-4-.6-4-1s1.6-.9 4-1v-1c-2.3.1-4.4.5-4.4 1s2.1.9 4.4 1v1zm3.6 0v-1c2.3-.1 4.4-.5 4.4-1s-2.1-.9-4.4-1v1c2.4.1 4 .6 4 1s-1.6.9-4 1z" fill="#22C55E" />
      </svg>
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const side = (params.get('side') as 'BUY' | 'SELL') || 'BUY';
  const [filters, setFilters] = useState<Filters>({ verifiedOnly: true });
  const [draft, setDraft] = useState<Filters>(filters);
  const [open, setOpen] = useState(false);
  const banks = useBanks();
  const rate = useRate();
  const unreadN = useQuery({ queryKey: ['notif-unread'], queryFn: () => api<any>('/me/notifications?limit=1'), refetchInterval: 30_000 });

  const q = useMemo(() => {
    const p = new URLSearchParams({ side });
    if (filters.bank) p.set('bank', filters.bank);
    if (filters.region && filters.region !== 'ALL') p.set('region', filters.region);
    if (filters.amount) p.set('amount', filters.amount.replace(/\s/g, ''));
    if (filters.priceMin) p.set('priceMin', filters.priceMin);
    if (filters.priceMax) p.set('priceMax', filters.priceMax);
    if (filters.online) p.set('online', '1');
    return p.toString();
  }, [side, filters]);
  const ads = useQuery({ queryKey: ['ads', q], queryFn: () => api<any>(`/p2p/ads?${q}`), refetchInterval: 15_000 });
  useEffect(() => setDraft(filters), [open, filters]);

  const available = Number(user?.balance.available ?? 0);
  const kgsValue = rate.data ? available * Number(rate.data.price) : null;
  const activeFilters = [filters.bank, filters.region && filters.region !== 'ALL' ? filters.region : null, filters.amount, filters.online].filter(Boolean).length;

  return (
    <div className="h-full theme-dark screen flex flex-col">
      <div className="safe-top px-4 pb-2 flex items-center gap-2">
        <LogoMark size={30} />
        <span className="text-[19px] font-extrabold tracking-tight">Somex</span>
        <div className="ml-auto flex items-center gap-1">
          <Pressable onClick={() => setOpen(true)} className="relative w-10 h-10 rounded-full flex items-center justify-center" scale={0.85}>
            <SlidersHorizontal size={20} />
            {activeFilters > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green" />}
          </Pressable>
          <Pressable onClick={() => nav('/notifications')} className="relative w-10 h-10 rounded-full flex items-center justify-center" scale={0.85}>
            <Bell size={20} />
            {!!unreadN.data?.unread && <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red text-white text-[10px] font-bold flex items-center justify-center">{unreadN.data.unread}</span>}
          </Pressable>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto hide-scroll pb-28">
        {/* balance */}
        <div className="mx-4 card p-4">
          <div className="flex items-center gap-3">
            <TetherIcon />
            <div>
              <div className="text-[12px] muted">Мой баланс</div>
              <div className="text-[24px] font-extrabold number-mono leading-tight">
                <CountUp value={available} /> <span className="text-[16px] font-bold">USDT</span>
              </div>
              <div className="text-[12px] muted number-mono">{kgsValue !== null ? `≈ ${fmt(kgsValue, 0)} KGS` : '—'}</div>
              {Number(user?.balance.locked ?? 0) > 0 && <div className="text-[11px] text-yellow mt-0.5">🔒 {fmt(user?.balance.locked, 2)} USDT в эскроу</div>}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { l: 'Пополнить', i: Plus, to: '/wallet/deposit' },
              { l: 'Вывести', i: ArrowUpRight, to: '/wallet/withdraw' },
              { l: 'История', i: HistoryIcon, to: '/wallet/history' },
            ].map((a) => (
              <Pressable key={a.l} onClick={() => nav(a.to)} className="card2 h-[58px] flex flex-col items-center justify-center gap-1" scale={0.94}>
                <a.i size={18} />
                <span className="text-[11px] font-medium">{a.l}</span>
              </Pressable>
            ))}
          </div>
        </div>

        {/* buy/sell */}
        <div className="mx-4 mt-4 card2 p-1 flex relative">
          {(['BUY', 'SELL'] as const).map((s) => (
            <button key={s} onClick={() => setParams({ side: s })} className={cn('relative flex-1 h-10 rounded-xl text-[14px] font-semibold transition-colors z-10', side === s ? 'text-[#06240f]' : 'muted')}>
              {side === s && <motion.span layoutId="side-pill" className="absolute inset-0 rounded-xl bg-green" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <span className="relative">{s === 'BUY' ? 'Купить USDT' : 'Продать'}</span>
            </button>
          ))}
        </div>

        {/* filter chips */}
        <div className="px-4 mt-3 flex gap-2 overflow-x-auto hide-scroll">
          {[
            { l: filters.amount ? `${fmt(filters.amount, 0)} KGS` : 'Сумма', on: !!filters.amount },
            { l: filters.bank ? (banks.data?.find((b: any) => b.code === filters.bank)?.shortName ?? filters.bank) : 'Банк', on: !!filters.bank },
            { l: REGIONS.find((r) => r.code === (filters.region || 'ALL'))?.name ?? 'Все регионы', on: !!filters.region && filters.region !== 'ALL' },
          ].map((c) => (
            <button key={c.l} onClick={() => setOpen(true)} className={cn('chip shrink-0 h-9 px-3 rounded-xl text-[13px] font-medium flex items-center gap-1', c.on && 'chip-on')}>
              {c.l} <ChevronDown size={14} />
            </button>
          ))}
        </div>

        {/* list */}
        <div className="px-4 mt-3">
          <div className="grid grid-cols-[1fr_88px_92px] text-[11px] muted px-1">
            <span>{side === 'BUY' ? 'Продавец' : 'Покупатель'}</span>
            <span>Цена</span>
            <span>Лимиты</span>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {ads.isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[64px]" />)}
            <AnimatePresence initial={false}>
              {ads.data?.items?.map((ad: any, i: number) => (
                <motion.div key={ad.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.985 }} transition={{ delay: Math.min(i * 0.03, 0.3) }} onClick={() => nav(`/ads/${ad.id}/order`)} className="card p-3 grid grid-cols-[1fr_88px_92px] items-center cursor-pointer">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative">
                      <Avatar name={ad.advertiser.name} size={38} />
                      {ad.advertiser.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green border-2 border-[#141c19]" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate flex items-center gap-1">
                        {ad.advertiser.name}
                        {ad.advertiser.verified && <ShieldCheck size={12} className="text-green shrink-0" />}
                      </div>
                      <div className="text-[11px] muted number-mono">
                        <span className="text-green">●</span> {ad.advertiser.completionRate}% | {fmt(ad.advertiser.completedOrders, 0)}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <BankLogo code={ad.bank?.code ?? ad.bankCode} logo={ad.bank?.logo} color={ad.bank?.color} size={14} />
                        <span className="text-[11px] muted truncate">{ad.bank?.shortName ?? ad.bankCode}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-[14px] font-bold number-mono">
                    {fmt(ad.price, 2)} <span className="text-[10px] font-medium muted">KGS</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[11px] muted number-mono">{ad.limitsLabel}</span>
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); nav(`/ads/${ad.id}/order`); }} className="!h-8 !px-4 !w-auto">
                      {side === 'BUY' ? 'Купить' : 'Продать'}
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {ads.data && ads.data.items.length === 0 && (
              <div className="card p-6 text-center">
                <div className="font-semibold">Нет предложений</div>
                <div className="text-[12px] muted mt-1">Измените фильтры или разместите своё объявление</div>
                <Button size="md" variant="soft" className="mt-3 mx-auto" onClick={() => nav('/ads/new')}>
                  Разместить объявление
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <Sheet open onClose={() => setOpen(false)} theme="light">
            <FiltersPanel draft={draft} setDraft={setDraft} banks={banks.data ?? []} count={ads.data?.total} onReset={() => setDraft({ verifiedOnly: true })} onApply={() => { setFilters(draft); setOpen(false); }} />
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  );
}

function CountUp({ value }: { value: number }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const from = v;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 600);
      setV(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{fmt(v, 2)}</>;
}

function FiltersPanel({ draft, setDraft, banks, count, onReset, onApply }: { draft: Filters; setDraft: (f: Filters) => void; banks: any[]; count?: number; onReset: () => void; onApply: () => void }) {
  const Field = ({ label, k, placeholder }: { label: string; k: keyof Filters; placeholder: string }) => (
    <label className="flex-1 input h-11 flex items-center px-3 gap-2">
      <span className="text-[12px] muted">{label}</span>
      <input inputMode="numeric" value={(draft[k] as string) || ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/[^\d]/g, '') })} placeholder={placeholder} className="bg-transparent outline-none w-full text-[16px] font-semibold number-mono" />
    </label>
  );
  return (
    <div className="pt-1">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[22px] font-extrabold">Фильтры</div>
        <button onClick={onReset} className="chip px-3 h-8 text-[12px] font-semibold bg-white">Сбросить</button>
      </div>
      <div className="text-[13px] font-semibold mb-2">Банк (приём/отправка)</div>
      <div className="grid grid-cols-2 gap-2">
        {banks.slice(0, 6).map((b: any) => (
          <button key={b.code} onClick={() => setDraft({ ...draft, bank: draft.bank === b.code ? undefined : b.code })} className={cn('h-11 rounded-xl border flex items-center gap-2 px-3 text-[13px] font-semibold bg-white', draft.bank === b.code ? 'border-green bg-green/10 text-green' : 'border-[#e3e8e5]')}>
            <BankLogo code={b.code} logo={b.logo} color={b.color} size={22} />
            <span className="truncate">{b.shortName}</span>
          </button>
        ))}
      </div>
      <div className="text-[13px] font-semibold mt-4 mb-2">Сумма сделки (KGS)</div>
      <div className="flex gap-2">
        <Field label="От" k="amount" placeholder="5 000" />
        <label className="flex-1 input h-11 flex items-center px-3 gap-2 opacity-70">
          <span className="text-[12px] muted">До</span>
          <span className="text-[14px] font-semibold number-mono">500 000</span>
        </label>
      </div>
      <div className="text-[13px] font-semibold mt-4 mb-2">Цена за 1 USDT (KGS)</div>
      <div className="flex gap-2">
        <Field label="От" k="priceMin" placeholder="85" />
        <Field label="До" k="priceMax" placeholder="95" />
      </div>
      <div className="text-[13px] font-semibold mt-4 mb-2">Регион продавца</div>
      <div className="input h-11 flex items-center px-3">
        <select value={draft.region || 'ALL'} onChange={(e) => setDraft({ ...draft, region: e.target.value })} className="bg-transparent w-full outline-none text-[16px] font-medium">
          {REGIONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {[
          { l: 'Только проверенные', v: true, k: 'verifiedOnly' as const, locked: true },
          { l: 'Онлайн сейчас', v: !!draft.online, k: 'online' as const },
          { l: draft.bank ? `Показать только с ${banks.find((b: any) => b.code === draft.bank)?.shortName}` : 'Показать только с моим банком', v: !!draft.bank, k: 'bank' as const },
        ].map((t) => (
          <div key={t.l} className="flex items-center justify-between">
            <span className="text-[14px]">{t.l}</span>
            <Toggle on={t.v} disabled={t.locked} onChange={(v) => setDraft({ ...draft, [t.k]: t.k === 'bank' ? (v ? draft.bank : undefined) : v })} />
          </div>
        ))}
      </div>
      <Button className="mt-5" onClick={onApply}>
        Показать {count ?? ''} {count ? 'предложения' : 'предложения'}
      </Button>
    </div>
  );
}
