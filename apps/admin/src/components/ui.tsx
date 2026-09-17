import { ReactNode, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn, TONE } from '@/lib/format';

export function Tag({ v, children, className }: { v?: string; children?: ReactNode; className?: string }) {
  return <span className={cn('tag', TONE[v ?? ''] ?? 'tag-gray', className)}>{children ?? v}</span>;
}

export function Btn({ children, variant = 'ghost', size, loading, className, ...rest }: { children: ReactNode; variant?: 'green' | 'ghost' | 'red' | 'yellow'; size?: 'sm'; loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : children}
    </button>
  );
}

export function Page({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="p-6 max-w-[1500px]">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">{title}</h1>
          {subtitle && <div className="text-[13px] muted mt-0.5">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, tone, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'green' | 'red' | 'yellow' | 'blue'; onClick?: () => void }) {
  const c = { green: 'text-green', red: 'text-red', yellow: 'text-yellow', blue: 'text-blue' };
  return (
    <button onClick={onClick} className={cn('kpi text-left w-full', onClick && 'hover:border-green/50 transition')}>
      <div className="text-[11px] muted uppercase tracking-wide font-semibold">{label}</div>
      <div className={cn('text-[26px] font-extrabold mt-1 mono-num', tone && c[tone])}>{value}</div>
      {sub && <div className="text-[12px] muted mt-1">{sub}</div>}
    </button>
  );
}

export function Drawer({ open, onClose, title, children, width }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overlay" onClick={onClose} />
          <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.18 }} className="drawer" style={width ? { width: `min(${width}px, 100%)` } : undefined}>
            <div className="sticky top-0 bg-[#0e1412]/95 backdrop-blur border-b border-[#1f2a26] px-5 py-3 flex items-center justify-between z-10">
              <div className="font-bold text-[15px]">{title}</div>
              <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#18211e] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overlay" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(520px,94vw)] card p-5">
            <div className="font-bold text-[15px] mb-3">{title}</div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Confirmation dialog with a mandatory reason — every destructive admin action goes through this. */
export function ReasonDialog({ open, onClose, title, label = 'Причина (попадёт в аудит)', confirmText = 'Подтвердить', variant = 'red', onConfirm, min = 3, children }: { open: boolean; onClose: () => void; title: string; label?: string; confirmText?: string; variant?: 'red' | 'green' | 'yellow'; onConfirm: (reason: string) => Promise<unknown> | void; min?: number; children?: ReactNode }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {children}
      <label className="block text-[12px] muted mb-1">{label}</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input w-full !h-auto py-2" />
      <div className="flex justify-end gap-2 mt-4">
        <Btn onClick={onClose}>Отмена</Btn>
        <Btn
          variant={variant}
          loading={loading}
          disabled={reason.trim().length < min}
          onClick={async () => {
            setLoading(true);
            try {
              await onConfirm(reason.trim());
              onClose();
            } finally {
              setLoading(false);
            }
          }}
        >
          {confirmText}
        </Btn>
      </div>
    </Modal>
  );
}

export function Json({ data }: { data: unknown }) {
  return <pre className="json">{JSON.stringify(data, null, 2)}</pre>;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="block text-[11px] muted mb-1 font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Toolbar({ q, setQ, placeholder = 'Поиск…', children }: { q?: string; setQ?: (v: string) => void; placeholder?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {setQ && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="input pl-8 w-[260px]" />
        </div>
      )}
      {children}
    </div>
  );
}

export function Select({ value, onChange, options, className }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn('input', className)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between mt-3 text-[12px] muted">
      <span>Всего: {total}</span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="btn btn-ghost btn-sm">
          <ChevronLeft size={14} />
        </button>
        <span className="px-2">
          {page} / {Math.max(1, pages)}
        </span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="btn btn-ghost btn-sm">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

export function Table({ head, children, empty, loading }: { head: ReactNode[]; children: ReactNode; empty?: boolean; loading?: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {loading && (
        <div className="p-6 flex justify-center">
          <Loader2 className="animate-spin text-green" />
        </div>
      )}
      {empty && !loading && <div className="p-8 text-center text-[13px] muted">Ничего не найдено</div>}
    </div>
  );
}

export function Stat({ l, v, mono }: { l: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px] border-b border-[#161f1b] last:border-0">
      <span className="muted">{l}</span>
      <span className={cn('font-semibold text-right', mono && 'mono')}>{v}</span>
    </div>
  );
}

export function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}
