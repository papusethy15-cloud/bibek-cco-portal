import { create } from 'zustand';
import { AuthUser } from '../types';
import { authService } from '../services/auth.service';

interface AuthState {
  user:          AuthUser | null;
  token:         string | null;
  mpinVerified:  boolean;
  mpinSet:       boolean;
  lastActivity:  number;
  isLocked:      boolean;
  /** true once we've verified the stored token/session is still valid on boot */
  bootChecked:   boolean;

  setAuth:          (user: AuthUser, token: string, refreshToken: string) => void;
  setMpinVerified:  (v: boolean) => void;
  setMpinSet:       (v: boolean) => void;
  updateActivity:   () => void;
  lock:             () => void;
  unlock:           () => void;
  logout:           () => void;
  setBootChecked:   () => void;
}

// ── Boot check: wipe token if session already expired ─────────────────────────
// This runs synchronously before the store is created so the initial token
// value is already clean. This is what prevents the 401 cascade on page reload.
function _bootToken(): string | null {
  const token = localStorage.getItem('cco_token');
  if (!token) return null;
  if (authService.isSessionExpired()) {
    // Session expired — clear auth tokens but keep MPIN
    localStorage.removeItem('cco_token');
    localStorage.removeItem('cco_refresh_token');
    localStorage.removeItem('cco_user');
    localStorage.removeItem('cco_session_expires_at');
    return null;
  }
  return token;
}

const _initialToken = _bootToken();
const _initialUser  = _initialToken
  ? (() => { try { return JSON.parse(localStorage.getItem('cco_user') || 'null'); } catch { return null; } })()
  : null;

export const useAuthStore = create<AuthState>((set) => ({
  user:         _initialUser,
  token:        _initialToken,
  mpinVerified: false,   // always false on boot — must pass lock screen
  mpinSet:      localStorage.getItem('cco_mpin_set') === 'true',
  lastActivity: Date.now(),
  isLocked:     false,
  bootChecked:  false,

  setAuth: (user, token, refreshToken) => {
    localStorage.setItem('cco_token',         token);
    localStorage.setItem('cco_refresh_token', refreshToken);
    localStorage.setItem('cco_user',          JSON.stringify(user));
    set({ user, token, lastActivity: Date.now() });
  },

  setMpinVerified: (v) => set({ mpinVerified: v, isLocked: !v, lastActivity: Date.now() }),
  setMpinSet:      (v) => {
    if (v) localStorage.setItem('cco_mpin_set', 'true');
    set({ mpinSet: v });
  },

  updateActivity: () => set({ lastActivity: Date.now() }),

  lock:   () => set({ isLocked: true, mpinVerified: false }),
  unlock: () => set({ isLocked: false, mpinVerified: true, lastActivity: Date.now() }),

  logout: () => {
    authService.logout();   // does NOT remove mpin keys
    set({ user: null, token: null, mpinVerified: false, isLocked: false, bootChecked: false });
  },

  setBootChecked: () => set({ bootChecked: true }),
}));
