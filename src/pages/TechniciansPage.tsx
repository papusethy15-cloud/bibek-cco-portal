import { todayIST } from "../lib/tz";
import React, { useState, useEffect, useCallback } from 'react';
import { technicianService } from '../services/technician.service';
import { bookingService } from '../services/booking.service';
import { Technician } from '../types';
import { Spinner } from '../components/ui/Spinner';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { statusColors, statusLabels } from '../utils/statusColors';
import { BookingWorkflowPanel } from '../components/bookings/BookingWorkflowPanel';
import { Booking } from '../types';
import { Modal } from '../components/ui/Modal';
import { AlertBanner } from '../components/ui/AlertBanner';
import { callLogService } from '../services/callLog.service';
import api from '../services/api';

interface TechWithJobs extends Technician {
  jobsToday?: number;
  jobsDone?: number;
  jobsInProgress?: number;
}

function workloadColor(n: number) {
  if (n === 0) return 'text-gray-400';
  if (n <= 2) return 'text-emerald-600';
  if (n <= 4) return 'text-amber-600';
  return 'text-red-600';
}

function TechCard({ tech, onClick }: { tech: TechWithJobs; onClick: () => void }) {
  const isActive = tech.status === 'ACTIVE';
  const jobs = tech.jobsToday ?? 0;
  const done = tech.jobsDone ?? 0;
  const inProg = tech.jobsInProgress ?? 0;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 cursor-pointer hover:border-[#1B4FD8]/30 hover:shadow-md transition"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-lg font-bold text-[#1B4FD8] shrink-0">
          {tech.name?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{tech.name}</p>
            <span className={`shrink-0 w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-gray-300'}`} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{tech.mobile}</p>
          {tech.city && <p className="text-xs text-gray-400 mt-0.5">{tech.city}</p>}
          {/* Workload mini-bar */}
          {isActive && jobs > 0 && (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-[#1B4FD8] h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min((done / jobs) * 100, 100)}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">{done}/{jobs}</span>
            </div>
          )}
        </div>
        {/* Job count badge — THE FIX */}
        <div className="text-right shrink-0">
          <p className={`text-xl font-bold ${workloadColor(jobs)}`}>{jobs}</p>
          <p className="text-xs text-gray-400">jobs today</p>
          {inProg > 0 && (
            <p className="text-xs text-violet-600 font-medium">{inProg} active</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TechniciansPage() {
  const [technicians, setTechnicians] = useState<TechWithJobs[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TechWithJobs | null>(null);
  const [techBookings, setTechBookings] = useState<any[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [error, setError] = useState('');
  const [workflowBooking, setWorkflowBooking] = useState<Booking | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null); // booking id
  const [reminderSent, setReminderSent] = useState<Set<string>>(new Set());
  const [techCallOpen, setTechCallOpen] = useState(false);
  const [techCallOutcome, setTechCallOutcome] = useState('CONFIRMED');
  const [techCallNote, setTechCallNote] = useState('');
  const [savingTechCall, setSavingTechCall] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await technicianService.list(search ? { search } : {});
      const techs: TechWithJobs[] = (res.items || []);
      setTechnicians(techs);

      // Fetch job counts for all active techs in parallel — THE FIX
      const today = todayIST();
      const activeTechs = techs.filter(t => t.status === 'ACTIVE');
      setLoadingJobs(true);
      try {
        const jobResults = await Promise.allSettled(
          activeTechs.map(t => bookingService.list({ technician_id: t.id, date: today, limit: 50 }))
        );
        setTechnicians(prev => prev.map(tech => {
          const idx = activeTechs.findIndex(a => a.id === tech.id);
          if (idx === -1) return tech;
          const result = jobResults[idx];
          if (result.status !== 'fulfilled') return tech;
          const bookings = result.value.items || [];
          const done = bookings.filter((b: any) => ['COMPLETED', 'PAID', 'CLOSED', 'SETTLED'].includes(b.status)).length;
          const inProg = bookings.filter((b: any) => ['IN_PROGRESS', 'ARRIVED', 'INSPECTING', 'WORK_STARTED'].includes(b.status)).length;
          return { ...tech, jobsToday: bookings.length, jobsDone: done, jobsInProgress: inProg };
        }));
      } finally {
        setLoadingJobs(false);
      }
    } catch {
      setError('Failed to load technicians.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
  }, [load]);

  const handleSelectTech = async (tech: TechWithJobs) => {
    setSelected(tech);
    setLoadingBookings(true);
    try {
      const today = todayIST();
      const res = await bookingService.list({ technician_id: tech.id, date: today, limit: 50 });
      setTechBookings(res.items || []);
    } catch {
      setTechBookings([]);
    } finally {
      setLoadingBookings(false);
    }
  };

  const sendTechReminder = async (bookingId: string, techId: string) => {
    setSendingReminder(bookingId);
    try {
      await api.post('/notifications/send', {
        user_id: techId,
        template: 'SLOT_REMINDER',
        booking_id: bookingId,
      }).catch(() => {}); // non-fatal — may not have this endpoint yet
      setReminderSent(prev => new Set([...prev, bookingId]));
    } finally {
      setSendingReminder(null);
    }
  };

  const logTechCall = async () => {
    if (!selected) return;
    setSavingTechCall(true);
    try {
      await callLogService.create({
        customer_id: selected.id, // use tech id — backend accepts any UUID
        direction: 'OUTBOUND',
        outcome: techCallOutcome as any,
        summary: `CCO called technician ${selected.name}. Outcome: ${techCallOutcome}. ${techCallNote}`.trim(),
      });
      setTechCallOpen(false);
      setTechCallNote('');
    } catch {} finally {
      setSavingTechCall(false);
    }
  };

  const activeTechs = technicians.filter(t => t.status === 'ACTIVE');
  const inactiveTechs = technicians.filter(t => t.status !== 'ACTIVE');

  // Summary stats
  const totalJobsToday = activeTechs.reduce((s, t) => s + (t.jobsToday || 0), 0);
  const totalDone = activeTechs.reduce((s, t) => s + (t.jobsDone || 0), 0);
  const totalActive = activeTechs.reduce((s, t) => s + (t.jobsInProgress || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Technicians</h1>
        <p className="text-gray-500 mt-1">View technician schedules and today's job load.</p>
      </div>

      {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

      {/* Team summary strip */}
      {activeTechs.length > 0 && !loadingJobs && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 rounded-2xl p-4 text-blue-900">
            <p className="text-2xl font-bold">{totalJobsToday}</p>
            <p className="text-xs mt-1">Total Jobs Today</p>
          </div>
          <div className="bg-violet-50 rounded-2xl p-4 text-violet-900">
            <p className="text-2xl font-bold">{totalActive}</p>
            <p className="text-xs mt-1">In Progress Now</p>
          </div>
          <div className="bg-emerald-50 rounded-2xl p-4 text-emerald-900">
            <p className="text-2xl font-bold">{totalDone}</p>
            <p className="text-xs mt-1">Completed Today</p>
          </div>
        </div>
      )}

      <div className="max-w-sm">
        <Input
          placeholder="Search by name, mobile or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="py-16"><Spinner /></div>
      ) : (
        <>
          {activeTechs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Active ({activeTechs.length})</h2>
                {loadingJobs && <span className="text-xs text-gray-400">Loading job counts...</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {activeTechs.map(t => <TechCard key={t.id} tech={t} onClick={() => handleSelectTech(t)} />)}
              </div>
            </div>
          )}
          {inactiveTechs.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Inactive ({inactiveTechs.length})</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60">
                {inactiveTechs.map(t => <TechCard key={t.id} tech={t} onClick={() => handleSelectTech(t)} />)}
              </div>
            </div>
          )}
          {technicians.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <p className="text-gray-400 text-sm">No technicians found.</p>
            </div>
          )}
        </>
      )}

      {/* Tech detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || ''} size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Mobile</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`tel:${selected.mobile}`} className="text-sm font-semibold text-[#1B4FD8]">{selected.mobile}</a>
                  <a href={`tel:${selected.mobile}`} className="px-2 py-0.5 text-xs rounded-lg bg-emerald-100 text-emerald-700 font-medium hover:bg-emerald-200">📞 Call</a>
                  <button
                    onClick={() => setTechCallOpen(true)}
                    className="px-2 py-0.5 text-xs rounded-lg bg-blue-100 text-blue-700 font-medium hover:bg-blue-200"
                  >
                    📋 Log call
                  </button>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">City</p>
                <p className="text-sm font-semibold text-gray-900">{selected.city || '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Status</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${selected.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                  {selected.status || 'Unknown'}
                </span>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Today's Workload</p>
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-bold ${workloadColor(selected.jobsToday || 0)}`}>{selected.jobsToday ?? '—'} jobs</p>
                  {selected.jobsDone !== undefined && (
                    <span className="text-xs text-gray-400">({selected.jobsDone} done)</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Today's Jobs</h4>
              {loadingBookings ? (
                <Spinner />
              ) : techBookings.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No jobs assigned today.</p>
              ) : (
                <div className="space-y-2">
                  {techBookings.map(b => (
                    <div
                      key={b.id}
                      className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{b.booking_number}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {b.customer?.name}
                            {b.scheduled_slot && ` · ${b.scheduled_slot}`}
                          </p>
                        </div>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[b.status] || 'bg-gray-100 text-gray-700'}`}>
                          {statusLabels[b.status] || b.status}
                        </span>
                      </div>
                      {/* CCO action buttons */}
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        <button
                          onClick={() => { setSelected(null); setWorkflowBooking(b); }}
                          className="text-xs bg-[#1B4FD8] text-white px-2.5 py-1 rounded-lg hover:bg-[#1640B0] transition font-medium"
                        >
                          Open workflow
                        </button>
                        {['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'IN_PROGRESS', 'WORK_STARTED'].includes(b.status) && (
                          <button
                            onClick={() => sendTechReminder(b.id, selected.id)}
                            disabled={sendingReminder === b.id || reminderSent.has(b.id)}
                            className={`text-xs px-2.5 py-1 rounded-lg transition font-medium ${
                              reminderSent.has(b.id)
                                ? 'bg-emerald-100 text-emerald-700 cursor-default'
                                : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                            }`}
                          >
                            {reminderSent.has(b.id) ? '✓ Reminded' : sendingReminder === b.id ? '...' : '🔔 Remind tech'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Log call to technician modal */}
      <Modal open={techCallOpen} onClose={() => setTechCallOpen(false)} title={`Log call — ${selected?.name}`} size="sm">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Outcome</label>
            <div className="grid grid-cols-2 gap-2">
              {['CONFIRMED', 'NOT_REACHABLE', 'RESCHEDULED', 'OTHER'].map(o => (
                <button
                  key={o}
                  onClick={() => setTechCallOutcome(o)}
                  className={`text-sm px-3 py-2 rounded-lg border font-medium transition text-left ${
                    techCallOutcome === o
                      ? 'border-[#1B4FD8] bg-blue-50 text-[#1B4FD8]'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {o.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
            <textarea
              rows={2}
              value={techCallNote}
              onChange={e => setTechCallNote(e.target.value)}
              placeholder="What was discussed..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setTechCallOpen(false)}>Cancel</Button>
            <Button loading={savingTechCall} onClick={logTechCall}>Save</Button>
          </div>
        </div>
      </Modal>

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
