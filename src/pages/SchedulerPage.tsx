import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { Booking } from '../types';
import { statusColors, statusLabels } from '../utils/statusColors';
import { Spinner } from '../components/ui/Spinner';
import { AlertBanner } from '../components/ui/AlertBanner';
import { RescheduleModal } from '../components/bookings/RescheduleModal';
import { BookingWorkflowPanel } from '../components/bookings/BookingWorkflowPanel';

const SLOTS = [
  '08:00-10:00', '10:00-12:00', '12:00-14:00',
  '14:00-16:00', '16:00-18:00', '18:00-20:00',
];

const slotLabels: Record<string, string> = {
  '08:00-10:00': '8–10 AM',  '10:00-12:00': '10–12 PM',
  '12:00-14:00': '12–2 PM',  '14:00-16:00': '2–4 PM',
  '16:00-18:00': '4–6 PM',   '18:00-20:00': '6–8 PM',
};

// Statuses that mean the booking is still pending action from a CCO/technician
const ACTIVE_STATUSES = [
  'PENDING', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED',
  'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'IN_PROGRESS',
  'WORK_PAUSED', 'RESCHEDULED', 'QUOTATION_APPROVED',
];

// Statuses that represent unserved/overdue when the slot has already passed
const UNSERVED_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED'];

