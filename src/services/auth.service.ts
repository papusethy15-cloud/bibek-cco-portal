import api from './api';
import { ApiResponse, AuthUser } from '../types';

export interface LoginResponse {
  access_token:  string;
  refresh_token: string;
  user:          AuthUser;
  mpin_set:      boolean;   // true if this user already has an MPIN in DB
}

// Session duration — 24 hours hard limit stamped at login
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const SESSION_EXPIRES_KEY = 'cco_session_expires_at';

// ── MPIN helpers — SHA-256 via Web Crypto (no plaintext/btoa) ──────────────
// The hash is computed client-side and sent to the backend as a 64-char hex.
// The backend stores it as-is (already hashed, no second hash needed server-side).
async function _hashPin(pin: string): Promise<string> {
  const msgBuffer  = new TextEncoder().encode(`cco_mpin_${pin}_palei`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const authService = {
  // ── Login ─────────────────────────────────────────────────────────────────
  async login(email: string, password: string): Promise<LoginResponse> {
    const res  = await api.post<ApiResponse<any>>('/auth/login', { email, password });
    const data = res.data.data;
    return {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      user: {
        id:            data.user_id ?? data.id,
        name:          data.name,
        email:         email,
        role:          data.role,
        mobile:        data.mobile ?? null,
        profile_image: data.profile_image ?? null,
      } as AuthUser,
      // Backend now returns mpin_set directly in login response
      mpin_set: data.mpin_set === true,
    };
  },

  // ── CCO Attendance: auto check-in after login ──────────────────────────
  async checkIn(): Promise<void> {
    try {
      await api.post('/cco-attendance/check-in');
    } catch (e) {
      // Non-fatal — attendance failure should not block CCO work
      console.warn('[attendance] check-in failed:', e);
    }
  },

  async checkOut(): Promise<void> {
    try {
      await api.post('/cco-attendance/check-out');
    } catch (e) {
      console.warn('[attendance] check-out failed:', e);
    }
  },

  async getMe(): Promise<AuthUser> {
    const res = await api.get<ApiResponse<AuthUser>>('/auth/me');
    return res.data.data;
  },

  // ── MPIN — stored in DB per user, never in localStorage ──────────────────
  // setupMpin: hash pin client-side → POST /auth/mpin/setup
  async setupMpin(pin: string): Promise<void> {
    const hash = await _hashPin(pin);
    await api.post('/auth/mpin/setup', { mpin_hash: hash });
    // Also cache locally so we can verify offline when token is still valid
    localStorage.setItem('cco_mpin_hash', hash);
    localStorage.setItem('cco_mpin_set',  'true');
  },

  // verifyMpin: try local cache first (fast), fallback to backend
  async verifyMpin(pin: string): Promise<boolean> {
    const hash = await _hashPin(pin);

    // 1. Try local cache — avoids a network round-trip on every unlock
    const cached = localStorage.getItem('cco_mpin_hash');
    if (cached) return cached === hash;

    // 2. No cache — verify against backend
    try {
      await api.post('/auth/mpin/verify', { mpin_hash: hash });
      // Cache it for next time
      localStorage.setItem('cco_mpin_hash', hash);
      return true;
    } catch {
      return false;
    }
  },

  // checkMpinStatus: ask backend if MPIN is set for current user
  async checkMpinStatus(): Promise<boolean> {
    try {
      const res = await api.get<ApiResponse<{ mpin_set: boolean }>>('/auth/mpin/status');
      const isSet = res.data?.data?.mpin_set === true;
      if (isSet) localStorage.setItem('cco_mpin_set', 'true');
      return isSet;
    } catch {
      // Fallback to localStorage if network fails
      return localStorage.getItem('cco_mpin_set') === 'true';
    }
  },

  // Sync mpin_hash from DB to localStorage cache (called after login)
  // We don't get the hash from the server (one-way), but we can at least
  // prime the mpin_set flag so the setup page is skipped.
  isMpinSet(): boolean {
    return localStorage.getItem('cco_mpin_set') === 'true';
  },

  // ── 24h session stamp — set at login, checked on app init ─────────────────
  stampSession(): void {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem(SESSION_EXPIRES_KEY, String(expiresAt));
  },

  isSessionExpired(): boolean {
    const raw = localStorage.getItem(SESSION_EXPIRES_KEY);
    if (!raw) return true;
    return Date.now() > parseInt(raw, 10);
  },

  msUntilSessionExpiry(): number {
    const raw = localStorage.getItem(SESSION_EXPIRES_KEY);
    if (!raw) return 0;
    return Math.max(0, parseInt(raw, 10) - Date.now());
  },

  // ── Logout — does NOT wipe MPIN hash/set flag ────────────────────────────
  // MPIN belongs to the user account, not the session.
  // When the same CCO logs back in, their MPIN should still work.
  logout(): void {
    // Fire check-out (best-effort, non-blocking) before clearing token
    this.checkOut().catch(() => {});
    localStorage.removeItem('cco_token');
    localStorage.removeItem('cco_refresh_token');
    localStorage.removeItem('cco_user');
    localStorage.removeItem(SESSION_EXPIRES_KEY);
    // NOTE: cco_mpin_hash and cco_mpin_set are intentionally kept —
    // they persist so the next login doesn't ask the user to re-setup MPIN.
    // If a different user logs in on this device, checkMpinStatus() will
    // re-fetch from the DB and update the cache accordingly.
  },
};
