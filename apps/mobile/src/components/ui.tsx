import { motion, HTMLMotionProps } from 'framer-motion';
import { ReactNode, useEffect, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/format';

export function Button({ children, variant = 'green', size = 'lg', loading, className, disabled, ...rest }: { children: ReactNode; variant?: 'green' | 'ghost' | 'danger' | 'soft'; size?: 'lg' | 'md' | 'sm'; loading?: boolean } & HTMLMotionProps<'button'>) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-2xl transition disabled:opacity-50 disabled:pointer-events-none select-none';
  const sizes = { lg: 'h-[54px] px-5 text-[16px] w-full', md: 'h-11 px-4 text-[15px]', sm: 'h-9 px-3 text-[13px] rounded-xl' };
  const variants = { green: 'btn-green green-glow', ghost: 'btn-ghost', danger: 'btn-danger', soft: 'bg-green/15 text-green' };
  return (
    <motion.button whileTap={{ scale: 0.97 }} className={cn(base, sizes[size], variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="animate-spin" size={18} /> : children}
    </motion.button>
  );
}

export function Header({ title, subtitle, right, back = true, onBack, className }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; back?: boolean; onBack?: () => void; className?: string }) {
  const nav = useNavigate();
  return (
    <div className={cn('safe-top px-4 pb-3 flex items-center gap-3', className)}>
      {back && (
        <button onClick={onBack ?? (() => nav(-1))} className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center press" aria-label="Назад">
          <ChevronLeft size={26} />
        </button>
      )}
      <div className="flex-1 min-w-0">
        {title && <div className="text-[17px] font-bold leading-tight truncate">{title}</div>}
        {subtitle && <div className="text-[12px] muted leading-tight truncate">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Row({ label, value, mono, className }: { label: ReactNode; value: ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-2.5', className)}>
      <span className="text-[14px] muted">{label}</span>
      <span className={cn('text-[14px] font-semibold text-right', mono && 'number-mono')}>{value}</span>
    </div>
  );
}

export function Badge({ children, tone = 'gray', className }: { children: ReactNode; tone?: 'green' | 'yellow' | 'red' | 'gray' | 'blue'; className?: string }) {
  const map = { green: 'status-green', yellow: 'status-yellow', red: 'status-red', gray: 'status-gray', blue: 'status-blue' };
  return <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold', map[tone], className)}>{children}</span>;
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} className={cn('relative w-[50px] h-[30px] rounded-full transition-colors', on ? 'bg-green' : 'bg-[#cfd6d2] dark:bg-[#2a3530]', disabled && 'opacity-50')} aria-pressed={on}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} className={cn('absolute top-[3px] w-6 h-6 rounded-full bg-white shadow', on ? 'left-[23px]' : 'left-[3px]')} />
    </button>
  );
}

export function Avatar({ name, size = 40, src, className }: { name?: string | null; size?: number; src?: string | null; className?: string }) {
  const initials = (name || '?')
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  const hue = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div className={cn('rounded-full overflow-hidden flex items-center justify-center font-bold text-white shrink-0', className)} style={{ width: size, height: size, background: src ? undefined : `linear-gradient(135deg, hsl(${hue} 45% 45%), hsl(${(hue + 40) % 360} 55% 35%))`, fontSize: size * 0.36 }}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : initials}
    </div>
  );
}

export function BankLogo({ code, logo, color, size = 28, className }: { code: string; logo?: string; color?: string; size?: number; className?: string }) {
  const [err, setErr] = useState(false);
  const src = logo ? `/banks/${logo}` : '';
  if (!src || err) {
    return (
      <span className={cn('inline-flex items-center justify-center rounded-lg font-extrabold text-white', className)} style={{ width: size, height: size, background: color || '#374151', fontSize: size * 0.5 }}>
        {code[0]}
      </span>
    );
  }
  return <img src={src} onError={() => setErr(true)} alt={code} className={cn('rounded-lg object-cover shrink-0', className)} style={{ width: size, height: size }} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

export function Spinner({ size = 22 }: { size?: number }) {
  return <Loader2 className="animate-spin text-green" size={size} />;
}

export function Sheet({ open, onClose, children, title, theme = 'dark' }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; theme?: 'dark' | 'light' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <>
      {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 z-40" />}
      {open && (
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 36 }} className={cn('absolute left-0 right-0 bottom-0 z-50 rounded-t-[28px] screen max-h-[92%] overflow-y-auto hide-scroll', theme === 'light' ? 'theme-light' : 'theme-dark')}>
          <div className="w-10 h-1.5 rounded-full bg-black/20 mx-auto mt-3 mb-2" />
          {title && <div className="px-5 pb-2 text-[20px] font-extrabold">{title}</div>}
          <div className="px-5 pb-8 safe-bottom">{children}</div>
        </motion.div>
      )}
    </>
  );
}

export function Check({ on, size = 26 }: { on: boolean; size?: number }) {
  return (
    <span className={cn('rounded-full inline-flex items-center justify-center shrink-0 transition', on ? 'bg-green text-[#06240f]' : 'border-2 line')} style={{ width: size, height: size }}>
      {on && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6 gap-2">
      {icon && <div className="w-16 h-16 rounded-full card flex items-center justify-center text-green mb-2">{icon}</div>}
      <div className="font-bold text-[16px]">{title}</div>
      {text && <div className="text-[13px] muted max-w-[260px]">{text}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
