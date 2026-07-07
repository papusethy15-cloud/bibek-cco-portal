/**
 * wsBase.ts
 * ─────────
 * Single source of truth for the WebSocket base URL.
 *
 * Reads VITE_API_URL (set via .env / .env.local) and converts it to a
 * WebSocket origin:
 *
 *   VITE_API_URL = "https://api.bibekenterprises.com/api/v1"
 *   → wsBase     = "wss://api.bibekenterprises.com"
 *
 *   VITE_API_URL = "http://localhost:8000/api/v1"
 *   → wsBase     = "ws://localhost:8000"
 *
 * Both WS hooks import this so there is only one place to change if the
 * API host ever moves.
 */

export function getWsBase(): string {
  const apiUrl =
    (import.meta as any).env?.VITE_API_URL as string | undefined
    ?? 'http://localhost:8000/api/v1';

  try {
    const parsed = new URL(apiUrl);
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${parsed.host}`;
  } catch {
    // Fallback for malformed URL — strip path and swap protocol
    return apiUrl
      .replace(/^https/, 'wss')
      .replace(/^http/, 'ws')
      .replace(/\/api\/v1.*$/, '');
  }
}
