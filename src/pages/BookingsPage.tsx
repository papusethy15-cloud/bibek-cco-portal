import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { bookingService, CLOSED_STATUSES } from '../services/booking.service';
import { customerService } from '../services/customer.service';
import { Customer, Booking } from '../types';
import { BookingFilters } from '../components/bookings/BookingFilters';
import { BookingRow } from '../components/bookings/BookingRow';
import { BookingWorkflowPanel } from '../components/bookings/BookingWorkflowPanel';
import { NewBookingModal } from '../components/bookings/NewBookingModal';
import { AlertBanner } from '../components/ui/AlertBanner';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { useCCOWebSocket } from '../hooks/useCCOWebSocket';

const PER_PAGE = 25;

// Status urgency ordering for display (CCO-action-priority sort)
const STATUS_PRIORITY: Record<string, number> = {
  CANCELLATION_REQUESTED: 0,
  PENDING_VERIFICATION: 1,
  PAYMENT_PENDING: 2,
  PENDING: 3,
  CONFIRMED: 4,
  ASSIGNED: 5,
  ACCEPTED: 6,
  EN_ROUTE: 7,
  ARRIVED: 8,
  INSPECTING: 9,
  IN_PROGRESS: 10,
  WORK_PAUSED: 11,
  COMPLETED: 12,
  INVOICE_GENERATED: 13,
  RESCHEDULED: 14,
  CANCELLED: 15,
  PAID: 16,
  CLOSED: 17,
  SETTLED: 18,
};

