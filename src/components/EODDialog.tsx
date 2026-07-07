/**
 * EODDialog.tsx — End-of-Day Incomplete Booking Enforcement
 *
 * At 20:00 (8 PM) checks for any booking scheduled TODAY that is not
 * CLOSED / PAID / SETTLED / CANCELLED. Displays a blocking modal that
 * lists them and requires CCO to reschedule each one before dismissing.
 *
 * - Mounts globally in MainLayout.
 * - Fires once per day (tracks date in sessionStorage so it doesn't re-fire
 *   if CCO navigates away and comes back within the same session).
 * - Each incomplete booking row has a "Reschedule" button that opens
 *   RescheduleModal. Once all are rescheduled the "Done" button unlocks.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { bookingService } from '../services/booking.service';
import { Booking } from '../types';
import { statusColors, statusLabels } from '../utils/statusColors';
import { RescheduleModal } from './bookings/RescheduleModal';

const EOD_HOUR = 20; // 8 PM trigger
const CLOSED_STATUSES = ['PAID', 'CLOSED', 'SETTLED', 'CANCELLED', 'NO_SHOW', 'REFUND_INITIATED'];

export function EODDialog() {
  const [show, setShow] = useState(false);
  const [incompleteBookings, setIncompleteBookings] = useState<Booking[]>([]);
  const [rescheduledIds, setRescheduledIds] = useState<Set<string>>(new Set());
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null);

  const checkEOD = useCallback(async () => {
    const now = new Date();
    if (now.getHours() < EOD_HOUR) return;

    // Only fire once per day per session
    const todayKey = `eod_shown_${now.toISOString().split('T')[0]}`;
    if (sessionStorage.getItem(todayKey)) return;

    try {
      const bookings = await bookingService.getTodayBookings();
      const incomplete = bookings.filter((b) => !CLOSED_STATUSES.includes(b.status));
      if (incomplete.length === 0) return;

      setIncompleteBookings(incomplete);
      setShow(true);
      sessionStorage.setItem(todayKey, '1');
    } catch {
      // silent — don't block CCO if API is slow
    }
  }, []);

  useEffect(() => {
    checkEOD();
    // Also set an interval that fires at exactly 8:00 PM
    const interval = setInterval(checkEOD, 60 * 1000); // check every minute
    return () => clearInterval(interval);
  }, [checkEOD]);

  const handleRescheduled = (bookingId: string) => {
    setRescheduledIds((prev) => new Set([...prev, bookingId]));
    // Also remove from incompleteBookings list
    setIncompleteBookings((prev) => prev.filter((b) => b.id !== bookingId));
    setRescheduleTarget(null);
  };

  const allDone = incompleteBookings.length === 0;

  if (!show) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">End of day — action required</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {incompleteBookings.length} booking{incompleteBookings.length !== 1 ? 's' : ''} scheduled
                  today {incompleteBookings.length !== 1 ? 'are' : 'is'} not yet completed.
                  Reschedule each one before closing your shift.
                </p>
              </div>
            </div>
          </div>

          {/* Booking list */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {incompleteBookings.map((booking) => (
              <div
                key={booking.id}
                className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{booking.booking_number}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {booking.customer?.name}
                    {booking.scheduled_slot && ` · Slot: ${booking.scheduled_slot}`}
                  </p>
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                  statusColors[booking.status] || 'bg-gray-100 text-gray-700'
                }`}>
                  {statusLabels[booking.status] || booking.status}
                </span>
                <button
                  onClick={() => setRescheduleTarget(booking)}
                  className="shrink-0 text-xs bg-[#1B4FD8] text-white px-3 py-1.5 rounded-lg hover:bg-[#1640B0] transition font-medium"
                >
                  Reschedule
                </button>
              </div>
            ))}

            {allDone && (
              <div className="flex flex-col items-center py-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center mb-3">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-900">All bookings rescheduled</p>
                <p className="text-xs text-gray-500 mt-1">Great work! You can now close your shift.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {rescheduledIds.size} of {rescheduledIds.size + incompleteBookings.length} rescheduled
            </p>
            <button
              onClick={() => setShow(false)}
              disabled={!allDone}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
                allDone
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {allDone ? 'Close shift ✓' : `Reschedule remaining (${incompleteBookings.length})`}
            </button>
          </div>
        </div>
      </div>

      {rescheduleTarget && (
        <RescheduleModal
          open={!!rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          bookingId={rescheduleTarget.id}
          bookingNumber={rescheduleTarget.booking_number}
          onRescheduled={() => handleRescheduled(rescheduleTarget.id)}
        />
      )}
    </>
  );
}
