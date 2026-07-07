import { create } from 'zustand';
import { AuthUser } from '../types';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  mpinVerified: boolean;
  mpinSet: boolean;
  lastActivity: number;
  isLocked: boolean;

  setAuth: (user: AuthUser, token: string, refreshToken: string) => void;
  setMpinVerified: (v: boolean) => void;
  setMpinSet: (v: boolean) => void;
  updateActivity: () => void;
  lock: () => void;
  unlock: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    try { return JSON.parse(localStorage.getItem('cco_user') || 'null'); } catch { return null; }
  })(),
  token: localStorage.getItem('cco_token'),
  mpinVerified: false,
  mpinSet: localStorage.getItem('cco_mpin_set') === 'true',
  lastActivity: Date.now(),
  isLocked: false,

  setAuth: (user, token, refreshToken) => {
    localStorage.setItem('cco_token', token);
    localStorage.setItem('cco_refresh_token', refreshToken);
    localStorage.setItem('cco_user', JSON.stringify(user));
    set({ user, token, lastActivity: Date.now() });
  },

  setMpinVerified: (v) => set({ mpinVerified: v, isLocked: !v, lastActivity: Date.now() }),
  setMpinSet: (v) => set({ mpinSet: v }),

  updateActivity: () => set({ lastActivity: Date.now() }),

  lock: () => set({ isLocked: true, mpinVerified: false }),

  unlock: () => set({ isLocked: false, mpinVerified: true, lastActivity: Date.now() }),

  logout: () => {
    localStorage.removeItem('cco_token');
    localStorage.removeItem('cco_refresh_token');
    localStorage.removeItem('cco_user');
    localStorage.removeItem('cco_session_expires_at');
    set({ user: null, token: null, mpinVerified: false, isLocked: false });
  },
}));
