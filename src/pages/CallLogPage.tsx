import { todayIST } from "../lib/tz";
import React, { useState, useEffect, useCallback } from 'react';
import { callLogService, CallLogEntry } from '../services/callLog.service';
import { customerService } from '../services/customer.service';
import { bookingService } from '../services/booking.service';
import { Spinner } from '../components/ui/Spinner';
import { AlertBanner } from '../components/ui/AlertBanner';
import { Input } from '../components/ui/Input';
import { BookingWorkflowPanel } from '../components/bookings/BookingWorkflowPanel';
import { Booking } from '../types';

const outcomeColors: Record<string, string> = {
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  TICKET_RAISED: 'bg-blue-100 text-blue-800',
  NO_ANSWER: 'bg-gray-100 text-gray-700',
  CALLBACK_REQUESTED: 'bg-amber-100 text-amber-800',
  PAYMENT_REMINDER: 'bg-purple-100 text-purple-800',
  OTHER: 'bg-gray-100 text-gray-600',
};

const directionIcon = (d: string) =>
  d === 'INBOUND'
    ? <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7 7m0 0l7-7m-7 7V3" /></svg>
    : <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7-7m0 0l-7 7m7-7v18" /></svg>;

function fmtDuration(secs?: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export function CallLogPage() {
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [mobileSearch, setMobileSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [mobileSearching, setMobileSearching] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Booking workflow
  const [workflowBooking, setWorkflowBooking] = useState<Booking | null>(null);

  const handleMobileSearch = async (mobile: string) => {
    setMobileSearch(mobile);
    if (!mobile || mobile.length < 10) { setCustomerId(''); return; }
    setMobileSearching(true);
    try {
      const found = await customerService.searchByMobile(mobile);
      setCustomerId(found?.id || '');
    } catch {
      setCustomerId('');
    } finally {
      setMobileSearching(false);
    }
  };

  const openBookingWorkflow = async (bookingId: string) => {
    try {
      const b = await bookingService.getById(bookingId);
      setWorkflowBooking(b);
    } catch {}
  };

  const [stats, setStats] = useState({ today: 0, resolved: 0, noAnswer: 0, avgDuration: 0, callbacks: 0 });
  const PER_PAGE = 20;

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const res = await callLogService.list({
        customer_id: customerId || undefined,
        outcome: outcomeFilter || undefined,
        direction: directionFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page: pg,
        per_page: PER_PAGE,
      });
      setCalls(res.items || []);
      setTotal(res.total || 0);
      setPage(pg);
    } catch {
      setError('Failed to load call logs.');
    } finally {
      setLoading(false);
    }
  }, [customerId, outcomeFilter, directionFilter, dateFrom, dateTo]);

  useEffect(() => { load(1); }, [load]);

  useEffect(() => {
    const today = todayIST();
    const todayCalls = calls.filter(c => c.created_at?.startsWith(today));
    const resolved = calls.filter(c => c.outcome === 'RESOLVED').length;
    const noAnswer = calls.filter(c => c.outcome === 'NO_ANSWER').length;
    const callbacks = calls.filter(c => c.outcome === 'CALLBACK_REQUESTED').length;
    const durations = calls.filter(c => c.duration_seconds).map(c => c.duration_seconds!);
    const avg = durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;
    setStats({ today: todayCalls.length, resolved, noAnswer, avgDuration: avg, callbacks });
  }, [calls]);

  const clearFilters = () => {
    setMobileSearch(''); setCustomerId(''); setOutcomeFilter('');
    setDirectionFilter(''); setDateFrom(''); setDateTo('');
  };
  const hasFilters = mobileSearch || outcomeFilter || directionFilter || dateFrom || dateTo;
  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Call Log</h1>
        <p className="text-gray-500 mt-1">History of all CCO customer interactions.</p>
      </div>

      {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Today's Calls", value: stats.today, color: 'bg-blue-50 text-blue-900' },
          { label: 'Resolved', value: stats.resolved, color: 'bg-emerald-50 text-emerald-900' },
          { label: 'No Answer', value: stats.noAnswer, color: 'bg-gray-50 text-gray-700' },
          { label: 'Callbacks Due', value: stats.callbacks, color: 'bg-amber-50 text-amber-900' },
          { label: 'Avg Duration', value: fmtDuration(stats.avgDuration), color: 'bg-purple-50 text-purple-900' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.color}`}>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        {/* Mobile search */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Filter by Mobile</label>
          <div className="relative">
            <Input
              placeholder="Enter 10-digit mobile..."
              value={mobileSearch}
              onChange={e => handleMobileSearch(e.target.value)}
            />
            {mobileSearching && <span className="absolute right-3 top-2.5 text-xs text-gray-400">searching...</span>}
            {mobileSearch && !mobileSearching && customerId && <span className="absolute right-3 top-2.5 text-xs text-emerald-600">✓ found</span>}
            {mobileSearch && !mobileSearching && !customerId && mobileSearch.length >= 10 && <span className="absolute right-3 top-2.5 text-xs text-red-500">not found</span>}
          </div>
        </div>

        {/* Direction filter — NEW */}
        <div className="min-w-[130px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Direction</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            value={directionFilter} onChange={e => setDirectionFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="INBOUND">↓ Inbound</option>
            <option value="OUTBOUND">↑ Outbound</option>
          </select>
        </div>

        {/* Outcome filter */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Outcome</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}
          >
            <option value="">All Outcomes</option>
            <option value="RESOLVED">Resolved</option>
            <option value="TICKET_RAISED">Ticket Raised</option>
            <option value="NO_ANSWER">No Answer</option>
            <option value="CALLBACK_REQUESTED">Callback Requested</option>
            <option value="PAYMENT_REMINDER">Payment Reminder</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        {/* Date range — NEW */}
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
          <input
            type="date"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
          <input
            type="date"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            value={dateTo} onChange={e => setDateTo(e.target.value)}
          />
        </div>

        {hasFilters && (
          <button onClick={clearFilters} className="text-sm text-gray-400 hover:text-gray-600 py-2">Clear</button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <p className="text-sm text-gray-500">{total} call{total !== 1 ? 's' : ''} total</p>
          {hasFilters && <p className="text-xs text-[#1B4FD8]">Filters active</p>}
        </div>

        {loading ? (
          <div className="py-16"><Spinner /></div>
        ) : calls.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">No call logs found.</p>
            <p className="text-gray-300 text-xs mt-1">Call logs are created when you log a call from the Customers page.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {calls.map(c => (
              <div key={c.id} className="px-5 py-4 hover:bg-gray-50/50 transition">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{directionIcon(c.direction)}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{c.cco_name}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${outcomeColors[c.outcome] || 'bg-gray-100 text-gray-700'}`}>
                          {c.outcome.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          {directionIcon(c.direction)}
                          {c.direction}
                        </span>
                        {c.duration_seconds && (
                          <span className="text-xs text-gray-400">{fmtDuration(c.duration_seconds)}</span>
                        )}
                      </div>
                      {c.summary && (
                        <p className="text-xs text-gray-600 mt-1">{c.summary}</p>
                      )}
                      {/* Booking link — clickable, not just UUID */}
                      {c.booking_id && (
                        <button
                          onClick={() => openBookingWorkflow(c.booking_id!)}
                          className="text-xs text-[#1B4FD8] hover:underline mt-0.5 font-medium"
                        >
                          📋 Open Booking →
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 shrink-0">
                    {new Date(c.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-4 border-t border-gray-50">
            <button onClick={() => load(page - 1)} disabled={page <= 1} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Prev</button>
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <button onClick={() => load(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next →</button>
          </div>
        )}
      </div>

      {workflowBooking && (
        <BookingWorkflowPanel
          booking={workflowBooking}
          onClose={() => setWorkflowBooking(null)}
          onUpdated={() => { load(page); setWorkflowBooking(null); }}
        />
      )}
    </div>
  );
}
