import { motion, HTMLMotionProps, useDragControls, useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/format';
import { haptic } from '@/lib/haptics';

export function Button({ children, variant = 'green', size = 'lg', loading, className, disabled, onClick, ...rest }: { children: ReactNode; variant?: 'green' | 'ghost' | 'danger' | 'soft'; size?: 'lg' | 'md' | 'sm'; loading?: boolean } & HTMLMotionProps<'button'>) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-2xl transition disabled:opacity-50 disabled:pointer-events-none select-none';
  const sizes = { lg: 'h-[54px] px-5 text-[16px] w-full', md: 'h-11 px-4 text-[15px]', sm: 'h-9 px-3 text-[13px] rounded-xl' };
  const variants = { green: 'btn-green green-glow', ghost: 'btn-ghost', danger: 'btn-danger', soft: 'bg-green/15 text-green' };
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      onClick={(e) => {
        haptic();
        onClick?.(e);
      }}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" size={18} /> : children}
    </motion.button>
  );
}

/** Any tappable surface (rows, cards, chips): scale feedback + haptic. */
export function Pressable({ children, className, onClick, disabled, scale = 0.975, ...rest }: { children: ReactNode; className?: string; onClick?: () => void; disabled?: boolean; scale?: number } & Omit<HTMLMotionProps<'button'>, 'onClick'>) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale }}
      transition={{ type: 'spring', stiffness: 700, damping: 32 }}
      className={cn('text-left', className)}
      disabled={disabled}
      onClick={() => {
        haptic(6);
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function Header({ title, subtitle, right, back = true, onBack, className }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; back?: boolean; onBack?: () => void; className?: string }) {
  const nav = useNavigate();
  return (
    <div className={cn('safe-top px-4 pb-3 flex items-center gap-3', className)}>
      {back && (
        <motion.button whileTap={{ scale: 0.85 }} onClick={() => { haptic(5); onBack ? onBack() : nav(-1); }} className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center" aria-label="Назад">
          <ChevronLeft size={26} />
        </motion.button>
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
    <motion.button whileTap={disabled ? undefined : { scale: 0.94 }} onClick={() => { if (disabled) return; haptic(); onChange(!on); }} className={cn('relative w-[50px] h-[30px] rounded-full transition-colors', on ? 'bg-green' : 'bg-[#cfd6d2] dark:bg-[#2a3530]', disabled && 'opacity-50')} aria-pressed={on}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} className={cn('absolute top-[3px] w-6 h-6 rounded-full bg-white shadow', on ? 'left-[23px]' : 'left-[3px]')} />
    </motion.button>
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

/**
 * Bottom sheet: drag the handle/header down to dismiss (velocity or distance), tap the backdrop, or press Escape.
 * The backdrop fades with the drag so the gesture feels physical.
 */
export function Sheet({ open, onClose, children, title, theme = 'dark' }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; theme?: 'dark' | 'light' }) {
  const controls = useDragControls();
  const y = useMotionValue(0);
  const backdrop = useTransform(y, [0, 320], [1, 0]);
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ opacity: backdrop }} onClick={onClose} className="absolute inset-0 bg-black/60 z-40" />
          <motion.div
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.9 }}
            style={{ y }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 700) {
                haptic(5);
                onClose();
              }
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className={cn('absolute left-0 right-0 bottom-0 z-50 rounded-t-[28px] screen max-h-[92%] flex flex-col', theme === 'light' ? 'theme-light' : 'theme-dark')}
          >
            <div onPointerDown={(e) => controls.start(e)} className="touch-none cursor-grab active:cursor-grabbing shrink-0">
              <div className="w-11 h-1.5 rounded-full bg-black/25 dark:bg-white/25 mx-auto mt-3 mb-2" style={{ background: theme === 'light' ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.25)' }} />
              {title && <div className="px-5 pb-2 text-[20px] font-extrabold">{title}</div>}
            </div>
            <div className="px-5 pb-8 safe-bottom overflow-y-auto hide-scroll">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Check({ on, size = 26 }: { on: boolean; size?: number }) {
  return (
    <motion.span animate={on ? { scale: [1, 1.18, 1] } : { scale: 1 }} transition={{ duration: 0.25 }} className={cn('rounded-full inline-flex items-center justify-center shrink-0 transition', on ? 'bg-green text-[#06240f]' : 'border-2 line')} style={{ width: size, height: size }}>
      {on && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </motion.span>
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

/**
 * Code input backed by a single native numeric field: the system keyboard opens (tel/one-time-code),
 * the boxes just mirror the value. Works for OTP (6) and PIN (4).
 */
export function CodeInput({ length, value, onChange, onComplete, secret, autoFocus = true, size = 'md', light = false, error }: { length: number; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; secret?: boolean; autoFocus?: boolean; size?: 'md' | 'lg'; light?: boolean; error?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 60);
  }, [autoFocus]);
  useEffect(() => {
    if (value.length === length) onComplete?.(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const box = size === 'lg' ? 'w-[46px] h-[56px] text-[24px]' : 'w-[40px] h-[48px] text-[20px]';
  return (
    <motion.div key={error} animate={error ? { x: [0, -8, 8, -6, 6, 0] } : {}} transition={{ duration: 0.4 }} className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        aria-label="Код"
        className="absolute inset-0 w-full h-full opacity-0"
        style={{ caretColor: 'transparent', color: 'transparent' }}
      />
      {secret ? (
        <div className="flex justify-center gap-3 py-2 pointer-events-none">
          {Array.from({ length }).map((_, i) => (
            <motion.span key={i} animate={value.length > i ? { scale: [1, 1.3, 1] } : {}} className={cn('w-4 h-4 rounded-full border-2', value.length > i ? 'bg-green border-green' : light ? 'border-[#0b100e]/30' : 'line')} />
          ))}
        </div>
      ) : (
        <div className="flex justify-center gap-2.5 pointer-events-none">
          {Array.from({ length }).map((_, i) => (
            <div key={i} className={cn('rounded-xl border-2 flex items-center justify-center font-bold number-mono transition-colors', box, light ? 'bg-white' : 'card2', value.length === i ? 'border-green' : value[i] ? (light ? 'border-[#0b100e]/40' : 'border-[#3a4741]') : light ? 'border-[#e3e8e5]' : 'line')}>
              {value[i] ?? ''}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
