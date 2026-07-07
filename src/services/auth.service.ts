import api from './api';
import { ApiResponse, AuthUser } from '../types';

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
  mpin_set: boolean;
}

// Session duration constants
const SESSION_DURATION_MS  = 24 * 60 * 60 * 1000;  // 24 hours hard limit
const SESSION_EXPIRES_KEY  = 'cco_session_expires_at';

// ── MPIN helpers — SHA-256 via Web Crypto (no plaintext/btoa) ──────────────
async function _hashPin(pin: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(`cco_mpin_${pin}_palei`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const authService = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await api.post<ApiResponse<any>>('/auth/login', { email, password });
    const data = res.data.data;
    // Backend returns access_token + refresh_token
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
      mpin_set: authService.isMpinSet(),
    };
  },

  async getMe(): Promise<AuthUser> {
    const res = await api.get<ApiResponse<AuthUser>>('/auth/me');
    return res.data.data;
  },

  // ── MPIN — stored as SHA-256 hash, never reversible ──────────────────────
  async setupMpin(pin: string): Promise<void> {
    const hash = await _hashPin(pin);
    localStorage.setItem('cco_mpin_hash', hash);
    localStorage.setItem('cco_mpin_set', 'true');
  },

  async verifyMpin(pin: string): Promise<boolean> {
    const stored = localStorage.getItem('cco_mpin_hash');
    if (!stored) return false;
    const hash = await _hashPin(pin);
    return stored === hash;
  },

  isMpinSet(): boolean {
    return localStorage.getItem('cco_mpin_set') === 'true';
  },

  // ── 24h session stamp — set at login, checked on every app init ──────────
  stampSession(): void {
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    localStorage.setItem(SESSION_EXPIRES_KEY, String(expiresAt));
  },

  isSessionExpired(): boolean {
    const raw = localStorage.getItem(SESSION_EXPIRES_KEY);
    if (!raw) return true; // no stamp = treat as expired
    return Date.now() > parseInt(raw, 10);
  },

  msUntilSessionExpiry(): number {
    const raw = localStorage.getItem(SESSION_EXPIRES_KEY);
    if (!raw) return 0;
    return Math.max(0, parseInt(raw, 10) - Date.now());
  },

  logout(): void {
    localStorage.removeItem('cco_token');
    localStorage.removeItem('cco_refresh_token');
    localStorage.removeItem('cco_mpin_hash');
    localStorage.removeItem('cco_mpin_set');
    localStorage.removeItem('cco_user');
    localStorage.removeItem(SESSION_EXPIRES_KEY);
  },
};
