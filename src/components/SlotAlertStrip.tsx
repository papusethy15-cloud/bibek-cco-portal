/**
 * SlotAlertStrip.tsx
 * A persistent top-of-page alert strip that surfaces overdue booking slots
 * in real-time. Mounted in MainLayout so it appears on every page.
 *
 * Each alert card shows:
 *   - Booking number + customer name
 *   - Slot time + minutes overdue (live countdown text)
 *   - Status badge
 *   - "Remind Tech" button  → opens BookingWorkflowPanel to the booking
 *   - "Reschedule" button   → opens RescheduleModal directly
 *   - Dismiss (×) to suppress this alert until next poll cycle
 */
import React, { useState } from 'react';
import { useSlotAlerts } from '../hooks/useSlotAlerts';
import { Booking } from '../types';
import { statusColors, statusLabels } from '../utils/statusColors';
import { RescheduleModal } from './bookings/RescheduleModal';

interface Props {
  onOpenBooking: (booking: Booking) => void;
}

export function SlotAlertStrip({ onOpenBooking }: Props) {
  const { alerts, refresh, dismiss } = useSlotAlerts();
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);

  if (alerts.length === 0) return null;

  return (
    <>
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 shrink-0">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2">
          {/* Pulsing red dot */}
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
          <p className="text-xs font-bold text-amber-900 uppercase tracking-wide">
            {alerts.length} slot{alerts.length > 1 ? 's' : ''} overdue — immediate action required
          </p>
        </div>

        {/* Alert cards */}
        <div className="flex flex-col gap-2">
          {alerts.map(({ booking, slotStart, minutesOverdue }) => (
            <div
              key={booking.id}
              className="flex items-center gap-3 bg-white border border-amber-200 rounded-xl px-4 py-2.5"
            >
              {/* Clock icon */}
              <svg
                className="w-5 h-5 text-amber-500 shrink-0"
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>

              {/* Booking info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {booking.booking_number}
                  {booking.customer?.name && (
                    <span className="font-normal text-gray-500"> · {booking.customer.name}</span>
                  )}
                </p>
                <p className="text-xs text-amber-700 font-medium">
                  Slot started {slotStart} — {minutesOverdue} min overdue
                </p>
              </div>

              {/* Status badge */}
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                statusColors[booking.status] || 'bg-gray-100 text-gray-700'
              }`}>
                {statusLabels[booking.status] || booking.status}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onOpenBooking(booking)}
                  className="text-xs bg-[#1B4FD8] text-white px-3 py-1.5 rounded-lg hover:bg-[#1640B0] transition font-medium"
                >
                  Open &amp; Remind
                </button>
                <button
                  onClick={() => setRescheduleTarget(booking)}
                  className="text-xs bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-200 transition font-medium"
                >
                  Reschedule
                </button>
                <button
                  onClick={() => dismiss(booking.id)}
                  className="text-gray-400 hover:text-gray-600 transition p-1"
                  title="Dismiss this alert"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reschedule modal triggered from the strip */}
      {rescheduleTarget && (
        <RescheduleModal
          open={!!rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          bookingId={rescheduleTarget.id}
          bookingNumber={rescheduleTarget.booking_number}
          onRescheduled={() => {
            dismiss(rescheduleTarget.id);
            setRescheduleTarget(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
