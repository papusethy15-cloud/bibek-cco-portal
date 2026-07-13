import { todayIST } from "../lib/tz";
import React, { useState, useEffect } from 'react';
import { useCCOWebSocket } from '../hooks/useCCOWebSocket';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { bookingService } from '../services/booking.service';
import { escalationService } from '../services/escalation.service';
import { paymentService } from '../services/payment.service';
import { callLogService } from '../services/callLog.service';
import { crmService, CRMFollowup } from '../services/crm.service';
import { Booking, PaymentTransaction } from '../types';
import { BookingWorkflowPanel } from '../components/bookings/BookingWorkflowPanel';
import { statusColors, statusLabels } from '../utils/statusColors';
import { Spinner } from '../components/ui/Spinner';

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  iconColor: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

function StatCard({ label, value, sub, color, iconColor, icon, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-gray-200 transition' : ''}`}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <div className={iconColor}>{icon}</div>
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function AlertRow({ booking, onClick }: { booking: Booking; onClick: () => void }) {
  const isOverdue = ['PENDING', 'CONFIRMED', 'ASSIGNED'].includes(booking.status);
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer hover:bg-amber-50 transition border ${
        isOverdue ? 'border-amber-100 bg-amber-50/50' : 'border-gray-50 bg-gray-50/50'
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{booking.booking_number}</p>
        <p className="text-xs text-gray-500 truncate">{booking.customer?.name} · {booking.scheduled_slot}</p>
      </div>
      <span className={`ml-3 shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[booking.status] || 'bg-gray-100 text-gray-700'}`}>
        {statusLabels[booking.status] || booking.status}
      </span>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const [loading, setLoading] = useState(true);
  const [todayBookings, setTodayBookings] = useState<Booking[]>([]);
  const [overdueBookings, setOverdueBookings] = useState<Booking[]>([]);
  const [openEscalations, setOpenEscalations] = useState(0);
  const [payLaterCount, setPayLaterCount] = useState(0);
  const [payLaterAmount, setPayLaterAmount] = useState(0);
  const [todayCallCount, setTodayCallCount] = useState(0);
  const [overduePayLater, setOverduePayLater] = useState<PaymentTransaction[]>([]);
  const [workflowBooking, setWorkflowBooking] = useState<Booking | null>(null);
  const [manualAlerts, setManualAlerts] = useState<Array<{ booking_id: string; booking_number: string; message: string; ts: number }>>([]);
  const [followups, setFollowups] = useState<CRMFollowup[]>([]);
  const [markingDone, setMarkingDone] = useState<string | null>(null);

  const openBookingWorkflow = async (bookingId: string) => {
    try {
      const b = await bookingService.getById(bookingId);
      setWorkflowBooking(b);
    } catch {}
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const today = todayIST();
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

      const results = await Promise.allSettled([
        bookingService.getTodayBookings(),
        escalationService.list({ status: 'OPEN', limit: 1 }),
        paymentService.getPayLaterDue(),
        callLogService.list({ page: 1, per_page: 50 }).catch(() => ({ items: [], total: 0 })),
        crmService.listFollowups({ per_page: '20' }).catch(() => []),
      ]);

      // Today bookings
      if (results[0].status === 'fulfilled') {
        const all = results[0].value;
        setTodayBookings(all);
        const overdue = all.filter(b => {
          if (!b.scheduled_slot || !['PENDING', 'CONFIRMED', 'ASSIGNED'].includes(b.status)) return false;
          const [h, m] = b.scheduled_slot.split(':').map(Number);
          return h * 60 + m < nowMin - 30;
        });
        setOverdueBookings(overdue);
      }

      // Escalations
      if (results[1].status === 'fulfilled') {
        setOpenEscalations((results[1].value as any).total || 0);
      }

      // Pay-later
      if (results[2].status === 'fulfilled') {
        const due = results[2].value;
        setPayLaterCount(due.length);
        setPayLaterAmount(due.reduce((s: number, t: any) => s + (t.amount || 0), 0));
        // Overdue = PAY_LATER records whose due date (parsed from notes) is in the past
        const today = todayIST();
        const overdue = due.filter((t: any) => {
          const match = (t.notes || '').match(/PAY_LATER: due (\d{4}-\d{2}-\d{2})/);
          return match && match[1] < today;
        });
        setOverduePayLater(overdue);
      }

      // Call log — count today
      if (results[3].status === 'fulfilled') {
        const logs = (results[3].value as any).items || [];
        const todayCalls = logs.filter((c: any) => c.created_at?.startsWith(today));
        setTodayCallCount(todayCalls.length);
      }

      if (results[4].status === 'fulfilled') {
        const fus = results[4].value as CRMFollowup[];
        // Show only today's and overdue follow-ups
        const todayAndOverdue = fus.filter(f => f.due_date <= today && f.status !== 'DONE');
        setFollowups(todayAndOverdue);
      }

      setLoading(false);
    })();
  }, []);

  const ccoBookingsToday = todayBookings.filter(b => b.source === 'CALL_CENTER').length;

  // CCO performance metrics (derived from data already loaded)
  const totalCallsToday = todayCallCount;
  const resolvedEscalations = 0; // Would need separate API — show as placeholder
  const ccoCreatedThisWeek = ccoBookingsToday; // simplified — bookings created via CCO today

  const quickActions = [
    { label: 'Search Customer', sub: 'Look up by mobile', icon: '🔍', path: '/customers', color: 'bg-blue-50 text-blue-700 border-blue-100' },
    { label: 'New Booking', sub: 'Create from call', icon: '📋', path: '/bookings', color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { label: 'Scheduler', sub: 'View today\'s slots', icon: '📅', path: '/scheduler', color: 'bg-violet-50 text-violet-700 border-violet-100' },
    { label: 'Raise Ticket', sub: 'Send to admin', icon: '🎫', path: '/escalations', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    { label: 'Payments', sub: 'Pay-later dues', icon: '💳', path: '/payments', color: 'bg-pink-50 text-pink-700 border-pink-100' },
    { label: 'Technicians', sub: 'Check workloads', icon: '🔧', path: '/technicians', color: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
  ];

  // ── WS: manual assign needed alerts ────────────────────────────────────────
  const { subscribe } = useCCOWebSocket();
  useEffect(() => {
    const unsub = subscribe('BOOKING_NEEDS_MANUAL_ASSIGN', (payload: any) => {
      setManualAlerts(prev => [
        { booking_id: payload?.booking_id || '', booking_number: payload?.booking_number || '', message: payload?.message || `Booking ${payload?.booking_number} needs manual assignment.`, ts: Date.now() },
        ...prev.slice(0, 4),
      ]);
    });
    return () => unsub();
  }, [subscribe]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{greeting}, {user?.name?.split(' ')[0]} 👋</h1>
        <p className="text-gray-500 mt-1 text-sm">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* ── Manual Assign Needed Alerts ── */}
      {manualAlerts.length > 0 && (
        <div className="space-y-2">
          {manualAlerts.map((alert, i) => (
            <div
              key={`${alert.booking_id}-${alert.ts}`}
              className="bg-red-50 border-2 border-red-300 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚨</span>
                <div>
                  <p className="text-sm font-bold text-red-800">Manual Assignment Required — #{alert.booking_number}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{alert.message}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => { navigate('/bookings'); setManualAlerts(prev => prev.filter((_, idx) => idx !== i)); }}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-700 transition"
                >
                  👷 Go to Bookings
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

      {loading ? (
        <div className="py-12"><Spinner /></div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Calls Today"
              value={todayCallCount}
              sub="Logged interactions"
              color="bg-blue-50"
              iconColor="text-[#1B4FD8]"
              onClick={() => navigate('/call-log')}
              icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
            />
            <StatCard
              label="Today's Bookings"
              value={todayBookings.length}
              sub={`${ccoBookingsToday} via call center`}
              color="bg-emerald-50"
              iconColor="text-emerald-600"
              onClick={() => navigate('/bookings')}
              icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
            />
            <StatCard
              label="Open Escalations"
              value={openEscalations}
              sub="Pending resolution"
              color={openEscalations > 0 ? 'bg-amber-50' : 'bg-gray-50'}
              iconColor={openEscalations > 0 ? 'text-amber-600' : 'text-gray-400'}
              onClick={() => navigate('/escalations')}
              icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
            />
            <StatCard
              label="Pay-Later Due"
              value={payLaterCount}
              sub={payLaterCount > 0 ? `₹${payLaterAmount.toLocaleString('en-IN')} total` : 'All collected'}
              color={payLaterCount > 0 ? 'bg-red-50' : 'bg-gray-50'}
              iconColor={payLaterCount > 0 ? 'text-red-500' : 'text-gray-400'}
              onClick={() => navigate('/payments')}
              icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>}
            />
          </div>

          {/* Overdue alerts */}
          {overdueBookings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-sm font-bold text-amber-900">{overdueBookings.length} overdue slot{overdueBookings.length > 1 ? 's' : ''} — action required</h3>
              </div>
              <div className="space-y-2">
                {overdueBookings.slice(0, 5).map(b => (
                  <AlertRow key={b.id} booking={b} onClick={() => navigate('/bookings')} />
                ))}
                {overdueBookings.length > 5 && (
                  <button onClick={() => navigate('/scheduler')} className="text-xs text-amber-700 font-medium hover:underline">
                    +{overdueBookings.length - 5} more → View Scheduler
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Pay-Later overdue alert */}
          {overduePayLater.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <h3 className="text-sm font-bold text-red-900">
                  {overduePayLater.length} pay-later collection{overduePayLater.length > 1 ? 's' : ''} overdue — call customers now
                </h3>
              </div>
              <div className="space-y-2">
                {overduePayLater.slice(0, 5).map((t: any) => {
                  const match = (t.notes || '').match(/PAY_LATER: due (\d{4}-\d{2}-\d{2})/);
                  const dueDate = match ? match[1] : '—';
                  return (
                    <div key={t.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-red-100">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{t.transaction_number}</p>
                        <p className="text-xs text-red-600 font-medium">Due: {dueDate}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-bold text-red-700">₹{t.amount?.toLocaleString('en-IN')}</p>
                        {t.booking_id && (
                          <button
                            onClick={() => openBookingWorkflow(t.booking_id)}
                            className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 transition font-medium"
                          >
                            Open Booking
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {overduePayLater.length > 5 && (
                  <button onClick={() => navigate('/payments')} className="text-xs text-red-700 font-medium hover:underline">
                    +{overduePayLater.length - 5} more → View Payments
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Two-column bottom */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Quick actions */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h2>
              <div className="grid grid-cols-2 gap-3">
                {quickActions.map(a => (
                  <button
                    key={a.label}
                    onClick={() => navigate(a.path)}
                    className={`flex flex-col items-start p-3.5 rounded-xl border text-left hover:shadow-sm transition ${a.color}`}
                  >
                    <span className="text-xl mb-1.5">{a.icon}</span>
                    <span className="text-sm font-semibold">{a.label}</span>
                    <span className="text-xs opacity-70 mt-0.5">{a.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Today's schedule preview */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-900">Today's Schedule</h2>
                <button onClick={() => navigate('/scheduler')} className="text-xs text-[#1B4FD8] hover:underline">View all →</button>
              </div>
              {todayBookings.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                  <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">No bookings today</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {todayBookings.slice(0, 8).map(b => (
                    <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900">{b.booking_number}</p>
                        <p className="text-xs text-gray-400 truncate">{b.customer?.name} · {b.scheduled_slot || 'No slot'}</p>
                      </div>
                      <span className={`ml-2 shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[b.status] || 'bg-gray-100 text-gray-700'}`}>
                        {statusLabels[b.status] || b.status}
                      </span>
                    </div>
                  ))}
                  {todayBookings.length > 8 && (
                    <button onClick={() => navigate('/scheduler')} className="text-xs text-[#1B4FD8] hover:underline pt-1">
                      +{todayBookings.length - 8} more bookings today
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {/* ── CCO Performance Metrics widget ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-indigo-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-indigo-900">📊 My Performance Today</h3>
            <p className="text-xs text-indigo-700 mt-0.5">Live stats for your current shift</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-gray-100">
          {[
            { label: 'Calls Handled', value: totalCallsToday, icon: '📞', color: 'text-blue-700', bg: 'bg-blue-50' },
            { label: 'Bookings Created', value: ccoBookingsToday, icon: '📋', color: 'text-emerald-700', bg: 'bg-emerald-50' },
            { label: 'Overdue Alerts', value: overdueBookings.length, icon: '⚠️', color: overdueBookings.length > 0 ? 'text-red-700' : 'text-gray-500', bg: overdueBookings.length > 0 ? 'bg-red-50' : 'bg-gray-50' },
            { label: 'Open Escalations', value: openEscalations, icon: '🎫', color: openEscalations > 0 ? 'text-violet-700' : 'text-gray-500', bg: openEscalations > 0 ? 'bg-violet-50' : 'bg-gray-50' },
          ].map(m => (
            <div key={m.label} className={`px-5 py-4 flex items-center gap-3 ${m.bg}`}>
              <span className="text-2xl">{m.icon}</span>
              <div>
                <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
                <p className="text-xs text-gray-500">{m.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Follow-up tasks widget ── */}
      {followups.length > 0 && (
        <div className="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-blue-900">📋 Today's Follow-ups ({followups.length})</h3>
              <p className="text-xs text-blue-700 mt-0.5">Callbacks and tasks due today — work through these between calls.</p>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {followups.map(f => (
              <div key={f.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{f.subject}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Due: {f.due_date}</p>
                </div>
                <button
                  onClick={async () => {
                    setMarkingDone(f.id);
                    try {
                      await crmService.markFollowupDone(f.id);
                      setFollowups(prev => prev.filter(x => x.id !== f.id));
                    } catch {} finally {
                      setMarkingDone(null);
                    }
                  }}
                  disabled={markingDone === f.id}
                  className="shrink-0 text-xs bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-200 transition font-medium disabled:opacity-50"
                >
                  {markingDone === f.id ? '...' : '✓ Done'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {workflowBooking && (
        <BookingWorkflowPanel
          booking={workflowBooking}
          onClose={() => setWorkflowBooking(null)}
          onUpdated={() => setWorkflowBooking(null)}
        />
      )}
    </div>
  );
}
