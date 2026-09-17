import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/store/auth';
import { API_URL } from './api';

let socket: Socket | null = null;
let socketToken = '';

export function getSocket(): Socket | null {
  const { accessToken } = useAuth.getState();
  if (!accessToken) return null;
  if (socket && socket.connected && socketToken === accessToken) return socket;
  if (socket) socket.disconnect();
  socketToken = accessToken;
  socket = io(`${(import.meta.env.VITE_WS_URL as string | undefined) || API_URL || window.location.origin}/chat`, { auth: { token: accessToken }, transports: ['websocket', 'polling'], reconnection: true, withCredentials: true });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  socketToken = '';
}
