/**
 * useBadgeCounts.ts
 * Polls live counts every 3 minutes and exposes them via a shared context.
 * Used by Sidebar to render live red badge numbers on nav items.
 */
import { useState, useEffect, useCallback } from 'react';
import { bookingService } from '../services/booking.service';
import { escalationService } from '../services/escalation.service';
import { paymentService } from '../services/payment.service';
import { callbackRequestService } from '../services/callbackRequest.service';

export interface BadgeCounts {
  overdueSlots: number;   // bookings today that missed their slot (active statuses)
  openEscalations: number;
  overduePayLater: number;
  pendingCallbacks: number;
}

const POLL_INTERVAL = 3 * 60 * 1000; // 3 minutes

export function useBadgeCounts(): BadgeCounts {
  const [counts, setCounts] = useState<BadgeCounts>({
    overdueSlots: 0,
    openEscalations: 0,
    overduePayLater: 0,
    pendingCallbacks: 0,
  });

  const refresh = useCallback(async () => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const today = now.toISOString().split('T')[0];

    const [bookingsRes, escalationsRes, payLaterRes, callbackRes] = await Promise.allSettled([
      bookingService.getTodayBookings(),
      escalationService.list({ status: 'OPEN', limit: 1 }),
      paymentService.getPayLaterDue(),
      callbackRequestService.list({ status: 'PENDING', limit: 1 }),
    ]);

    let overdueSlots = 0;
    if (bookingsRes.status === 'fulfilled') {
      overdueSlots = bookingsRes.value.filter((b) => {
        if (!b.scheduled_slot) return false;
        if (!['PENDING', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE'].includes(b.status)) return false;
        const [h, m] = b.scheduled_slot.split(':').map(Number);
        return h * 60 + m < nowMin - 15; // warn 15 min after slot start
      }).length;
    }

    let openEscalations = 0;
    if (escalationsRes.status === 'fulfilled') {
      openEscalations = (escalationsRes.value as any).total || 0;
    }

    let overduePayLater = 0;
    if (payLaterRes.status === 'fulfilled') {
      overduePayLater = payLaterRes.value.filter((t: any) => {
        const match = (t.notes || '').match(/PAY_LATER: due (\d{4}-\d{2}-\d{2})/);
        return match && match[1] < today;
      }).length;
    }

    let pendingCallbacks = 0;
    if (callbackRes.status === 'fulfilled') {
      pendingCallbacks = (callbackRes.value as any).total || 0;
    }

    setCounts({ overdueSlots, openEscalations, overduePayLater, pendingCallbacks });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  return counts;
}
