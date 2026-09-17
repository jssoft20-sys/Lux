import { motion } from 'framer-motion';
import { Delete } from 'lucide-react';

const KEYS: Array<[string, string]> = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ']];

export function Keypad({ onKey, onDelete, light = true, className = '' }: { onKey: (k: string) => void; onDelete: () => void; light?: boolean; className?: string }) {
  const keyCls = light ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] text-[#0b100e]' : 'bg-[#1a2420] text-white';
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {KEYS.map(([k, l]) => (
        <motion.button key={k} whileTap={{ scale: 0.94, backgroundColor: light ? '#e6ebe8' : '#243029' }} onClick={() => onKey(k)} className={`h-[52px] rounded-[10px] flex flex-col items-center justify-center ${keyCls}`}>
          <span className="text-[24px] font-medium leading-none">{k}</span>
          {l && <span className="text-[9px] tracking-[0.15em] leading-none mt-0.5 opacity-60">{l}</span>}
        </motion.button>
      ))}
      <div />
      <motion.button whileTap={{ scale: 0.94 }} onClick={() => onKey('0')} className={`h-[52px] rounded-[10px] flex items-center justify-center ${keyCls}`}>
        <span className="text-[24px] font-medium">0</span>
      </motion.button>
      <motion.button whileTap={{ scale: 0.94 }} onClick={onDelete} className="h-[52px] rounded-[10px] flex items-center justify-center" aria-label="Удалить">
        <Delete size={26} className={light ? 'text-[#0b100e]' : 'text-white'} />
      </motion.button>
    </div>
  );
}
