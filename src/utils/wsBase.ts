/**
 * wsBase.ts
 * ─────────
 * Single source of truth for the WebSocket base URL.
 *
 * PRODUCTION (VITE_API_URL = "https://api.bibekenterprises.com/api/v1")
 *   → wsBase = "wss://api.bibekenterprises.com"
 *   WS connects directly to the production server.
 *
 * LOCAL DEV (VITE_API_URL = "http://localhost:8000/api/v1")
 *   → wsBase = "" (empty string = same-origin)
 *   Vite dev server proxies /ws/* → ws://localhost:8000/ws/*  (vite.config.ts)
 *   This avoids Firefox's "can't establish connection" on direct cross-port
 *   ws://localhost:8000 connections during local development.
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

    // LOCAL DEV: if the API is on localhost, use same-origin WS so Vite's
    // proxy handles the upgrade (ws://localhost:3001/ws/* → backend).
    // This prevents Firefox's direct-to-backend cross-port WS failures.
    const isLocalhost =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLocalhost) {
      return '';  // same-origin — Vite proxy routes /ws/* to backend
    }

    // PRODUCTION: build wss:// URL from the API host
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${parsed.host}`;
  } catch {
    // Fallback for malformed URL
    return apiUrl
      .replace(/^https/, 'wss')
      .replace(/^http/, 'ws')
      .replace(/\/api\/v1.*$/, '');
  }
}
