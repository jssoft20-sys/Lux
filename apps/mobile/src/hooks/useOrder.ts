import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

export function useOrder(id: string | undefined) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], enabled: !!id, queryFn: () => api<any>(`/p2p/orders/${id}`), refetchInterval: 10_000 });
  useEffect(() => {
    if (!id) return;
    const s = getSocket();
    if (!s) return;
    s.emit('join', { orderId: id });
    const onOrder = (p: any) => {
      if (p.orderId === id) {
        qc.invalidateQueries({ queryKey: ['order', id] });
        qc.invalidateQueries({ queryKey: ['orders'] });
        qc.invalidateQueries({ queryKey: ['me'] });
      }
    };
    s.on('order', onOrder);
    return () => {
      s.off('order', onOrder);
      s.emit('leave', { orderId: id });
    };
  }, [id, qc]);
  return q;
}
