import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Profile, useAuth } from '@/store/auth';

export function useProfile(enabled = true) {
  const { accessToken, setUser } = useAuth();
  return useQuery({
    queryKey: ['me'],
    enabled: enabled && !!accessToken,
    queryFn: async () => {
      const p = await api<Profile>('/me');
      setUser(p);
      return p;
    },
    refetchInterval: 30_000,
  });
}

export function useBanks() {
  return useQuery({ queryKey: ['banks'], queryFn: () => api<any[]>('/catalog/banks'), staleTime: 10 * 60_000 });
}

export function useRate() {
  return useQuery({ queryKey: ['rates'], queryFn: async () => (await api<any[]>('/catalog/rates')).find((r) => r.asset === 'USDT' && r.fiat === 'KGS'), staleTime: 60_000 });
}

export function useUnread() {
  const { accessToken } = useAuth();
  return useQuery({ queryKey: ['unread'], enabled: !!accessToken, queryFn: () => api<{ unread: number }>('/p2p/chats/unread'), refetchInterval: 20_000 });
}
