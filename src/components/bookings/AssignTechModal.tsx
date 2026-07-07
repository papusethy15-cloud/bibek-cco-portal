/**
 * AssignTechModal.tsx — Advanced CCO Technician Assignment
 * ══════════════════════════════════════════════════════════
 *
 * Features (matches admin dashboard AssignTechnicianModal):
 *  • Two tabs: ⚡ Auto Assign | 👷 Manual Select
 *  • Auto tab  — dispatch engine scoring explanation, one-click auto-assign,
 *                returns assigned technician name + score, then subscribes
 *                to /ws/booking/{id} to watch for ACCEPTED / REJECTED live
 *  • Manual tab — GET /assignments/candidates/{id} for full scored list:
 *                 rank badge, score bar, score breakdown tooltip,
 *                 online dot, skill match, same city, overloaded/slot-full badges,
 *                 workload bar, distance, live GPS map link
 *                 search filter (name / city / area / mobile)
 *                 "Hide overloaded" toggle, Refresh button
 *  • Booking info strip with live status badge (updated via WS)
 *  • "Cancel auto → manual" banner when booking already ASSIGNED
 *  • WS status dot in success banner ("⟳ connected")
 *  • On ACCEPTED → auto-close after 1.8 s; on REJECTED → reload candidates
 *  • Notes field on both tabs
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { AlertBanner } from '../ui/AlertBanner';
import { technicianService } from '../../services/technician.service';
import { useBookingWebSocket, WSMessage } from '../../hooks/useCCOWebSocket';

// ── helpers ──────────────────────────────────────────────────────────────────

function errMsg(ex: any): string {
  const d = ex?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((e: any) => e.msg || JSON.stringify(e)).join('; ');
  return ex?.message || 'Assignment failed.';
}

const STATUS_COLOR: Record<string, string> = {
  PENDING:    '#F59E0B', CONFIRMED: '#3B82F6', ASSIGNED:  '#8B5CF6',
  ACCEPTED:   '#10B981', EN_ROUTE:  '#0EA5E9', ARRIVED:   '#06B6D4',
  INSPECTING: '#F97316', IN_PROGRESS:'#F97316',COMPLETED: '#22C55E',
  CANCELLED:  '#EF4444', PAID:       '#059669', CLOSED:    '#374151',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:'Pending', CONFIRMED:'Confirmed', ASSIGNED:'Assigned',
  ACCEPTED:'Accepted', EN_ROUTE:'On the Way', ARRIVED:'Arrived',
  INSPECTING:'Inspecting', IN_PROGRESS:'Work in Progress',
  COMPLETED:'Work Done', CANCELLED:'Cancelled', PAID:'Paid', CLOSED:'Closed',
};

// ── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ value, max = 150 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'bg-amber-100 text-amber-700'
    : rank === 2 ? 'bg-gray-100 text-gray-500'
    : rank === 3 ? 'bg-orange-50 text-orange-600'
    : 'bg-gray-50 text-gray-400';
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${cls}`}>
      #{rank}
    </div>
  );
}

function WorkloadBar({ current, max }: { current: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  const color = pct >= 100 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-medium ${pct >= 100 ? 'text-red-600' : 'text-gray-400'}`}>
        {current}/{max}
      </span>
    </div>
  );
}

function ScoreTooltip({ breakdown }: { breakdown: Record<string, number> }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-xs text-indigo-400 hover:text-indigo-600 leading-none"
      >ℹ️</button>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-slate-800 text-slate-100 rounded-lg p-2.5 text-[11px] z-[200] shadow-xl pointer-events-none">
          <p className="font-bold text-slate-400 text-[10px] uppercase tracking-wide mb-1.5">Score Breakdown</p>
          {Object.entries(breakdown).map(([k, v]) => (
            <div key={k} className="flex justify-between mb-1">
              <span className="text-slate-300 capitalize">{k}</span>
              <span className="text-cyan-300 font-bold">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Candidate {
  technician_id: string;
  name: string;
  mobile: string;
  city: string;
  area: string;
  is_online: boolean;
  rating: number;
  total_jobs: number;
  active_workload: number;
  max_workload: number;
  profile_image: string | null;
  skill_match: boolean;
  same_city: boolean;
  overloaded: boolean;
  slot_available: boolean;
  slot_booking_count: number;
  slot_unavailable_reason: string | null;
  score: number;
  score_breakdown: Record<string, number>;
  last_lat: number | null;
  last_lng: number | null;
  distance_km: number | null;
}

function CandidateCard({
  candidate, rank, selected, onSelect,
}: { candidate: Candidate; rank: number; selected: boolean; onSelect: () => void }) {
  const slotBlocked = !candidate.slot_available;
  const overloaded = candidate.overloaded;

  const borderCls = selected
    ? 'border-2 border-indigo-500 bg-indigo-50'
    : slotBlocked
    ? 'border border-red-200 bg-red-50/50'
    : overloaded
    ? 'border border-red-100 bg-red-50/30'
    : 'border border-gray-100 bg-gray-50/50 hover:border-gray-200';

  return (
    <div
      onClick={onSelect}
      className={`rounded-xl px-3 py-2.5 cursor-pointer transition mb-2 ${borderCls}`}
      style={{ opacity: slotBlocked ? 0.6 : overloaded ? 0.75 : 1 }}
    >
      <div className="flex items-start gap-2.5">
        <RankBadge rank={rank} />

        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-gray-200 shrink-0 overflow-hidden flex items-center justify-center text-base">
          {candidate.profile_image
            ? <img src={candidate.profile_image} alt="" className="w-full h-full object-cover" />
            : '👷'}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-gray-900">{candidate.name}</span>
            {/* Online dot */}
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: candidate.is_online ? '#22C55E' : '#94A3B8' }}
              title={candidate.is_online ? 'Online' : 'Offline'}
            />
            {candidate.skill_match && (
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">✅ Skill Match</span>
            )}
            {candidate.same_city && (
              <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-semibold">📍 Same City</span>
            )}
            {overloaded && (
              <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-bold">⚠ Overloaded</span>
            )}
            {slotBlocked && (
              <span className="text-[10px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-bold border border-red-200">
                🚫 Slot Full ({candidate.slot_booking_count}/2)
              </span>
            )}
          </div>

          {/* Info row */}
          <div className="flex flex-wrap gap-2.5 text-[11px] text-gray-500 mt-1">
            {candidate.mobile && <span>📞 {candidate.mobile}</span>}
            {candidate.city && <span>📍 {candidate.city}{candidate.area ? `, ${candidate.area}` : ''}</span>}
            <span>⭐ {candidate.rating?.toFixed(1) || '0.0'}</span>
            <span>🔧 {candidate.total_jobs} jobs</span>
            {candidate.distance_km != null && (
              <span
                className="font-bold"
                style={{
                  color: candidate.distance_km < 5 ? '#16A34A'
                    : candidate.distance_km < 15 ? '#D97706' : '#DC2626',
                }}
              >
                📡 {candidate.distance_km < 1
                  ? `${(candidate.distance_km * 1000).toFixed(0)}m`
                  : `${candidate.distance_km.toFixed(1)}km`} away
              </span>
            )}
            {candidate.slot_unavailable_reason && (
              <span className="text-red-700 font-semibold">⏰ {candidate.slot_unavailable_reason}</span>
            )}
          </div>

          {/* Workload */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-gray-400">Workload</span>
            <WorkloadBar current={candidate.active_workload} max={candidate.max_workload} />
          </div>

          {/* GPS link */}
          {candidate.last_lat && candidate.last_lng && (
            <a
              href={`https://www.google.com/maps?q=${candidate.last_lat},${candidate.last_lng}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-[10px] text-blue-600 font-semibold hover:underline mt-1 block"
            >
              🗺️ View Live Location ({candidate.last_lat.toFixed(4)}, {candidate.last_lng.toFixed(4)})
            </a>
          )}
        </div>

        {/* Score + bar */}
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <span className="text-base font-black text-indigo-600">{candidate.score}</span>
            {candidate.score_breakdown && Object.keys(candidate.score_breakdown).length > 0 && (
              <ScoreTooltip breakdown={candidate.score_breakdown} />
            )}
          </div>
          <div className="w-20">
            <ScoreBar value={candidate.score} />
          </div>
          <span className="text-[10px] text-gray-400">score</span>
        </div>
      </div>

      {selected && (
        <p className="text-center text-[11px] text-indigo-600 font-bold mt-2">✓ Selected — confirm below</p>
      )}
    </div>
  );
}

// ── Main modal ───────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  bookingNumber: string;
  booking?: any; // full booking object if available (for info strip)
  scheduledDate?: string;
  onAssigned: () => void;
}

type Tab = 'auto' | 'manual';

export function AssignTechModal({
  open, onClose, bookingId, bookingNumber, booking: bookingProp, scheduledDate, onAssigned,
}: Props) {
  const [tab, setTab] = useState<Tab>('auto');

  // Shared
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');
  const [successData, setSuccessData] = useState<any>(null);
  const [liveStatus, setLiveStatus] = useState<string>(bookingProp?.status || '');

  // Auto tab
  const [autoLoading, setAutoLoading] = useState(false);
  const [cancellingAuto, setCancellingAuto] = useState(false);

  // WebSocket — activate after successful assignment
  const [wsBookingId, setWsBookingId] = useState<string | null>(null);
  const { status: wsStatus, lastEvent } = useBookingWebSocket(wsBookingId);

  // Manual tab
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candLoading, setCandLoading] = useState(false);
  const [candErr, setCandErr] = useState('');
  const [search, setSearch] = useState('');
  const [selectedTech, setSelectedTech] = useState('');
  const [manualSaving, setManualSaving] = useState(false);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [slotInfo, setSlotInfo] = useState<{ slot: string | null; date: string | null; maxPerSlot: number }>({
    slot: null, date: null, maxPerSlot: 2,
  });

  const isAutoAssigned = !!(bookingProp?.technician_id && bookingProp?.status === 'ASSIGNED');
  const hasExistingTech = !!bookingProp?.technician_id;

  // Reset when modal opens
  useEffect(() => {
    if (!open) return;
    setTab('auto');
    setNotes('');
    setErr('');
    setSuccess('');
    setSuccessData(null);
    setLiveStatus(bookingProp?.status || '');
    setWsBookingId(null);
    setCandidates([]);
    setSelectedTech('');
    setSearch('');
    setOnlyAvailable(false);
  }, [open]);

  // ── React to WS events ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!lastEvent) return;
    const t = lastEvent.type;
    const p = lastEvent.payload;
    if (p?.booking_id !== bookingId && p?.id !== bookingId) return;

    if (['BOOKING_STATUS_CHANGED', 'ASSIGNMENT_ACCEPTED', 'ASSIGNMENT_REJECTED', 'ASSIGNMENT_CREATED'].includes(t)) {
      if (p.status) setLiveStatus(p.status);

      if (p.status === 'ACCEPTED' || t === 'ASSIGNMENT_ACCEPTED') {
        onAssigned();
        setTimeout(() => onClose(), 1800);
      }

      if (t === 'ASSIGNMENT_REJECTED') {
        setSuccess('');
        setSuccessData(null);
        setSelectedTech('');
        setWsBookingId(null);
        if (tab === 'manual') loadCandidates();
        setErr('Technician rejected the job. Select another technician.');
      }
    }
  }, [lastEvent]);

  // ── Load candidates ─────────────────────────────────────────────────────────
  const loadCandidates = useCallback(async () => {
    setCandLoading(true); setCandErr('');
    try {
      const res = await technicianService.getCandidates(bookingId);
      // Backend returns { candidates: [...], scheduled_slot, scheduled_date, max_bookings_per_slot }
      if (res && (res as any).candidates) {
        const d = res as any;
        setCandidates(d.candidates || []);
        setSlotInfo({
          slot: d.scheduled_slot || null,
          date: d.scheduled_date || null,
          maxPerSlot: d.max_bookings_per_slot ?? 2,
        });
      } else {
        // fallback: old response shape (flat array)
        setCandidates(res as any[] || []);
      }
    } catch (ex: any) {
      setCandErr(errMsg(ex));
    } finally {
      setCandLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    if (tab === 'manual' && open && candidates.length === 0 && !candLoading) {
      loadCandidates();
    }
  }, [tab, open]);

  // ── Auto assign ─────────────────────────────────────────────────────────────
  const doAutoAssign = async () => {
    setAutoLoading(true); setErr('');
    try {
      const d = await technicianService.autoAssign(bookingId, notes || undefined);
      setSuccessData(d);
      setSuccess(`Auto-assigned to ${(d as any).technician_name || 'technician'} (Score: ${(d as any).score ?? 0})`);
      setLiveStatus('ASSIGNED');
      setWsBookingId(bookingId); // activate WS to watch for accept/reject
      onAssigned(); // refresh parent list immediately
    } catch (ex: any) {
      setErr(errMsg(ex));
    } finally {
      setAutoLoading(false);
    }
  };

  // ── Cancel auto assign ──────────────────────────────────────────────────────
  const doCancelAuto = async () => {
    setCancellingAuto(true); setErr('');
    try {
      await technicianService.cancelAutoAssign(bookingId);
      setTab('manual');
      loadCandidates();
    } catch (ex: any) {
      setErr(errMsg(ex));
    } finally {
      setCancellingAuto(false);
    }
  };

  // ── Manual assign ───────────────────────────────────────────────────────────
  const doManualAssign = async () => {
    if (!selectedTech) { setErr('Select a technician first.'); return; }
    setManualSaving(true); setErr('');
    try {
      await technicianService.manualAssign(bookingId, selectedTech, notes || undefined);
      const tech = candidates.find(c => c.technician_id === selectedTech);
      setSuccessData({ technician_name: tech?.name, score: tech?.score });
      setSuccess(`Manually assigned to ${tech?.name || 'technician'}`);
      setLiveStatus('ASSIGNED');
      setWsBookingId(bookingId);
      onAssigned();
      setTimeout(() => onClose(), 2000);
    } catch (ex: any) {
      setErr(errMsg(ex));
    } finally {
      setManualSaving(false);
    }
  };

  // ── Filtered candidates ─────────────────────────────────────────────────────
  const filtered = candidates.filter(c => {
    if (onlyAvailable && c.overloaded) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.area?.toLowerCase().includes(q) ||
      c.mobile?.includes(q)
    );
  });

  const title = hasExistingTech
    ? `Reassign Technician — ${bookingNumber}`
    : `Assign Technician — ${bookingNumber}`;

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-3">

        {/* ── Booking Info Strip ──────────────────────────────────────────── */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm flex items-start justify-between gap-3 flex-wrap">
          <div>
            <span className="font-black font-mono text-[#1B4FD8] text-base">{bookingNumber}</span>
            <div className="text-xs text-gray-500 mt-0.5 space-y-0.5">
              {bookingProp?.customer_name && <p>👤 {bookingProp.customer_name}{bookingProp.city ? ` · 📍 ${bookingProp.city}` : ''}</p>}
              {bookingProp?.service_name && <p>🔧 {bookingProp.service_name}</p>}
              {(bookingProp?.scheduled_date || bookingProp?.scheduled_slot) && (
                <p className="text-violet-700 font-semibold">
                  📅 {bookingProp?.scheduled_date
                    ? new Date(bookingProp.scheduled_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                    : ''}
                  {bookingProp?.scheduled_slot && ` · ⏰ ${bookingProp.scheduled_slot}`}
                  <span className="ml-2 text-gray-400 font-normal text-[10px]">(max 2 bookings/slot per tech)</span>
                </p>
              )}
              {bookingProp?.technician_name && (
                <p className="text-emerald-700">Currently: 👷 <b>{bookingProp.technician_name}</b></p>
              )}
            </div>
          </div>
          {/* Live status badge */}
          <div
            className="text-xs font-bold px-2.5 py-1 rounded-lg shrink-0"
            style={{
              background: `${STATUS_COLOR[liveStatus] || '#94A3B8'}22`,
              color: STATUS_COLOR[liveStatus] || '#64748B',
              border: `1px solid ${STATUS_COLOR[liveStatus] || '#E2E8F0'}`,
            }}
          >
            {STATUS_LABEL[liveStatus] || liveStatus || bookingProp?.status}
            {wsStatus === 'connected' && wsBookingId && (
              <span className="ml-1 animate-spin inline-block">⟳</span>
            )}
          </div>
        </div>

        {/* ── Error / Success banners ─────────────────────────────────────── */}
        {err && <AlertBanner type="error" message={err} onClose={() => setErr('')} />}

        {success && (
          <div className="bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3">
            <p className="text-sm font-bold text-emerald-800">✅ {success}</p>
            <div className="text-xs text-emerald-700 mt-1 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: wsStatus === 'connected' ? '#22C55E' : '#F59E0B',
                    animation: wsStatus === 'connected' ? 'pulse 1.5s infinite' : 'none',
                  }}
                />
                {wsBookingId
                  ? `Live WS — status: ${STATUS_LABEL[liveStatus] || liveStatus}`
                  : 'Dispatched — waiting for technician acceptance.'}
                {liveStatus === 'ACCEPTED' && <span className="font-bold text-emerald-700"> ✅ ACCEPTED!</span>}
              </div>
              <button onClick={() => { onAssigned(); onClose(); }} className="text-xs text-emerald-700 underline hover:text-emerald-900">
                Close ✕
              </button>
            </div>
          </div>
        )}

        {/* ── Cancel auto → manual banner ─────────────────────────────────── */}
        {isAutoAssigned && !success && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold text-amber-800">⚡ Pending auto-assignment active</p>
              <p className="text-xs text-gray-500 mt-0.5">Cancel it to take manual control instead.</p>
            </div>
            <button
              onClick={doCancelAuto}
              disabled={cancellingAuto}
              className="text-xs bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded-lg font-bold hover:bg-red-100 transition disabled:opacity-50 shrink-0"
            >
              {cancellingAuto ? <span className="flex items-center gap-1"><Spinner />Cancelling...</span> : '🚫 Disable Auto → Manual'}
            </button>
          </div>
        )}

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        {!success && (
          <>
            <div className="flex border-b border-gray-200 -mb-1">
              {(['auto', 'manual'] as Tab[]).map(t => (
                <button
                  key={t}
                  onClick={() => { setTab(t); setErr(''); }}
                  className={`px-5 py-2.5 text-sm font-bold border-b-2 transition ${
                    tab === t ? 'text-indigo-600 border-indigo-500' : 'text-gray-400 border-transparent hover:text-gray-600'
                  }`}
                >
                  {t === 'auto' ? '⚡ Auto Assign' : '👷 Manual Select'}
                </button>
              ))}
            </div>

            {/* ── AUTO TAB ─────────────────────────────────────────────── */}
            {tab === 'auto' && (
              <div className="space-y-3 pt-1">
                {/* Dispatch engine explainer */}
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-indigo-800 mb-2">🤖 Dispatch Engine Scoring</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    {[
                      ['Skill Match', '50 pts'],
                      ['Rating', 'rating × 20'],
                      ['Low Workload', 'up to 30 pts'],
                      ['Experience', 'up to 20 pts'],
                      ['Distance', 'closer = more pts'],
                      ['Online Now', '+10 pts'],
                    ].map(([label, val]) => (
                      <div key={label} className="flex justify-between text-gray-600">
                        <span>{label}</span>
                        <span className="font-bold text-indigo-700">{val}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">
                    Highest-scoring available technician gets an FCM push. 5 min to accept before auto-redispatch.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Assignment notes…"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={doAutoAssign}
                    disabled={autoLoading}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
                  >
                    {autoLoading ? <><Spinner />Running...</> : '⚡ Run Auto Assignment'}
                  </button>
                  <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            )}

            {/* ── MANUAL TAB ───────────────────────────────────────────── */}
            {tab === 'manual' && (
              <div className="space-y-3 pt-1">
                {/* Controls */}
                <div className="flex gap-2 flex-wrap items-center">
                  <input
                    className="flex-1 min-w-32 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search name, city, area, mobile…"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={onlyAvailable}
                      onChange={e => setOnlyAvailable(e.target.checked)}
                      className="cursor-pointer"
                    />
                    Hide overloaded
                  </label>
                  <button
                    onClick={loadCandidates}
                    disabled={candLoading}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition disabled:opacity-50"
                    title="Refresh"
                  >
                    {candLoading ? <Spinner /> : '🔄'}
                  </button>
                </div>

                {candErr && <AlertBanner type="error" message={candErr} onClose={() => setCandErr('')} />}

                {/* Slot legend */}
                {slotInfo.slot && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-[11px] text-indigo-800 flex flex-wrap gap-3">
                    <span>⏰ <b>Slot:</b> {slotInfo.slot}</span>
                    {slotInfo.date && <span>📅 {new Date(slotInfo.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                    <span>Max <b>{slotInfo.maxPerSlot} bookings</b>/tech for this slot</span>
                    <span className="text-red-700 font-semibold">🚫 = slot full · ✅ = available</span>
                  </div>
                )}

                {/* Candidate list */}
                <div className="max-h-72 overflow-y-auto pr-0.5">
                  {candLoading && (
                    <div className="text-center py-10 text-gray-400">
                      <Spinner />
                      <p className="text-xs mt-2">Scoring technicians…</p>
                    </div>
                  )}
                  {!candLoading && filtered.length === 0 && (
                    <p className="text-center text-sm text-gray-400 py-10">
                      {search || onlyAvailable ? 'No technicians match filter' : 'No available technicians found'}
                    </p>
                  )}
                  {!candLoading && filtered.map((c, idx) => (
                    <CandidateCard
                      key={c.technician_id}
                      candidate={c}
                      rank={candidates.indexOf(c) + 1}
                      selected={selectedTech === c.technician_id}
                      onSelect={() => setSelectedTech(selectedTech === c.technician_id ? '' : c.technician_id)}
                    />
                  ))}
                </div>

                {/* Notes + selected preview + confirm */}
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
                    <input
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Assignment notes…"
                    />
                  </div>

                  {selectedTech && (() => {
                    const t = candidates.find(c => c.technician_id === selectedTech);
                    return t ? (
                      <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-sm flex items-center gap-3">
                        <span className="font-bold text-indigo-800">👷 {t.name}</span>
                        <span className="text-indigo-600">Score: {t.score}</span>
                        {t.skill_match && <span className="text-emerald-700">✅ Skill Match</span>}
                      </div>
                    ) : null;
                  })()}

                  <div className="flex gap-2">
                    <button
                      onClick={doManualAssign}
                      disabled={!selectedTech || manualSaving}
                      className="flex-1 py-2.5 rounded-xl bg-[#1B4FD8] text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
                    >
                      {manualSaving ? <><Spinner />Assigning...</> : '👷 Confirm Manual Assignment'}
                    </button>
                    <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
