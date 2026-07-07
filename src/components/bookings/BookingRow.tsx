import React from 'react';
import { Booking } from '../../types';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  PENDING:                { bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B' },
  CONFIRMED:              { bg: '#EFF6FF', text: '#1D4ED8', dot: '#3B82F6' },
  ASSIGNED:               { bg: '#F5F3FF', text: '#6D28D9', dot: '#8B5CF6' },
  ACCEPTED:               { bg: '#ECFDF5', text: '#065F46', dot: '#10B981' },
  EN_ROUTE:               { bg: '#E0F2FE', text: '#0369A1', dot: '#0EA5E9' },
  ARRIVED:                { bg: '#CFFAFE', text: '#0E7490', dot: '#06B6D4' },
  INSPECTING:             { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316' },
  IN_PROGRESS:            { bg: '#F0FDF4', text: '#166534', dot: '#22C55E' },
  WORK_STARTED:           { bg: '#F0FDF4', text: '#166534', dot: '#22C55E' },
  WORK_PAUSED:            { bg: '#FFF7ED', text: '#9A3412', dot: '#F97316' },
  COMPLETED:              { bg: '#ECFDF5', text: '#065F46', dot: '#10B981' },
  INVOICE_GENERATED:      { bg: '#F5F3FF', text: '#5B21B6', dot: '#7C3AED' },
  PAYMENT_PENDING:        { bg: '#FEF2F2', text: '#991B1B', dot: '#EF4444' },
  PAID:                   { bg: '#ECFDF5', text: '#065F46', dot: '#059669' },
  PENDING_VERIFICATION:   { bg: '#F5F3FF', text: '#5B21B6', dot: '#7C3AED' },
  CLOSED:                 { bg: '#F8FAFC', text: '#374151', dot: '#6B7280' },
  SETTLED:                { bg: '#F8FAFC', text: '#374151', dot: '#6B7280' },
  CANCELLED:              { bg: '#FEF2F2', text: '#991B1B', dot: '#EF4444' },
  CANCELLATION_REQUESTED: { bg: '#FEF2F2', text: '#9F1239', dot: '#F43F5E' },
  RESCHEDULED:            { bg: '#FFFBEB', text: '#92400E', dot: '#F59E0B' },
  NO_SHOW:                { bg: '#FEF2F2', text: '#991B1B', dot: '#DC2626' },
  QUOTATION_APPROVED:     { bg: '#ECFDF5', text: '#065F46', dot: '#10B981' },
  REFUND_INITIATED:       { bg: '#FDF2F8', text: '#9D174D', dot: '#EC4899' },
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', CONFIRMED: 'Confirmed', ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted', EN_ROUTE: 'On the Way', ARRIVED: 'Arrived',
  INSPECTING: 'Inspecting', IN_PROGRESS: 'In Progress',
  WORK_STARTED: 'Work Started', WORK_PAUSED: 'Paused',
  COMPLETED: 'Work Done', INVOICE_GENERATED: 'Invoice Ready',
  PAYMENT_PENDING: 'Payment Pending', PAID: 'Paid',
  PENDING_VERIFICATION: 'Verify Payment', CLOSED: 'Closed',
  SETTLED: 'Settled', CANCELLED: 'Cancelled',
  CANCELLATION_REQUESTED: 'Cancel Requested', RESCHEDULED: 'Rescheduled',
  NO_SHOW: 'No Show', QUOTATION_APPROVED: 'Quote Approved',
  REFUND_INITIATED: 'Refund Initiated',
};

// Statuses that need immediate CCO attention
const URGENT = new Set(['PENDING', 'CANCELLATION_REQUESTED', 'PAYMENT_PENDING', 'PENDING_VERIFICATION']);
const NEEDS_ASSIGN = new Set(['PENDING', 'CONFIRMED']);

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtSlot(slot?: string) {
  if (!slot || slot === '—') return null;
  // Try to normalise "10:00 AM – 12:00 PM" or "10:00-12:00"
  return slot
    .replace('–', '–')
    .replace(' - ', '–')
    .replace(':00', '')
    .replace(':30', ':30');
}

interface Props {
  booking: Booking & {
    customer_name?: string;
    customer_mobile?: string;
    customer_code?: string;
    technician_name?: string;
    technician_mobile?: string;
    technician_confirmed?: boolean;
    domain_name?: string;
    city?: string;
    created_at?: string;
  };
  onClick: () => void;
}

export function BookingRow({ booking, onClick }: Props) {
  const st = booking.status;
  const clr = STATUS_COLOR[st] || STATUS_COLOR.PENDING;
  const label = STATUS_LABEL[st] || st;

  // Resolve customer name (flat field from list API, or nested object from detail API)
  const custName   = booking.customer_name || booking.customer?.name || '—';
  const custMobile = booking.customer_mobile || booking.customer?.mobile || '';
  const techName   = booking.technician_name || booking.technician?.name;
  const techMobile = booking.technician_mobile || booking.technician?.mobile;

  // Use local date string (IST-safe) — toISOString() returns UTC and can show wrong date
  const _now       = new Date();
  const _pad       = (n: number) => String(n).padStart(2, '0');
  const localToday = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
  const isToday    = booking.scheduled_date === localToday;
  const isUrgent   = URGENT.has(st);
  const isOverdue  = isToday && ['PENDING', 'CONFIRMED', 'ASSIGNED'].includes(st);
  const needsAssign = NEEDS_ASSIGN.has(st) && !booking.technician_id;
  const slot       = fmtSlot(booking.scheduled_slot);

  return (
    <tr
      className="border-b border-gray-50 hover:bg-blue-50/30 cursor-pointer transition-colors group"
      onClick={onClick}
    >
      {/* ── Booking # + source ─────────────────── */}
      <td className="px-4 py-3 min-w-[140px]">
        <div className="flex items-start gap-2">
          {isOverdue && (
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 animate-pulse" title="Overdue today" />
          )}
          <div>
            <p className="text-sm font-bold text-gray-900 font-mono group-hover:text-[#1B4FD8] transition-colors">
              {booking.booking_number}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {booking.source && (
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-medium">
                  {booking.source.replace(/_/g, ' ')}
                </span>
              )}
              {booking.domain_name && (
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium truncate max-w-[80px]">
                  {booking.domain_name}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* ── Customer ───────────────────────────── */}
      <td className="px-4 py-3 min-w-[150px]">
        <p className="text-sm font-semibold text-gray-900 truncate max-w-[150px]">{custName}</p>
        {custMobile && (
          <a
            href={`tel:${custMobile}`}
            onClick={e => e.stopPropagation()}
            className="text-xs text-[#1B4FD8] hover:underline"
          >
            {custMobile}
          </a>
        )}
        {booking.city && (
          <p className="text-[10px] text-gray-400 mt-0.5 truncate">📍 {booking.city}</p>
        )}
      </td>

      {/* ── Service ────────────────────────────── */}
      <td className="px-4 py-3 min-w-[140px]">
        <p className="text-sm text-gray-800 truncate max-w-[160px]">{booking.service_name || '—'}</p>
        {(booking.appliance_brand || booking.appliance_model) && (
          <p className="text-[10px] text-gray-400 truncate mt-0.5">
            {[booking.appliance_brand, booking.appliance_model].filter(Boolean).join(' · ')}
          </p>
        )}
      </td>

      {/* ── Schedule ───────────────────────────── */}
      <td className="px-4 py-3 min-w-[120px]">
        <div className={`text-sm font-semibold ${isToday ? 'text-blue-700' : 'text-gray-800'}`}>
          {isToday ? '📅 Today' : fmtDate(booking.scheduled_date)}
        </div>
        {slot && (
          <div className={`text-xs mt-0.5 font-medium ${isOverdue ? 'text-red-600' : 'text-gray-500'}`}>
            ⏰ {slot}
            {isOverdue && <span className="ml-1 text-[10px] font-bold text-red-500">OVERDUE</span>}
          </div>
        )}
      </td>

      {/* ── Technician ─────────────────────────── */}
      <td className="px-4 py-3 min-w-[130px]">
        {techName ? (
          <>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: booking.technician_confirmed ? '#22C55E' : '#F59E0B' }}
                title={booking.technician_confirmed ? 'Confirmed' : 'Awaiting acceptance'}
              />
              <p className="text-sm text-gray-800 font-medium truncate max-w-[110px]">{techName}</p>
            </div>
            {techMobile && (
              <a href={`tel:${techMobile}`} onClick={e => e.stopPropagation()}
                className="text-[10px] text-gray-400 hover:text-[#1B4FD8] hover:underline">{techMobile}</a>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1">
            {needsAssign && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
            )}
            <span className="text-xs text-gray-400 italic">Unassigned</span>
          </div>
        )}
      </td>

      {/* ── Status ─────────────────────────────── */}
      <td className="px-4 py-3">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
          style={{ background: clr.bg, color: clr.text }}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: clr.dot }} />
          {label}
        </span>
        {isUrgent && (
          <p className="text-[10px] text-red-500 font-bold mt-0.5">⚡ Action needed</p>
        )}
        {/* Pay Later badge — shown when customer has a deferred payment pending */}
        {booking.has_pay_later && (
          <p className="text-[10px] text-amber-700 font-bold mt-0.5 flex items-center gap-1">
            <span>⏰</span>
            <span>
              Pay Later
              {booking.pay_later_due
                ? ` — due ${new Date(booking.pay_later_due).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                : ''}
            </span>
          </p>
        )}
        {st === 'RESCHEDULED' && booking.pre_reschedule_status && (() => {
          const pre = booking.pre_reschedule_status!;
          const stageLabel =
            pre === 'IN_PROGRESS'  ? '🔧 Repair in progress'  :
            pre === 'INSPECTING'   ? '🔍 Inspection underway' :
            pre === 'ARRIVED'      ? '📍 Had arrived'         :
            pre === 'EN_ROUTE'     ? '🚗 Was en route'        : null;
          return stageLabel ? (
            <p className="text-[10px] font-bold text-amber-700 mt-0.5">{stageLabel}</p>
          ) : null;
        })()}
      </td>

      {/* ── Amount ─────────────────────────────── */}
      <td className="px-4 py-3 text-right min-w-[90px]">
        <p className="text-sm font-bold text-gray-900">
          {booking.total_amount > 0 ? `₹${booking.total_amount.toLocaleString('en-IN')}` : '—'}
        </p>
        {booking.gst_amount > 0 && (
          <p className="text-[10px] text-gray-400">incl. GST ₹{booking.gst_amount.toLocaleString('en-IN')}</p>
        )}
      </td>
    </tr>
  );
}
