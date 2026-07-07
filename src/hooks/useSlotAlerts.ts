/**
 * useSlotAlerts.ts
 * Polls today's bookings every 2 minutes and surfaces bookings whose slot
 * start time has passed but the technician hasn't moved yet (still in
 * PENDING / CONFIRMED / ASSIGNED / ACCEPTED / EN_ROUTE).
 *
 * Returns:
 *   alerts  — array of bookings that need CCO attention RIGHT NOW
 *   refresh — manual trigger (call after rescheduling or reminding)
 */
import { useState, useEffect, useCallback } from 'react';
import { bookingService } from '../services/booking.service';
import { Booking } from '../types';

export interface SlotAlert {
  booking: Booking;
  slotStart: string;   // e.g. "08:00"
  minutesOverdue: number;
}

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE'];
const POLL_MS = 2 * 60 * 1000; // 2 minutes

export function useSlotAlerts() {
  const [alerts, setAlerts] = useState<SlotAlert[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const compute = useCallback((bookings: Booking[]): SlotAlert[] => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    return bookings
      .filter((b) => {
        if (!b.scheduled_slot) return false;
        if (!ACTIVE_STATUSES.includes(b.status)) return false;
        const [h, m] = b.scheduled_slot.split(':').map(Number);
        const slotMin = h * 60 + m;
        return nowMin > slotMin + 15; // 15 min grace period after slot start
      })
      .map((b) => {
        const [h, m] = b.scheduled_slot!.split(':').map(Number);
        const slotMin = h * 60 + m;
        const now2 = new Date();
        const nowMin2 = now2.getHours() * 60 + now2.getMinutes();
        return {
          booking: b,
          slotStart: b.scheduled_slot!.split('-')[0],
          minutesOverdue: nowMin2 - slotMin,
        };
      })
      .sort((a, b) => b.minutesOverdue - a.minutesOverdue);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const bookings = await bookingService.getTodayBookings();
      const newAlerts = compute(bookings).filter((a) => !dismissedIds.has(a.booking.id));
      setAlerts(newAlerts);
    } catch {
      // silent — CCO can still work without alerts
    }
  }, [compute, dismissedIds]);

  const dismiss = useCallback((bookingId: string) => {
    setDismissedIds((prev) => new Set([...prev, bookingId]));
    setAlerts((prev) => prev.filter((a) => a.booking.id !== bookingId));
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { alerts, refresh, dismiss };
}
