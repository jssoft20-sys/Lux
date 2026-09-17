import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Megaphone, ShoppingCart, Tag } from 'lucide-react';
import { Pressable, Sheet } from '@/components/ui';

export function QuickActions({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const go = (to: string) => {
    onClose();
    nav(to);
  };
  const items = [
    { icon: ShoppingCart, title: 'Купить USDT', text: 'Оплата с вашего счёта в KGS', to: '/?side=BUY' },
    { icon: Tag, title: 'Продать USDT', text: 'Получить KGS на ваш счёт', to: '/?side=SELL' },
    { icon: Megaphone, title: 'Разместить объявление', text: 'Ваш курс и лимиты', to: '/ads/new' },
    { icon: ArrowDownToLine, title: 'Пополнить', text: 'USDT TRC20 с Binance / Web3', to: '/wallet/deposit' },
    { icon: ArrowUpFromLine, title: 'Вывести', text: 'На внешний TRON-адрес', to: '/wallet/withdraw' },
  ];
  return (
    <Sheet open onClose={onClose} title="Быстрые действия">
      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <Pressable key={it.title} onClick={() => go(it.to)} className="card p-4 flex items-center gap-4 w-full">
            <span className="w-11 h-11 rounded-2xl bg-green/15 text-green flex items-center justify-center">
              <it.icon size={22} />
            </span>
            <span>
              <span className="block font-semibold text-[15px]">{it.title}</span>
              <span className="block text-[12px] muted">{it.text}</span>
            </span>
          </Pressable>
        ))}
      </div>
    </Sheet>
  );
}