function sortBookings(items: Booking[], sort: string): Booking[] {
  const arr = [...items];
  if (sort === 'date_asc') {
    return arr.sort((a, b) => {
      const da = (a.scheduled_date || '') + (a.scheduled_slot || '');
      const db = (b.scheduled_date || '') + (b.scheduled_slot || '');
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }
  if (sort === 'date_desc') {
    return arr.sort((a, b) => {
      const da = (a.scheduled_date || '') + (a.scheduled_slot || '');
      const db = (b.scheduled_date || '') + (b.scheduled_slot || '');
      return da > db ? -1 : da < db ? 1 : 0;
    });
  }
  if (sort === 'status') {
    return arr.sort((a, b) =>
      (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99)
    );
  }
  // 'created' — backend default (created_at desc), keep as-is
  return arr;
}

// Group bookings by their scheduled_date for the date-header rows
interface DateGroup { date: string; label: string; items: Booking[] }

function groupByDate(items: Booking[]): DateGroup[] {
  // Use local date arithmetic (IST-safe) — toISOString() returns UTC
  const _localDate = (offsetMs = 0) => {
    const d = new Date(Date.now() + offsetMs);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const today    = _localDate();
  const tomorrow = _localDate(86400000);
  const yesterday = _localDate(-86400000);

  const map = new Map<string, Booking[]>();
  items.forEach(b => {
    const key = b.scheduled_date || 'no-date';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(b);
  });

  return Array.from(map.entries()).map(([date, bookings]) => {
    let label = date;
    if (date === today)     label = '📅 Today';
    else if (date === tomorrow)  label = '📅 Tomorrow';
    else if (date === yesterday) label = '📅 Yesterday';
    else if (date === 'no-date') label = '📅 No Date';
    else label = new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return { date, label, items: bookings };
  });
}

export function BookingsPage() {
  const [bookings,        setBookings]        = useState<Booking[]>([]);
  const [total,           setTotal]           = useState(0);
  const [page,            setPage]            = useState(1);
  const [loading,         setLoading]         = useState(false);
  const [search,          setSearch]          = useState('');
  const [status,          setStatus]          = useState('');
  const [date,            setDate]            = useState('');
  const [source,          setSource]          = useState('');
  const [sort,            setSort]            = useState('date_desc');
  const [showClosed,      setShowClosed]      = useState(false);
  const [selected,        setSelected]        = useState<Booking | null>(null);
  const [showNew,         setShowNew]         = useState(false);
  const [success,         setSuccess]         = useState('');
  const [overdueAlerts,   setOverdueAlerts]   = useState<Booking[]>([]);
  const [prefillCustomer, setPrefillCustomer] = useState<Customer | null>(null);
  const [manualAlerts,    setManualAlerts]    = useState<Array<{ booking_id: string; booking_number: string; message: string; ts: number }>>([]);
  const [groupBySchedule, setGroupBySchedule] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location    = useLocation();

  // Live WS — refresh when any booking changes (new, status change, assignment)
  const { subscribe } = useCCOWebSocket();
  useEffect(() => {
    const unsub = subscribe('BOOKING_STATUS_CHANGED', () => { load(page); });
    const unsub2 = subscribe('ASSIGNMENT_CREATED',     () => { load(page); });
    const unsub3 = subscribe('BOOKING_NEEDS_MANUAL_ASSIGN', (payload: any) => {
      load(page);
      setManualAlerts(prev => [
        { booking_id: payload?.booking_id || '', booking_number: payload?.booking_number || '', message: payload?.message || `Booking ${payload?.booking_number} needs manual assignment.`, ts: Date.now() },
        ...prev.slice(0, 4),
      ]);
    });
    return () => { unsub(); unsub2(); unsub3(); };
  }, [page]);

  // Navigate from CustomerProfileCard
  useEffect(() => {
    const state = location.state as { customerId?: string } | null;
    if (state?.customerId) {
      customerService.getById(state.customerId)
        .then(c => { setPrefillCustomer(c); setShowNew(true); })
        .catch(() => {});
      window.history.replaceState({}, '');
    }
  }, []);

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: pg, per_page: PER_PAGE };
      if (search)  params.search = search;
      if (status)  params.status = status;
      if (date)    params.date   = date;
      if (source)  params.source = source;
      if (showClosed) params.exclude_status = '';   // override default exclusion
      const res = await bookingService.list(params);
      setBookings(res.items || []);
      setTotal(res.total || 0);
      setPage(pg);
    } finally {
      setLoading(false);
    }
  }, [search, status, date, source, showClosed]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(1), 350);
  }, [load]);

  // Today's overdue bookings (once on mount)
  useEffect(() => {
    bookingService.getTodayBookings()
      .then(all => {
        const now = new Date();
        // Build today's date string in LOCAL time (IST), not UTC.
        // new Date().toISOString() gives UTC — in IST (UTC+5:30) this can be
        // yesterday's date before 05:30 AM or always off by one edge-case,
        // causing tomorrow's bookings to be treated as today's.
        const pad  = (n: number) => String(n).padStart(2, '0');
        const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const nowMin = now.getHours() * 60 + now.getMinutes();

        setOverdueAlerts(all.filter(b => {
          // Must be today's date in local time
          if (b.scheduled_date !== todayLocal) return false;
          // Must be an unstarted status
          if (!['PENDING', 'CONFIRMED', 'ASSIGNED'].includes(b.status)) return false;
          // Must have a slot
          if (!b.scheduled_slot) return false;
          // Slot format is "HH:MM-HH:MM" (e.g. "08:00-10:00").
          // Parse only the START time — take everything before the dash.
          const startPart = b.scheduled_slot.split('-')[0]; // "08:00"
          const [sh, sm]  = startPart.split(':').map(Number);
          if (isNaN(sh) || isNaN(sm)) return false;
          const slotEndMin = sh * 60 + sm + 120; // slot end = start + 2h window
          // Overdue = the entire slot window has passed (slot end + 30 min grace)
          return slotEndMin + 30 < nowMin;
        }));
      })
      .catch(() => {});
  }, []);

  const handleCreated = (booking: Booking) => {
    setSuccess(`Booking ${booking.booking_number} created`);
    load(1);
  };

  // Sort + optional grouping
  const sorted  = sortBookings(bookings, sort);
  const groups  = groupBySchedule ? groupByDate(sorted) : [];
  const totalPages = Math.ceil(total / PER_PAGE);

  // Stats pills for the header
  const urgentCount  = bookings.filter(b => ['PENDING', 'CANCELLATION_REQUESTED', 'PAYMENT_PENDING', 'PENDING_VERIFICATION'].includes(b.status)).length;
  const _n2 = new Date(); const _p2 = (n: number) => String(n).padStart(2, '0');
  const _localToday = `${_n2.getFullYear()}-${_p2(_n2.getMonth()+1)}-${_p2(_n2.getDate())}`;
  const todayCount   = bookings.filter(b => b.scheduled_date === _localToday).length;
  const unassigned   = bookings.filter(b => ['PENDING','CONFIRMED'].includes(b.status) && !b.technician_id).length;

  return (
    <div className="p-6 max-w-screen-2xl mx-auto flex flex-col gap-4">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-gray-500">{total} booking{total !== 1 ? 's' : ''}</span>
            {urgentCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {urgentCount} need action
              </span>
            )}
            {todayCount > 0 && (
              <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                📅 {todayCount} today
              </span>
            )}
            {unassigned > 0 && (
              <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                ⚠ {unassigned} unassigned
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Group by date toggle */}
          <button
            onClick={() => setGroupBySchedule(v => !v)}
            className={`px-3 py-2 rounded-lg text-xs font-medium border transition ${
              groupBySchedule ? 'bg-blue-600 text-white border-blue-600' : 'text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {groupBySchedule ? '≡ Date groups' : '≡ Group by date'}
          </button>
          <Button onClick={() => setShowNew(true)}>
            <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Booking
          </Button>
        </div>
      </div>

      {success && <AlertBanner type="success" message={success} onClose={() => setSuccess('')} />}

      {/* ── Manual Assign Needed Alert Banners ───────────────────────────── */}
      {manualAlerts.length > 0 && (
        <div className="space-y-2 mb-3">
          {manualAlerts.map((alert, i) => (
            <div
              key={`${alert.booking_id}-${alert.ts}`}
              className="bg-red-50 border-2 border-red-300 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">🚨</span>
                <div>
                  <p className="text-sm font-bold text-red-800">
                    Manual Assignment Required — #{alert.booking_number}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{alert.message}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => {
                    const bkg = bookings.find((b: any) => b.id === alert.booking_id);
                    if (bkg) setSelected(bkg);
                    setManualAlerts(prev => prev.filter((_, idx) => idx !== i));
                  }}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-700 transition"
                >
                  👷 Assign Now
                </button>
                <button
                  onClick={() => setManualAlerts(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Overdue alert strip ── */}
      {overdueAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800">
              ⚠ {overdueAlerts.length} booking{overdueAlerts.length > 1 ? 's' : ''} overdue today — technician has not started
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {overdueAlerts.map(b => (
                <button
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className="text-xs bg-red-100 hover:bg-red-200 text-red-900 px-3 py-1 rounded-lg transition font-semibold"
                >
                  {b.booking_number} · {b.scheduled_slot}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <BookingFilters
        search={search}   onSearch={setSearch}
        status={status}   onStatus={setStatus}
        date={date}       onDate={setDate}
        source={source}   onSource={setSource}
        sort={sort}       onSort={setSort}
        showClosed={showClosed} onShowClosed={setShowClosed}
      />

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Table header row with refresh */}
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {loading ? 'Loading…' : `${bookings.length} of ${total} booking${total !== 1 ? 's' : ''}`}
          </p>
          <button
            onClick={() => load(page)}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-[#1B4FD8] hover:underline disabled:opacity-40"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-20"><Spinner /></div>
        ) : bookings.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-gray-400 text-sm">No bookings match your filters.</p>
            {(search || status || date || source) && (
              <button onClick={() => { setSearch(''); setStatus(''); setDate(''); setSource(''); }}
                className="mt-3 text-xs text-[#1B4FD8] underline">Clear filters</button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {groupBySchedule ? (
              /* ── Date-grouped view ── */
              groups.map(group => (
                <div key={group.date}>
                  <div className="px-5 py-2 bg-blue-50/60 border-y border-blue-100 sticky top-0 z-10">
                    <p className="text-xs font-bold text-blue-700">
                      {group.label}
                      <span className="ml-2 text-blue-400 font-normal">{group.items.length} booking{group.items.length !== 1 ? 's' : ''}</span>
                    </p>
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/80">
                        {['Booking', 'Customer', 'Service', 'Schedule', 'Technician', 'Status', 'Amount'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(b => (
                        <BookingRow key={b.id} booking={b as any} onClick={() => setSelected(b)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            ) : (
              /* ── Flat table view ── */
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    {['Booking', 'Customer', 'Service', 'Schedule', 'Technician', 'Status', 'Amount'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(b => (
                    <BookingRow key={b.id} booking={b as any} onClick={() => setSelected(b)} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-50">
            <p className="text-sm text-gray-400">
              Page {page} of {totalPages} · {total} total
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => load(1)} disabled={page <= 1}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">«</button>
              <button onClick={() => load(page - 1)} disabled={page <= 1}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">← Prev</button>

              {/* Page number pills */}
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pg: number;
                if (totalPages <= 7) {
                  pg = i + 1;
                } else if (page <= 4) {
                  pg = i + 1;
                } else if (page >= totalPages - 3) {
                  pg = totalPages - 6 + i;
                } else {
                  pg = page - 3 + i;
                }
                return (
                  <button key={pg} onClick={() => load(pg)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                      pg === page
                        ? 'bg-[#1B4FD8] text-white border-[#1B4FD8] font-bold'
                        : 'border-gray-200 hover:bg-gray-50 text-gray-600'
                    }`}>
                    {pg}
                  </button>
                );
              })}

              <button onClick={() => load(page + 1)} disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">Next →</button>
              <button onClick={() => load(totalPages)} disabled={page >= totalPages}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">»</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Workflow panel (slide-over) ── */}
      {selected && (
        <BookingWorkflowPanel
          booking={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => load(page)}
        />
      )}

      {/* ── New Booking modal ── */}
      <NewBookingModal
        open={showNew}
        onClose={() => { setShowNew(false); setPrefillCustomer(null); }}
        onCreated={handleCreated}
        prefillCustomer={prefillCustomer}
      />
    </div>
  );
}
