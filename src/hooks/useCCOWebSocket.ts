/**
 * useCCOWebSocket / useBookingWebSocket
 * ══════════════════════════════════════
 * useCCOWebSocket     → /ws/admin/assignments  (CCO role is allowed by backend)
 * useBookingWebSocket → /ws/booking/{bookingId}
 *
 * Key behaviours:
 *  • Singleton per page — one WS connection shared across all components
 *  • Re-reads token from localStorage on EVERY reconnect attempt — so a
 *    refreshed access token (after 401 refresh flow) is picked up automatically
 *  • Auto-reconnect with exponential back-off (1s → 2 → 4 → 8 → 16s max)
 *  • Max 15 retries — stops spamming if backend is unreachable
 *  • Heartbeat PING every 30s
 *  • Console logs: [CCO WS] Connecting / Connected ✓ / Retrying / Max retries
 *  • WS close code 4001 = expired token → reads fresh token immediately on next retry
 */

import { useEffect, useCallback, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { getWsBase } from '../utils/wsBase';

export type WSStatus = 'connecting' | 'connected' | 'disconnected';
export type WSHandler = (payload: any, event: WSMessage) => void;

export interface WSMessage {
  type: string;
  room: string | null;
  payload: any;
  timestamp: string;
}

// ── Module-level singleton for CCO assignments channel ───────────────────────
let _ws: WebSocket | null = null;
let _listeners: Map<string, Set<WSHandler>> = new Map();
let _statusListeners: Set<(s: WSStatus) => void> = new Set();
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _pingTimer: ReturnType<typeof setInterval> | null = null;
let _backoff = 1000;
let _intentionalClose = false;
let _hookRefCount = 0;
let _retryCount = 0;
const _MAX_RETRIES = 15;
let _disconnectTimer: ReturnType<typeof setTimeout> | null = null;  // StrictMode-safe deferred disconnect

function _notifyStatus(s: WSStatus) {
  _statusListeners.forEach(fn => fn(s));
}

function _dispatch(msg: WSMessage) {
  const handlers = _listeners.get(msg.type);
  if (handlers) handlers.forEach(fn => fn(msg.payload, msg));
  const wild = _listeners.get('*');
  if (wild) wild.forEach(fn => fn(msg.payload, msg));
}

function _startPing() {
  _stopPing();
  _pingTimer = setInterval(() => {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ type: 'PING' }));
    }
  }, 30_000);
}

function _stopPing() {
  if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
}

/**
 * Always read the token fresh from localStorage — this ensures that when the
 * HTTP layer silently refreshes the access token (api.ts interceptor on 401),
 * the next WS reconnect picks up the new token automatically instead of
 * retrying with the old expired one.
 */
function _getFreshToken(): string | null {
  return localStorage.getItem('cco_token');
}

function _connect() {
  // Cancel any pending scheduled disconnect (handles React StrictMode double-mount)
  if (_disconnectTimer) { clearTimeout(_disconnectTimer); _disconnectTimer = null; }
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  const token = _getFreshToken();
  if (!token) {
    console.warn('[CCO WS] No token in localStorage — skipping connect');
    return;
  }

  _intentionalClose = false;
  _notifyStatus('connecting');
  const url = `${getWsBase()}/ws/admin/assignments?token=${token}`;
  console.log(`[CCO WS] Connecting (attempt ${_retryCount + 1}) → ${getWsBase()}/ws/admin/assignments`);
  _ws = new WebSocket(url);

  _ws.onopen = () => {
    _backoff = 1000;
    _retryCount = 0;
    console.log('[CCO WS] Connected ✓');
    _notifyStatus('connected');
    _startPing();
  };

  _ws.onmessage = (e) => {
    try {
      const msg: WSMessage = JSON.parse(e.data);
      if (msg.type === 'PONG' || msg.type === 'CONNECTED') return;
      _dispatch(msg);
    } catch {}
  };

  _ws.onclose = (e) => {
    _stopPing();
    if (_intentionalClose) {
      console.log('[CCO WS] Disconnected (intentional)');
      _notifyStatus('disconnected');
      return;
    }

    _notifyStatus('disconnected');

    // Code 4001 = token expired/invalid — don't wait, retry sooner with fresh token
    const isTokenError = e.code === 4001;
    if (isTokenError) {
      console.warn('[CCO WS] Token rejected by server (4001) — will retry with fresh token');
    }

    if (_retryCount >= _MAX_RETRIES) {
      console.warn(`[CCO WS] Max retries (${_MAX_RETRIES}) reached. WS stopped.`);
      return;
    }

    _retryCount++;
    const delay = isTokenError ? 500 : Math.min(_backoff, 16_000);
    if (!isTokenError) _backoff = Math.min(_backoff * 2, 16_000);
    console.log(`[CCO WS] Disconnected (code=${e.code}) — retrying in ${delay}ms (${_retryCount}/${_MAX_RETRIES})`);
    _reconnectTimer = setTimeout(_connect, delay);
  };

  _ws.onerror = () => {
    // onerror always fires before onclose — let onclose handle retry
    _ws?.close();
  };
}

function _disconnect() {
  _intentionalClose = true;
  _retryCount = 0;
  _backoff = 1000;
  _stopPing();
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _ws?.close();
  _ws = null;
  _notifyStatus('disconnected');
}

