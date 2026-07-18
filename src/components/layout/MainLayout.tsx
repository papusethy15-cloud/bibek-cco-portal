import { todayIST } from "../../lib/tz";
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '../../store/authStore';
import { SlotAlertStrip } from '../SlotAlertStrip';
import { EODDialog } from '../EODDialog';
import { BookingWorkflowPanel } from '../bookings/BookingWorkflowPanel';
import { bookingService } from '../../services/booking.service';
import api from '../../services/api';
import { escalationService } from '../../services/escalation.service';
import { paymentService } from '../../services/payment.service';
import { Booking } from '../../types';
import { setIdleCountdownListener, IdleCountdownState } from '../../hooks/useIdleLock';
import { authService } from '../../services/auth.service';

interface MainLayoutProps {
  children: React.ReactNode;
}

function useClock() {
  const [time, setTime] = React.useState(new Date());
  React.useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}

// ── In-app notification bell ────────────────────────────────────────────────
interface AppNotification {
  id: string;
  type: 'escalation_reply' | 'payment_overdue' | 'slot_warning';
  message: string;
  timestamp: Date;
  read: boolean;
}

function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const seenEscIds = useRef<Set<string>>(new Set());
  const seenPayIds = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const [escRes, payRes] = await Promise.allSettled([
        escalationService.list({ status: 'OPEN', limit: 20 }),
        paymentService.getPayLaterDue(),
      ]);

      const newNotifs: AppNotification[] = [];
      const today = todayIST();

      // New admin replies on escalations
      if (escRes.status === 'fulfilled') {
        const escs = (escRes.value as any).items || [];
        escs.forEach((e: any) => {
          if (e.resolution_notes && !seenEscIds.current.has(e.id)) {
            seenEscIds.current.add(e.id);
            newNotifs.push({
              id: `esc-${e.id}`,
              type: 'escalation_reply',
              message: `Admin replied to ticket: ${e.subject?.substring(0, 40)}...`,
              timestamp: new Date(),
              read: false,
            });
          }
        });
      }

      // Overdue pay-later
      if (payRes.status === 'fulfilled') {
        const due: any[] = payRes.value;
        due.forEach((t: any) => {
          const match = (t.notes || '').match(/PAY_LATER: due (\d{4}-\d{2}-\d{2})/);
          if (match && match[1] < today && !seenPayIds.current.has(t.id)) {
            seenPayIds.current.add(t.id);
            newNotifs.push({
              id: `pay-${t.id}`,
              type: 'payment_overdue',
              message: `Pay-later overdue: ₹${(t.amount || 0).toLocaleString('en-IN')} — due ${match[1]}`,
              timestamp: new Date(),
              read: false,
            });
          }
        });
      }

      if (newNotifs.length > 0) {
        setNotifications(prev => [...newNotifs, ...prev].slice(0, 20));
      }
    } catch {}
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 5 * 60 * 1000); // every 5 min
    return () => clearInterval(interval);
  }, [poll]);

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const clearAll = () => setNotifications([]);
  const unreadCount = notifications.filter(n => !n.read).length;

  return { notifications, unreadCount, markAllRead, clearAll };
}

