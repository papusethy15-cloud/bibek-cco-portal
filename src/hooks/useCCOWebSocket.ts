/**
 * useCCOWebSocket / useBookingWebSocket
 * ══════════════════════════════════════
 * Ported from admin_dashboard/src/hooks/useAdminWebSocket.ts
 *
 * useCCOWebSocket     → /ws/admin/assignments  (CCO role is allowed by backend)
 * useBookingWebSocket → /ws/booking/{bookingId}
 *
 * Features (identical to admin version):
 *  • Singleton per page — one WS connection shared across all components
 *  • Auto-reconnect with exponential back-off (1s → 2 → 4 → 8 → 16s max)
 *  • Heartbeat PING every 30s
 *  • subscribe(eventType, handler) returns an unsubscribe function
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

function _connect(token: string) {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  _intentionalClose = false;
  _notifyStatus('connecting');
  const url = `${getWsBase()}/ws/admin/assignments?token=${token}`;
  _ws = new WebSocket(url);

  _ws.onopen = () => {
    _backoff = 1000;
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

  _ws.onclose = () => {
    _stopPing();
    if (_intentionalClose) { _notifyStatus('disconnected'); return; }
    _notifyStatus('disconnected');
    const delay = Math.min(_backoff, 16_000);
    _backoff = Math.min(_backoff * 2, 16_000);
    _reconnectTimer = setTimeout(() => _connect(token), delay);
  };

  _ws.onerror = () => _ws?.close();
}

function _disconnect() {
  _intentionalClose = true;
  _stopPing();
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _ws?.close();
  _ws = null;
  _notifyStatus('disconnected');
}

// ── React hooks ──────────────────────────────────────────────────────────────

export function useCCOWebSocket() {
  const token = useAuthStore(s => s.token);
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
    _connect(token);
    return () => {
      _hookRefCount--;
      if (_hookRefCount <= 0) { _hookRefCount = 0; _disconnect(); }
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
    const url = `${getWsBase()}/ws/booking/${bookingId}?token=${token}`;

    let backoff = 1000;
    let intentionalClose = false;
    let reconnTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let ws: WebSocket | null = null;

    function connect() {
      if (ws?.readyState === WebSocket.OPEN) return;
      setStatus('connecting');
      ws = new WebSocket(url);

      ws.onopen = () => {
        backoff = 1000;
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

      ws.onclose = () => {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        setStatus('disconnected');
        if (!intentionalClose) {
          reconnTimer = setTimeout(connect, Math.min(backoff, 16_000));
          backoff = Math.min(backoff * 2, 16_000);
        }
      };

      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      intentionalClose = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnTimer) clearTimeout(reconnTimer);
      ws?.close();
    };
  }, [bookingId, token]);

  return { status, lastEvent };
}
