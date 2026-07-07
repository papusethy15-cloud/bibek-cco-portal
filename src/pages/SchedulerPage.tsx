import React, { useState, useEffect } from 'react';
import { bookingService } from '../services/booking.service';
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
  '08:00-10:00': '8–10 AM', '10:00-12:00': '10–12 PM',
  '12:00-14:00': '12–2 PM', '14:00-16:00': '2–4 PM',
  '16:00-18:00': '4–6 PM', '18:00-20:00': '6–8 PM',
};

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

function fmt(d: Date) {
  return d.toISOString().split('T')[0];
}

export function SchedulerPage() {
  const [weekBase, setWeekBase] = useState(new Date());
  const [bookingsByDate, setBookingsByDate] = useState<Record<string, Booking[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reschedule, setReschedule] = useState<Booking | null>(null);
  const [workflowBooking, setWorkflowBooking] = useState<Booking | null>(null);
  const [success, setSuccess] = useState('');
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [selectedDay, setSelectedDay] = useState(fmt(new Date()));

  const days = getWeekDays(weekBase);

  const loadWeek = async () => {
    setLoading(true);
    try {
      const result: Record<string, Booking[]> = {};
      await Promise.all(
        days.map(async d => {
          const ds = fmt(d);
          try {
            const res = await bookingService.list({ date: ds, limit: 100 });
            result[ds] = res.items || [];
          } catch {
            result[ds] = [];
          }
        })
      );
      setBookingsByDate(result);
    } catch {
      setError('Failed to load schedule.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadWeek(); }, [weekBase]);

  const prevWeek = () => {
    const d = new Date(weekBase);
    d.setDate(d.getDate() - 7);
    setWeekBase(d);
  };
  const nextWeek = () => {
    const d = new Date(weekBase);
    d.setDate(d.getDate() + 7);
    setWeekBase(d);
  };
  const goToday = () => setWeekBase(new Date());

  const todayStr = fmt(new Date());

  const totalToday = (bookingsByDate[todayStr] || []).length;
  const overdueToday = (bookingsByDate[todayStr] || []).filter(b =>
    ['PENDING', 'CONFIRMED', 'ASSIGNED'].includes(b.status)
  ).length;

  const displayDays = viewMode === 'week' ? days : days.filter(d => fmt(d) === selectedDay);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Scheduler</h1>
          <p className="text-gray-500 mt-1">Weekly booking calendar. Spot and resolve slot conflicts.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition">←</button>
          <button onClick={goToday} className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition">Today</button>
          <button onClick={nextWeek} className="px-3 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 transition">→</button>
          <div className="ml-2 flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setViewMode('week')} className={`px-3 py-2 text-sm transition ${viewMode === 'week' ? 'bg-[#1B4FD8] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Week</button>
            <button onClick={() => setViewMode('day')} className={`px-3 py-2 text-sm transition ${viewMode === 'day' ? 'bg-[#1B4FD8] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Day</button>
          </div>
        </div>
      </div>

      {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}
      {success && <AlertBanner type="success" message={success} onClose={() => setSuccess('')} />}

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Today's Bookings", value: totalToday, color: 'bg-blue-50 text-blue-900' },
          { label: "Overdue / Unserved", value: overdueToday, color: overdueToday > 0 ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-700' },
          { label: "Week Total", value: Object.values(bookingsByDate).flat().length, color: 'bg-emerald-50 text-emerald-900' },
          { label: "Week Range", value: `${days[0] ? fmt(days[0]).slice(5) : ''} – ${days[6] ? fmt(days[6]).slice(5) : ''}`, color: 'bg-gray-50 text-gray-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.color}`}>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {viewMode === 'day' && (
        <div className="flex gap-2 flex-wrap">
          {days.map(d => {
            const ds = fmt(d);
            return (
              <button
                key={ds}
                onClick={() => setSelectedDay(ds)}
                className={`px-3 py-2 rounded-lg text-sm border transition ${
                  ds === selectedDay ? 'bg-[#1B4FD8] text-white border-[#1B4FD8]' :
                  ds === todayStr ? 'border-[#1B4FD8] text-[#1B4FD8]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}
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
            const ds = fmt(d);
            const dayBookings = bookingsByDate[ds] || [];
            const isToday = ds === todayStr;
            const isPast = d < new Date() && !isToday;

            return (
              <div
                key={ds}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                  isToday ? 'border-[#1B4FD8]' : isPast ? 'border-gray-100 opacity-70' : 'border-gray-100'
                }`}
              >
                {/* Day header */}
                <div className={`px-3 py-2 border-b flex items-center justify-between ${isToday ? 'bg-[#1B4FD8] text-white border-[#1B4FD8]' : 'bg-gray-50 border-gray-100'}`}>
                  <div>
                    <p className={`text-xs font-semibold ${isToday ? 'text-blue-100' : 'text-gray-400'}`}>
                      {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                    </p>
                    <p className={`text-sm font-bold ${isToday ? 'text-white' : 'text-gray-900'}`}>
                      {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${isToday ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {dayBookings.length}
                  </span>
                </div>

                {/* Slots */}
                <div className="p-2 space-y-1.5">
                  {dayBookings.length === 0 ? (
                    <p className="text-xs text-gray-300 text-center py-4">No bookings</p>
                  ) : (
                    SLOTS.map(slot => {
                      const slotBooks = dayBookings.filter(b => b.scheduled_slot === slot);
                      if (slotBooks.length === 0) return null;
                      return (
                        <div key={slot}>
                          <p className="text-xs text-gray-400 mb-1">{slotLabels[slot]}</p>
                          {slotBooks.map(b => {
                            const isOverdue = isToday && ['PENDING', 'CONFIRMED', 'ASSIGNED'].includes(b.status);
                            return (
                              <div
                                key={b.id}
                                className={`rounded-lg p-2 mb-1 border cursor-pointer hover:shadow-sm transition ${
                                  isOverdue ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-transparent hover:border-gray-200'
                                }`}
                                onClick={() => setWorkflowBooking(b)}
                              >
                                <p className="text-xs font-semibold text-gray-800 truncate">{b.booking_number}</p>
                                <p className="text-xs text-gray-500 truncate">{b.customer?.name || '—'}</p>
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block ${statusColors[b.status] || 'bg-gray-100 text-gray-700'}`}>
                                  {statusLabels[b.status] || b.status}
                                </span>
                                {isOverdue && (
                                  <p className="text-xs text-amber-600 font-medium mt-0.5">⚠ Overdue</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {workflowBooking && (
        <BookingWorkflowPanel
          booking={workflowBooking}
          onClose={() => setWorkflowBooking(null)}
          onUpdated={() => { loadWeek(); }}
        />
      )}

      {reschedule && (
        <RescheduleModal
          open={!!reschedule}
          onClose={() => setReschedule(null)}
          bookingId={reschedule.id}
          bookingNumber={reschedule.booking_number}
          onRescheduled={() => {
            setSuccess(`${reschedule.booking_number} rescheduled.`);
            setReschedule(null);
            loadWeek();
          }}
        />
      )}
    </div>
  );
}