// ── Global search ───────────────────────────────────────────────────────────
function GlobalSearchBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        // Search bookings by number and customers by mobile/name
        const [bRes, cRes] = await Promise.allSettled([
          bookingService.list({ search: query, per_page: 4 }).catch(() => ({ items: [] })),
          api.get(`/customers?search=${encodeURIComponent(query)}&per_page=4`)
            .then((r: any) => r.data?.data || { items: [] }).catch(() => ({ items: [] })),
        ]);
        const bookings = bRes.status === 'fulfilled' ? ((bRes.value as any).items || []) : [];
        const customers = cRes.status === 'fulfilled' ? ((cRes.value as any).items || []) : [];
        setResults([
          ...customers.slice(0, 3).map((c: any) => ({ type: 'customer', label: c.name, sub: c.mobile, id: c.id })),
          ...bookings.slice(0, 4).map((b: any) => ({ type: 'booking', label: b.booking_number, sub: `${b.customer?.name} · ${b.status}`, id: b.id })),
        ]);
      } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const go = (r: any) => {
    setOpen(false); setQuery(''); setResults([]);
    if (r.type === 'customer') navigate('/customers', { state: { searchMobile: r.sub } });
    else navigate('/bookings', { state: { searchId: r.id } });
  };

  return (
    <>
      {/* Search trigger button */}
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition min-w-[160px]"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        Search booking / customer
        <span className="ml-auto font-mono bg-gray-100 px-1 rounded text-[10px]">⌘K</span>
      </button>

      {/* Search overlay */}
      {open && (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-24 px-4">
          <div className="fixed inset-0 bg-black/30" onClick={() => { setOpen(false); setQuery(''); setResults([]); }} />
          <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
              <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
                placeholder="Search by booking number, customer name or mobile..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoComplete="off"
              />
              {searching && <div className="w-3.5 h-3.5 border-2 border-[#1B4FD8] border-t-transparent rounded-full animate-spin" />}
              <kbd
                onClick={() => { setOpen(false); setQuery(''); setResults([]); }}
                className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded cursor-pointer hover:bg-gray-200"
              >
                ESC
              </kbd>
            </div>
            {results.length > 0 ? (
              <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
                {results.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => go(r)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition text-left"
                  >
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.type === 'customer' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
                      {r.type === 'customer' ? '👤' : '📋'}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{r.label}</p>
                      <p className="text-xs text-gray-400">{r.sub}</p>
                    </div>
                    <svg className="w-3.5 h-3.5 text-gray-300 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            ) : query.length >= 2 && !searching ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">No results for "{query}"</div>
            ) : (
              <div className="px-4 py-4 text-xs text-gray-400 space-y-1">
                <p>💡 Try a booking number (e.g. BK-2024-001)</p>
                <p>💡 Or a customer mobile number / name</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Notification Bell ───────────────────────────────────────────────────────
function NotificationBell({ notifications, unreadCount, markAllRead, clearAll }: {
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  clearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const iconColors: Record<string, string> = {
    escalation_reply: 'text-violet-500',
    payment_overdue: 'text-red-500',
    slot_warning: 'text-amber-500',
  };
  const iconEmoji: Record<string, string> = {
    escalation_reply: '🎫',
    payment_overdue: '💳',
    slot_warning: '⏰',
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(v => !v); if (!open && unreadCount > 0) markAllRead(); }}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition"
        title="Notifications"
      >
        <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-bold text-gray-800">Notifications</p>
            <div className="flex gap-2">
              {notifications.length > 0 && (
                <button onClick={clearAll} className="text-xs text-gray-400 hover:text-gray-600">Clear all</button>
              )}
            </div>
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              <p className="text-2xl mb-2">🔔</p>
              <p>No notifications</p>
              <p className="text-xs mt-1">Escalation replies, payment overdue, and slot warnings appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
              {notifications.map(n => (
                <div key={n.id} className={`px-4 py-3 flex gap-3 ${n.read ? 'opacity-60' : 'bg-blue-50/30'}`}>
                  <span className={`text-base shrink-0 ${iconColors[n.type] || 'text-gray-500'}`}>
                    {iconEmoji[n.type] || '🔔'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 leading-snug">{n.message}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {n.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {!n.read && <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-1" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MainLayout({ children }: MainLayoutProps) {
  const [idleCountdown, setIdleCountdown] = React.useState<IdleCountdownState>({ active: false, secondsLeft: 0 });
  const { logout } = useAuthStore();

  // Subscribe to idle countdown changes from useIdleLock
  React.useEffect(() => {
    setIdleCountdownListener(setIdleCountdown);
    return () => setIdleCountdownListener(null);
  }, []);

  const handleStayActive = () => {
    // Any interaction resets timer in useIdleLock via DOM events; just dismiss visually
    window.dispatchEvent(new MouseEvent('mousedown'));
  };

  const handleIdleLogout = async () => {
    await authService.checkOut();
    authService.logout();
    logout();
    window.location.href = '/login';
  };
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const clock = useClock();
  const { notifications, unreadCount, markAllRead, clearAll } = useNotifications();

  // Global booking workflow panel — opened by SlotAlertStrip "Open & Remind"
  const [workflowBooking, setWorkflowBooking] = useState<Booking | null>(null);

  const handleOpenBooking = useCallback(async (booking: Booking) => {
    try {
      const fresh = await bookingService.getById(booking.id);
      setWorkflowBooking(fresh);
    } catch {
      setWorkflowBooking(booking);
    }
  }, []);

  const timeStr = clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dateStr = clock.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ── Idle Logout Countdown Banner ─────────────────────────────── */}
      {idleCountdown.active && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'linear-gradient(90deg,#DC2626,#B91C1C)',
          color: 'white', padding: '12px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          boxShadow: '0 4px 20px rgba(220,38,38,0.4)', fontFamily: 'system-ui,sans-serif',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Idle timeout — logging out in {idleCountdown.secondsLeft}s</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>15 minutes of no activity detected. Your session will be checked out automatically.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleStayActive} style={{
              background: 'white', color: '#DC2626', border: 'none', borderRadius: 8,
              padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}>Stay Active</button>
            <button onClick={handleIdleLogout} style={{
              background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.5)',
              borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}>Logout Now</button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((p) => !p)} />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Live session active" />
            {/* Global search bar */}
            <GlobalSearchBar />
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-gray-800">{timeStr}</p>
              <p className="text-xs text-gray-400">{dateStr}</p>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            {/* Notification bell */}
            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              markAllRead={markAllRead}
              clearAll={clearAll}
            />
            <div
              className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded-lg transition"
              onClick={() => navigate('/profile')}
              title="My Profile"
            >
              <div className="w-8 h-8 rounded-full bg-[#1B4FD8] flex items-center justify-center text-white font-bold text-sm shrink-0">
                {user?.name?.charAt(0)?.toUpperCase() || 'C'}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium text-gray-800 leading-tight">{user?.name}</p>
                <p className="text-[11px] text-gray-400">{user?.role}</p>
              </div>
            </div>
          </div>
        </header>

        {/* ── Slot alert strip (auto-shown when overdue slots exist) ── */}
        <SlotAlertStrip onOpenBooking={handleOpenBooking} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* ── End-of-Day enforcement dialog ── */}
      <EODDialog />

      {/* ── Global booking workflow panel (opened by SlotAlertStrip) ── */}
      {workflowBooking && (
        <BookingWorkflowPanel
          booking={workflowBooking}
          onClose={() => setWorkflowBooking(null)}
          onUpdated={() => setWorkflowBooking(null)}
        />
      )}
    </div>
  );
}
