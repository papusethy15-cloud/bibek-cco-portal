import { todayIST, fmtDateIST, fmtDateTimeIST } from "../../lib/tz";
import React from 'react';

interface Props {
  search: string; onSearch: (v: string) => void;
  status: string; onStatus: (v: string) => void;
  date: string;   onDate:   (v: string) => void;
  source: string; onSource: (v: string) => void;
  sort: string;   onSort:   (v: string) => void;
  showClosed: boolean; onShowClosed: (v: boolean) => void;
}

// Quick-filter status groups CCO cares about most
const STATUS_GROUPS = [
  { value: '',            label: 'All Active',  color: '#6B7280' },
  { value: 'PENDING',     label: 'Pending',      color: '#F59E0B' },
  { value: 'CONFIRMED',   label: 'Confirmed',    color: '#3B82F6' },
  { value: 'ASSIGNED',    label: 'Assigned',     color: '#8B5CF6' },
  { value: 'ACCEPTED',    label: 'Accepted',     color: '#10B981' },
  { value: 'IN_PROGRESS', label: 'In Progress',  color: '#22C55E' },
  { value: 'COMPLETED',   label: 'Completed',    color: '#059669' },
  { value: 'PAYMENT_PENDING', label: 'Pay Pending', color: '#EF4444' },
  { value: 'PENDING_VERIFICATION', label: 'Verify', color: '#7C3AED' },
  { value: 'CANCELLATION_REQUESTED', label: 'Cancel Req', color: '#F43F5E' },
  { value: 'CANCELLED',   label: 'Cancelled',    color: '#DC2626' },
];

const SORT_OPTIONS = [
  { value: 'date_desc', label: '📅 Date: Latest first' },
  { value: 'date_asc',  label: '📅 Date: Oldest first' },
  { value: 'status',    label: '🏷 By Status' },
  { value: 'created',   label: '🕐 Created: Newest first' },
];

export function BookingFilters({
  search, onSearch, status, onStatus,
  date, onDate, source, onSource,
  sort, onSort, showClosed, onShowClosed,
}: Props) {
  const hasFilters = search || status || date || source || showClosed;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* ── Status quick-filter chips ── */}
      <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2 flex-wrap">
        {STATUS_GROUPS.map(sg => (
          <button
            key={sg.value}
            onClick={() => onStatus(status === sg.value ? '' : sg.value)}
            className="px-3 py-1 rounded-full text-xs font-semibold transition-all border"
            style={{
              background:   status === sg.value ? sg.color : 'transparent',
              color:        status === sg.value ? 'white'  : sg.color,
              borderColor:  status === sg.value ? sg.color : `${sg.color}40`,
            }}
          >
            {sg.label}
          </button>
        ))}
        <button
          onClick={() => onShowClosed(!showClosed)}
          className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ml-auto ${
            showClosed
              ? 'bg-gray-700 text-white border-gray-700'
              : 'text-gray-500 border-gray-200 hover:border-gray-300'
          }`}
        >
          {showClosed ? '✓ Showing closed' : '+ Show closed'}
        </button>
      </div>

      {/* ── Text search + date + source + sort ── */}
      <div className="px-4 py-3 flex flex-wrap gap-3 items-end">
        {/* Search */}
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-gray-400 mb-1">Search</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] placeholder:text-gray-300"
              placeholder="Booking #, customer name or mobile…"
              value={search}
              onChange={e => onSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Date */}
        <div className="min-w-[160px]">
          <label className="block text-xs font-medium text-gray-400 mb-1">Scheduled Date</label>
          <input
            type="date"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            value={date}
            onChange={e => onDate(e.target.value)}
          />
        </div>

        {/* Source */}
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-gray-400 mb-1">Source</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            value={source}
            onChange={e => onSource(e.target.value)}
          >
            <option value="">All Sources</option>
            <option value="CALL_CENTER">Call Center</option>
            <option value="MOBILE_APP">Mobile App</option>
            <option value="WEBSITE">Website</option>
            <option value="WALK_IN">Walk-in</option>
          </select>
        </div>

        {/* Sort */}
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-gray-400 mb-1">Sort by</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            value={sort}
            onChange={e => onSort(e.target.value)}
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Today shortcut */}
        <button
          onClick={() => onDate(date === todayIST() ? '' : todayIST())}
          className={`px-3 py-2 rounded-lg text-xs font-medium border transition self-end ${
            date === todayIST()
              ? 'bg-blue-600 text-white border-blue-600'
              : 'text-blue-600 border-blue-200 hover:bg-blue-50'
          }`}
        >
          📅 Today
        </button>

        {hasFilters && (
          <button
            onClick={() => { onSearch(''); onStatus(''); onDate(''); onSource(''); onShowClosed(false); }}
            className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg self-end transition"
          >
            ✕ Clear
          </button>
        )}
      </div>
    </div>
  );
}
