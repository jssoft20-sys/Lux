import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/store/auth';
import { API_URL } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  const { accessToken } = useAuth.getState();
  if (!accessToken) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  socket = io(`${(import.meta.env.VITE_WS_URL as string | undefined) || API_URL || window.location.origin}/chat`, { auth: { token: accessToken }, transports: ['websocket', 'polling'], reconnection: true });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
