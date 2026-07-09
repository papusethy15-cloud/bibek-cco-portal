/// <reference types="vite/client" />
import axios, { AxiosInstance, AxiosError } from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cco_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── 401 handler with silent token refresh ─────────────────────────────────────
// 1. On 401 → attempt POST /auth/refresh-token once with stored refresh token.
// 2. Success  → persist new tokens, retry the original request transparently.
// 3. Failure  → wipe ALL cco_* localStorage keys and redirect to /login.
// _isRefreshing / _refreshQueue prevent cascading refresh calls when several
// concurrent requests 401 at the same moment.

let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

function _processQueue(newToken: string | null) {
  _refreshQueue.forEach((cb) => cb(newToken));
  _refreshQueue = [];
}

function _fullLogout() {
  // Remove session keys only — MPIN keys (cco_mpin_hash, cco_mpin_set) are
  // intentionally kept so the next login doesn't re-prompt MPIN setup.
  // If a different user logs in on this device, checkMpinStatus() re-fetches
  // from the DB and updates the cache accordingly.
  [
    'cco_token',
    'cco_refresh_token',
    'cco_user',
    'cco_session_expires_at',
  ].forEach((key) => localStorage.removeItem(key));
  window.location.href = '/login';
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as any;

    if (err.response?.status !== 401 || original._retried) {
      return Promise.reject(err);
    }
    original._retried = true;

    const refreshToken = localStorage.getItem('cco_refresh_token');
    if (!refreshToken) {
      _fullLogout();
      return Promise.reject(err);
    }

    if (_isRefreshing) {
      return new Promise((resolve, reject) => {
        _refreshQueue.push((token) => {
          if (!token) return reject(err);
          original.headers.Authorization = `Bearer ${token}`;
          resolve(api(original));
        });
      });
    }

    _isRefreshing = true;

    try {
      const { data } = await axios.post(
        `${BASE_URL}/auth/refresh-token`,
        { refresh_token: refreshToken },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const payload        = data?.data ?? data;
      const newAccessToken  = payload.access_token;
      const newRefreshToken = payload.refresh_token ?? refreshToken;

      localStorage.setItem('cco_token', newAccessToken);
      localStorage.setItem('cco_refresh_token', newRefreshToken);

      _processQueue(newAccessToken);
      original.headers.Authorization = `Bearer ${newAccessToken}`;
      return api(original);
    } catch (_refreshErr) {
      _processQueue(null);
      _fullLogout();
      return Promise.reject(_refreshErr);
    } finally {
      _isRefreshing = false;
    }
  }
);

export default api;

// ── Settings API (Cloudinary config) ──────────────────────────────────────────
export const settingsAPI = {
  cloudinary: () => api.get('/settings/cloudinary'),
};