function getWeekDays(baseDate: Date): Date[] {
  const days: Date[] = [];
  const day = baseDate.getDay();
  const monday = new Date(baseDate);
  monday.setDate(baseDate.getDate() - (day === 0 ? 6 : day - 1));
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

/** Returns YYYY-MM-DD in LOCAL time (avoids UTC off-by-one on IST) */
function fmtLocal(d: Date): string {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${dy}`;
}

/**
 * Is a booking overdue?
 * A booking is overdue when:
 *   1. Its scheduled_date is today AND its slot start time has already passed
 *      AND it's still unserved (PENDING / CONFIRMED / ASSIGNED / ACCEPTED)
 *   2. Its scheduled_date is in the past AND it's still in an active status
 *      (it was never completed — missed entirely)
 */
function isBookingOverdue(b: Booking, dateStr: string, todayStr: string, nowMinutes: number): boolean {
  if (dateStr < todayStr) {
    // Past day — any active status = missed / overdue
    return ACTIVE_STATUSES.includes(b.status);
  }
  if (dateStr === todayStr && UNSERVED_STATUSES.includes(b.status)) {
    // Today — check if slot start has passed by > 30 min
    const slot = b.scheduled_slot;
    if (!slot) return false;
    const startPart = slot.split('-')[0]; // e.g. "08:00"
    const [h, m] = startPart.split(':').map(Number);
    return nowMinutes > h * 60 + m + 30;
  }
  return false;
}

/** Fetch all bookings for a single date using the correct date_from / date_to params */
async function fetchDayBookings(dateStr: string): Promise<Booking[]> {
  try {
    // Use date_from = date_to = dateStr to get exactly that day.
    // Do NOT pass exclude_status — scheduler shows ALL statuses (including RESCHEDULED).
    // per_page=100 is the backend param name (not "limit").
    const res = await api.get<any>(
      `/bookings?date_from=${dateStr}&date_to=${dateStr}&per_page=100&page=1`
    );
    return res.data?.data?.items || [];
  } catch {
    return [];
  }
}

export function SchedulerPage() {
  const [weekBase,       setWeekBase]       = useState(new Date());
  const [bookingsByDate, setBookingsByDate] = useState<Record<string, Booking[]>>({});
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const [reschedule,     setReschedule]     = useState<Booking | null>(null);
  const [workflowBooking,setWorkflowBooking]= useState<Booking | null>(null);
  const [success,        setSuccess]        = useState('');
  const [viewMode,       setViewMode]       = useState<'week' | 'day'>('week');
  // Track current time for accurate overdue detection (refreshed every minute)
  const [nowMinutes,     setNowMinutes]     = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  const days     = getWeekDays(weekBase);
  const todayStr = fmtLocal(new Date());
  const [selectedDay, setSelectedDay] = useState(todayStr);

  // Refresh "now" every minute so overdue badges update in real time
  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result: Record<string, Booking[]> = {};
      await Promise.all(
        days.map(async d => {
          const ds = fmtLocal(d);
          result[ds] = await fetchDayBookings(ds);
        })
      );
      setBookingsByDate(result);
    } catch {
      setError('Failed to load schedule.');
    } finally {
      setLoading(false);
    }
  }, [weekBase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadWeek(); }, [loadWeek]);

  const prevWeek = () => { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d); };
  const nextWeek = () => { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d); };
  const goToday  = () => setWeekBase(new Date());

  // ── Summary stats ──────────────────────────────────────────────────────────
  const todayBookings = bookingsByDate[todayStr] || [];
  const totalToday    = todayBookings.length;
  const overdueToday  = todayBookings.filter(b => isBookingOverdue(b, todayStr, todayStr, nowMinutes)).length;
  const weekTotal     = Object.values(bookingsByDate).flat().length;

  // Count of past-day bookings that are still active (missed bookings across entire week)
  const missedPastDays = days
    .filter(d => fmtLocal(d) < todayStr)
    .flatMap(d => (bookingsByDate[fmtLocal(d)] || []).filter(b => ACTIVE_STATUSES.includes(b.status)))
    .length;

  const displayDays = viewMode === 'week' ? days : days.filter(d => fmtLocal(d) === selectedDay);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-5">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scheduler</h1>
          <p className="text-gray-500 mt-1">Weekly booking calendar · Date-accurate · Overdue detection in real time.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={prevWeek} className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition">←</button>
          <button onClick={goToday}  className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition">Today</button>
          <button onClick={nextWeek} className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition">→</button>
          <button
            onClick={loadWeek}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition"
            title="Refresh"
          >↻</button>
          <div className="ml-2 flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setViewMode('week')} className={`px-3 py-2 text-sm transition ${viewMode === 'week' ? 'bg-[#1B4FD8] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Week</button>
            <button onClick={() => setViewMode('day')}  className={`px-3 py-2 text-sm transition ${viewMode === 'day'  ? 'bg-[#1B4FD8] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Day</button>
          </div>
        </div>
      </div>

      {error   && <AlertBanner type="error"   message={error}   onClose={() => setError('')}   />}
      {success && <AlertBanner type="success" message={success} onClose={() => setSuccess('')} />}

      {/* ── Summary bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Today's Bookings",
            value: totalToday,
            color: 'bg-blue-50 text-blue-900',
          },
          {
            label: 'Overdue Today',
            value: overdueToday,
            color: overdueToday > 0 ? 'bg-red-50 text-red-900' : 'bg-gray-50 text-gray-700',
            sub:   overdueToday > 0 ? 'Slot time passed — not yet served' : undefined,
          },
          {
            label: 'Missed (Past Days)',
            value: missedPastDays,
            color: missedPastDays > 0 ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-700',
            sub:   missedPastDays > 0 ? 'Active bookings on past dates' : undefined,
          },
          {
            label: 'Week Total',
            value: weekTotal,
            color: 'bg-emerald-50 text-emerald-900',
            sub:   `${days[0] ? fmtLocal(days[0]).slice(5) : ''} – ${days[6] ? fmtLocal(days[6]).slice(5) : ''}`,
          },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-semibold mt-0.5">{s.label}</p>
            {s.sub && <p className="text-xs opacity-70 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Day tabs (day view only) ── */}
      {viewMode === 'day' && (
        <div className="flex gap-2 flex-wrap">
          {days.map(d => {
            const ds = fmtLocal(d);
            const cnt = (bookingsByDate[ds] || []).length;
            const hasOverdue = (bookingsByDate[ds] || []).some(b => isBookingOverdue(b, ds, todayStr, nowMinutes));
            return (
              <button
                key={ds}
                onClick={() => setSelectedDay(ds)}
                className={`px-3 py-2 rounded-lg text-sm border transition relative ${
                  ds === selectedDay  ? 'bg-[#1B4FD8] text-white border-[#1B4FD8]' :
                  ds === todayStr     ? 'border-[#1B4FD8] text-[#1B4FD8]' :
                  'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}
                {cnt > 0 && (
                  <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                    ds === selectedDay ? 'bg-white/30 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>{cnt}</span>
                )}
                {hasOverdue && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="py-16"><Spinner /></div>
      ) : (
        <div className={`grid gap-3 ${viewMode === 'week' ? 'grid-cols-1 lg:grid-cols-7' : 'grid-cols-1'}`}>
          {displayDays.map(d => {
            const ds          = fmtLocal(d);
            const dayBookings = bookingsByDate[ds] || [];
            const isToday     = ds === todayStr;
            const isPast      = ds < todayStr;

            // Per-day overdue count (for header badge)
            const dayOverdue  = dayBookings.filter(b => isBookingOverdue(b, ds, todayStr, nowMinutes)).length;

            // Separate bookings by slot and "no slot" bucket
            const noSlotBooks = dayBookings.filter(b => !b.scheduled_slot || !SLOTS.includes(b.scheduled_slot));

            return (
              <div
                key={ds}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                  isToday   ? 'border-[#1B4FD8] ring-1 ring-[#1B4FD8]/20' :
                  isPast    ? 'border-gray-100 opacity-80' :
                  'border-gray-100'
                }`}
              >
                {/* Day header */}
                <div className={`px-3 py-2 border-b flex items-center justify-between ${
                  isToday ? 'bg-[#1B4FD8] text-white border-[#1B4FD8]' : 'bg-gray-50 border-gray-100'
                }`}>
                  <div>
                    <p className={`text-xs font-semibold ${isToday ? 'text-blue-100' : 'text-gray-400'}`}>
                      {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                      {isPast && <span className="ml-1 opacity-60">(past)</span>}
                    </p>
                    <p className={`text-sm font-bold ${isToday ? 'text-white' : 'text-gray-900'}`}>
                      {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {dayOverdue > 0 && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${
                        isToday ? 'bg-red-400/80 text-white' : 'bg-red-100 text-red-700'
                      }`}>
                        ⚠ {dayOverdue}
                      </span>
                    )}
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${
                      isToday ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {dayBookings.length}
                    </span>
                  </div>
                </div>

                {/* Bookings */}
                <div className="p-2 space-y-1.5">
                  {dayBookings.length === 0 ? (
                    <p className="text-xs text-gray-300 text-center py-4">No bookings</p>
                  ) : (
                    <>
                      {SLOTS.map(slot => {
                        const slotBooks = dayBookings.filter(b => b.scheduled_slot === slot);
                        if (slotBooks.length === 0) return null;
                        return (
                          <div key={slot}>
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                              {slotLabels[slot]}
                            </p>
                            {slotBooks.map(b => (
                              <BookingCard
                                key={b.id}
                                booking={b}
                                dateStr={ds}
                                todayStr={todayStr}
                                nowMinutes={nowMinutes}
                                onOpen={() => setWorkflowBooking(b)}
                                onReschedule={() => setReschedule(b)}
                              />
                            ))}
                          </div>
                        );
                      })}
                      {/* Bookings with no recognised slot */}
                      {noSlotBooks.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">No Slot</p>
                          {noSlotBooks.map(b => (
                            <BookingCard
                              key={b.id}
                              booking={b}
                              dateStr={ds}
                              todayStr={todayStr}
                              nowMinutes={nowMinutes}
                              onOpen={() => setWorkflowBooking(b)}
                              onReschedule={() => setReschedule(b)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Workflow panel ── */}
      {workflowBooking && (
        <BookingWorkflowPanel
          booking={workflowBooking}
          onClose={() => setWorkflowBooking(null)}
          onUpdated={() => loadWeek()}
        />
      )}

      {/* ── Reschedule modal ── */}
      {reschedule && (
        <RescheduleModal
          open={!!reschedule}
          onClose={() => setReschedule(null)}
          bookingId={reschedule.id}
          bookingNumber={reschedule.booking_number}
          currentDate={reschedule.scheduled_date}
          currentSlot={reschedule.scheduled_slot}
          onRescheduled={() => {
            setSuccess(`${reschedule.booking_number} rescheduled successfully.`);
            setReschedule(null);
            loadWeek();
          }}
        />
      )}
    </div>
  );
}

// ── BookingCard sub-component ──────────────────────────────────────────────────
interface CardProps {
  booking:    Booking;
  dateStr:    string;
  todayStr:   string;
  nowMinutes: number;
  onOpen:     () => void;
  onReschedule: () => void;
}

function BookingCard({ booking: b, dateStr, todayStr, nowMinutes, onOpen, onReschedule }: CardProps) {
  const overdue    = isBookingOverdue(b, dateStr, todayStr, nowMinutes);
  const isReschd   = b.status === 'RESCHEDULED';
  const isPastMiss = dateStr < todayStr && ACTIVE_STATUSES.includes(b.status);

  let cardCls = 'bg-gray-50 border-transparent hover:border-gray-200';
  if (overdue && dateStr === todayStr) cardCls = 'bg-red-50 border-red-200';
  else if (isPastMiss)                 cardCls = 'bg-amber-50 border-amber-200';
  else if (isReschd)                   cardCls = 'bg-violet-50 border-violet-200';

  return (
    <div
      className={`rounded-lg p-2 mb-1 border cursor-pointer hover:shadow-sm transition ${cardCls}`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-gray-800 truncate">{b.booking_number}</p>
          <p className="text-xs text-gray-500 truncate">{(b as any).customer?.name || (b as any).customer_name || '—'}</p>
        </div>
        {/* Quick reschedule button — visible on hover */}
        <button
          onClick={e => { e.stopPropagation(); onReschedule(); }}
          title="Reschedule"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-[#1B4FD8] hover:bg-blue-50 transition"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      </div>

      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold mt-1 inline-block ${
        statusColors[b.status] || 'bg-gray-100 text-gray-700'
      }`}>
        {statusLabels[b.status] || b.status}
      </span>

      {/* Overdue badge — real-time slot-aware */}
      {overdue && dateStr === todayStr && (
        <p className="text-[10px] text-red-600 font-bold mt-0.5 flex items-center gap-0.5">
          <span>⏰</span> Overdue — slot passed
        </p>
      )}

      {/* Past-day missed badge */}
      {isPastMiss && dateStr < todayStr && (
        <p className="text-[10px] text-amber-700 font-bold mt-0.5 flex items-center gap-0.5">
          <span>⚠</span> Missed visit
        </p>
      )}

      {/* Rescheduled badge */}
      {isReschd && (
        <p className="text-[10px] text-violet-700 font-semibold mt-0.5">🔄 Rescheduled</p>
      )}

      {/* Technician */}
      {(b as any).technician?.name && (
        <p className="text-[10px] text-gray-400 mt-0.5 truncate">
          👷 {(b as any).technician.name}
        </p>
      )}
    </div>
  );
}