function _scheduledDisconnect() {
  // Defer disconnect by 100ms — if StrictMode remounts within that window,
  // _hookRefCount will be > 0 and we cancel the disconnect instead of
  // tearing down a perfectly good connection.
  if (_disconnectTimer) clearTimeout(_disconnectTimer);
  _disconnectTimer = setTimeout(() => {
    _disconnectTimer = null;
    if (_hookRefCount <= 0) _disconnect();
  }, 100);
}

// ── React hooks ──────────────────────────────────────────────────────────────

export function useCCOWebSocket() {
  const token = useAuthStore(s => s.token);  // used only to trigger reconnect on token change
  const [status, setStatus] = useState<WSStatus>('disconnected');

  useEffect(() => {
    const fn = (s: WSStatus) => setStatus(s);
    _statusListeners.add(fn);
    if (_ws?.readyState === WebSocket.OPEN) setStatus('connected');
    else if (_ws?.readyState === WebSocket.CONNECTING) setStatus('connecting');
    else setStatus('disconnected');
    return () => { _statusListeners.delete(fn); };
  }, []);

  useEffect(() => {
    if (!token) return;
    _hookRefCount++;
    _connect();
    return () => {
      _hookRefCount--;
      if (_hookRefCount <= 0) { _hookRefCount = 0; _scheduledDisconnect(); }
    };
  }, [token]);

  const subscribe = useCallback((eventType: string, handler: WSHandler): (() => void) => {
    if (!_listeners.has(eventType)) _listeners.set(eventType, new Set());
    _listeners.get(eventType)!.add(handler);
    return () => { _listeners.get(eventType)?.delete(handler); };
  }, []);

  return { status, subscribe };
}

/**
 * useBookingWebSocket
 * Subscribes to /ws/booking/{bookingId} for real-time accept/reject events.
 * Activates only when bookingId is non-null (pass null to stay disconnected).
 */
export function useBookingWebSocket(bookingId: string | null) {
  const token = useAuthStore(s => s.token);
  const [status, setStatus] = useState<WSStatus>('disconnected');
  const [lastEvent, setLastEvent] = useState<WSMessage | null>(null);

  useEffect(() => {
    if (!bookingId || !token) return;

    let backoff = 1000;
    let retryCount = 0;
    const MAX_RETRIES = 15;
    let intentionalClose = false;
    let reconnTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let ws: WebSocket | null = null;

    // ── StrictMode-safe deferred close ────────────────────────────────────
    // React StrictMode mounts → unmounts → remounts every effect in dev.
    // Without this guard, the cleanup from the first mount fires ws.close()
    // on a CONNECTING socket, causing Firefox to log
    // "NS_ERROR_WEBSOCKET_CONNECTION_REFUSED" even though the second mount
    // reconnects successfully.  We defer the close by one tick so that if
    // the component remounts immediately (StrictMode), the close is cancelled.
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    function _safeClose() {
      if (!ws) return;
      if (ws.readyState === WebSocket.CONNECTING) {
        // Can't close a CONNECTING socket cleanly — wait for it to open then close
        ws.onopen = () => { ws?.close(); };
        ws.onerror = null;   // prevent the error handler from double-closing
      } else {
        ws.close();
      }
    }

    function connect() {
      if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
      // Always read fresh token in case it was refreshed by the HTTP interceptor
      const freshToken = localStorage.getItem('cco_token') ?? token;
      const url = `${getWsBase()}/ws/booking/${bookingId}?token=${freshToken}`;
      setStatus('connecting');
      console.log(`[Booking WS:${bookingId}] Connecting (attempt ${retryCount + 1})`);
      ws = new WebSocket(url);

      ws.onopen = () => {
        if (intentionalClose) { ws?.close(); return; }  // cleanup fired before open
        backoff = 1000;
        retryCount = 0;
        console.log(`[Booking WS:${bookingId}] Connected ✓`);
        setStatus('connected');
        pingTimer = setInterval(() => {
          ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'PING' }));
        }, 30_000);
      };

      ws.onmessage = (e) => {
        try {
          const msg: WSMessage = JSON.parse(e.data);
          if (msg.type !== 'PONG' && msg.type !== 'CONNECTED') setLastEvent(msg);
        } catch {}
      };

      ws.onclose = (e) => {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        setStatus('disconnected');
        if (intentionalClose) return;
        if (retryCount >= MAX_RETRIES) {
          console.warn(`[Booking WS:${bookingId}] Max retries reached. Stopped.`);
          return;
        }
        const isTokenError = e.code === 4001;
        retryCount++;
        const delay = isTokenError ? 500 : Math.min(backoff, 16_000);
        if (!isTokenError) backoff = Math.min(backoff * 2, 16_000);
        console.log(`[Booking WS:${bookingId}] Retrying in ${delay}ms (${retryCount}/${MAX_RETRIES})`);
        reconnTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => { if (!intentionalClose) ws?.close(); };
    }

    // Defer first connect by one tick — lets StrictMode's unmount+remount
    // cancel the very first connection attempt before it even opens,
    // preventing the CONNECTING→close race that Firefox flags as an error.
    const startTimer = setTimeout(connect, 0);

    return () => {
      intentionalClose = true;
      clearTimeout(startTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (reconnTimer) clearTimeout(reconnTimer);
      if (closeTimer) clearTimeout(closeTimer);
      _safeClose();
      ws = null;
    };
  }, [bookingId, token]);

  return { status, lastEvent };
}
