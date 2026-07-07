import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { bookingService } from '../../services/booking.service';

interface Props {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  bookingNumber: string;
  currentDate?: string;   // YYYY-MM-DD from loaded detail state
  currentSlot?: string;   // e.g. "10:00-12:00"
  onRescheduled: () => void;
}

// ─── Slot definitions ────────────────────────────────────────────────────────
const SLOTS = [
  { value: '08:00-10:00', label: '8:00 – 10:00 AM',  short: '8–10 AM'   },
  { value: '10:00-12:00', label: '10:00 AM – 12:00 PM', short: '10 AM–12' },
  { value: '12:00-14:00', label: '12:00 – 2:00 PM',   short: '12–2 PM'  },
  { value: '14:00-16:00', label: '2:00 – 4:00 PM',    short: '2–4 PM'   },
  { value: '16:00-18:00', label: '4:00 – 6:00 PM',    short: '4–6 PM'   },
  { value: '18:00-20:00', label: '6:00 – 8:00 PM',    short: '6–8 PM'   },
];

// Total booking capacity per slot across all technicians (CCO-level view)
// This is a soft cap — CCO can see when slots are busy but can still book
const SOFT_CAP = 5;   // show "almost full" warning
const HARD_CAP = 10;  // absolute max before slot is marked FULL

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Returns today's date string in IST (safe after 18:30 UTC) */
function todayIST(): string {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return istNow.toISOString().split('T')[0];
}

/** Strip time part — "2026-07-10T00:00:00" → "2026-07-10" */
function normDate(raw?: string | null): string {
  if (!raw) return '';
  return raw.split('T')[0];
}

/** Human-readable date: "2026-07-10" → "Thu, 10 Jul 2026" */
function fmtDate(d: string): string {
  if (!d) return '—';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return d; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SlotCapacityBar({ count }: { count: number }) {
  const filled = Math.min(count, HARD_CAP);
  const pct    = Math.round((filled / HARD_CAP) * 100);

  const barColor =
    count >= HARD_CAP  ? 'bg-red-500'
    : count >= SOFT_CAP ? 'bg-amber-400'
    : count >= 3        ? 'bg-yellow-300'
    : 'bg-emerald-500';

  const textColor =
    count >= HARD_CAP  ? 'text-red-600'
    : count >= SOFT_CAP ? 'text-amber-600'
    : count >= 3        ? 'text-yellow-600'
    : 'text-emerald-700';

  const label =
    count >= HARD_CAP  ? `Full (${HARD_CAP}/${HARD_CAP})`
    : count >= SOFT_CAP ? `${count}/${HARD_CAP} — busy`
    : count === 0       ? 'Available'
    : `${count}/${HARD_CAP} booked`;

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`text-[10px] font-semibold ${textColor}`}>{label}</p>
    </div>
  );
}

function SlotButton({
  slot,
  count,
  isSelected,
  isCurrent,
  dateSelected,
  loadingSlots,
  onClick,
}: {
  slot: typeof SLOTS[0];
  count: number;
  isSelected: boolean;
  isCurrent: boolean;
  dateSelected: boolean;
  loadingSlots: boolean;
  onClick: () => void;
}) {
  const isFull = count >= HARD_CAP;
  const isBusy = count >= SOFT_CAP && count < HARD_CAP;

  let borderClass = 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer';
  if (isSelected)  borderClass = 'border-[#1B4FD8] bg-blue-50 ring-1 ring-[#1B4FD8]';
  else if (isFull) borderClass = 'border-red-200 bg-red-50 cursor-not-allowed';
  else if (isBusy) borderClass = 'border-amber-200 hover:border-amber-300 cursor-pointer';

  return (
    <button
      onClick={() => !isFull && onClick()}
      disabled={!dateSelected || isFull}
      className={`text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${borderClass} ${
        !dateSelected ? 'opacity-40 cursor-not-allowed' : ''
      }`}
    >
      {/* Top row: slot label + badges */}
      <div className="flex items-center justify-between gap-1 min-w-0">
        <span className={`font-semibold truncate ${
          isSelected ? 'text-[#1B4FD8]'
          : isFull   ? 'text-red-600'
          : isBusy   ? 'text-amber-700'
          : 'text-gray-800'
        }`}>
          {slot.label}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {isCurrent && (
            <span className="text-[9px] font-bold bg-blue-100 text-blue-700 rounded px-1 py-0.5 leading-none">
              CURRENT
            </span>
          )}
          {isFull && (
            <span className="text-[9px] font-bold bg-red-100 text-red-600 rounded px-1 py-0.5 leading-none">
              FULL
            </span>
          )}
          {isBusy && !isFull && (
            <span className="text-[9px] font-bold bg-amber-100 text-amber-700 rounded px-1 py-0.5 leading-none">
              BUSY
            </span>
          )}
        </div>
      </div>

      {/* Capacity bar — only once a date is picked */}
      {dateSelected && (
        loadingSlots
          ? <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full animate-pulse" />
          : <SlotCapacityBar count={count} />
      )}
    </button>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export function RescheduleModal({
  open,
  onClose,
  bookingId,
  bookingNumber,
  currentDate,
  currentSlot,
  onRescheduled,
}: Props) {
  const today = todayIST();

  const [date, setDate]               = useState('');
  const [slot, setSlot]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [slotCounts, setSlotCounts]   = useState<Record<string, number>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);

  const normCurrent = normDate(currentDate);
  // Guard: treat "—" (backend default for null slot) as empty
  const normCurrentSlot = (!currentSlot || currentSlot === '—') ? '' : currentSlot;

  // ── Pre-fill when modal opens ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setDate(normCurrent || today);
    setSlot(normCurrentSlot);
    setError('');
  }, [open, normCurrent, normCurrentSlot]);  // re-run if props update after async load

  // ── Fetch real slot counts from dedicated backend endpoint ─────────────────
  const fetchSlotCounts = useCallback(async (d: string) => {
    if (!d) { setSlotCounts({}); return; }
    setLoadingSlots(true);
    try {
      const counts = await bookingService.slotSummary(d);
      setSlotCounts(counts);
    } catch {
      setSlotCounts({});
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    if (open && date) fetchSlotCounts(date);
  }, [date, open, fetchSlotCounts]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!date || !slot) { setError('Please select a date and slot.'); return; }
    const count = slotCounts[slot] || 0;
    if (count >= HARD_CAP) {
      setError(`Slot is full (${HARD_CAP}/${HARD_CAP} bookings). Please choose another.`);
      return;
    }
    setLoading(true); setError('');
    try {
      await bookingService.reschedule(bookingId, date, slot);
      onRescheduled();
      onClose();
    } catch (e: any) {
      setError(
        e?.response?.data?.detail ||
        e?.response?.data?.message ||
        'Failed to reschedule. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const isCurrentDate  = date === normCurrent;
  const selectedCount  = slot ? (slotCounts[slot] || 0) : 0;
  const totalOnDate    = Object.values(slotCounts).reduce((a, b) => a + b, 0);
  const hasChange      = date !== normCurrent || slot !== normCurrentSlot;

  return (
    <Modal open={open} onClose={onClose} title={`Reschedule — ${bookingNumber}`}>
      <div className="space-y-4">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        {/* ── Current booking info ─────────────────────────────────────── */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex flex-col gap-1">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Current Schedule</p>
          <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-sm">
            <span className="text-gray-700">
              <span className="font-medium text-gray-900">📅 </span>
              {normCurrent ? fmtDate(normCurrent) : <span className="text-gray-400 italic">Not set</span>}
            </span>
            <span className="text-gray-700">
              <span className="font-medium text-gray-900">🕐 </span>
              {normCurrentSlot
                ? (SLOTS.find(s => s.value === normCurrentSlot)?.label || normCurrentSlot)
                : <span className="text-gray-400 italic">No slot</span>}
            </span>
          </div>
        </div>

        {/* ── Date picker ──────────────────────────────────────────────── */}
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1.5">
            New Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            min={today}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] focus:border-transparent transition"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setSlot('');
              setSlotCounts({});
            }}
          />
          {date && (
            <p className="text-xs text-gray-400 mt-1">
              {fmtDate(date)}
              {loadingSlots ? ' · Loading availability…' : totalOnDate > 0 ? ` · ${totalOnDate} active booking${totalOnDate !== 1 ? 's' : ''} on this day` : ' · No bookings yet on this day'}
            </p>
          )}
        </div>

        {/* ── Slot grid ────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-600">
              New Slot <span className="text-red-500">*</span>
            </label>
            {date && !loadingSlots && (
              <span className="text-[10px] text-gray-400">
                Capacity: {HARD_CAP} bookings/slot · Busy ≥{SOFT_CAP}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {SLOTS.map((s) => (
              <SlotButton
                key={s.value}
                slot={s}
                count={slotCounts[s.value] || 0}
                isSelected={slot === s.value}
                isCurrent={isCurrentDate && s.value === normCurrentSlot}
                dateSelected={!!date}
                loadingSlots={loadingSlots}
                onClick={() => setSlot(s.value)}
              />
            ))}
          </div>

          {!date && (
            <p className="text-xs text-gray-400 mt-2 text-center">
              Select a date above to see slot availability
            </p>
          )}
        </div>

        {/* ── Selected slot summary ─────────────────────────────────────── */}
        {slot && date && !loadingSlots && (
          <div className={`rounded-xl px-4 py-3 text-sm border ${
            selectedCount >= HARD_CAP
              ? 'bg-red-50 border-red-200'
              : selectedCount >= SOFT_CAP
              ? 'bg-amber-50 border-amber-200'
              : 'bg-emerald-50 border-emerald-200'
          }`}>
            <p className={`font-semibold ${
              selectedCount >= HARD_CAP ? 'text-red-700'
              : selectedCount >= SOFT_CAP ? 'text-amber-700'
              : 'text-emerald-700'
            }`}>
              {selectedCount >= HARD_CAP
                ? `⛔ Slot full — ${selectedCount}/${HARD_CAP} bookings`
                : selectedCount >= SOFT_CAP
                ? `⚠️ Slot busy — ${selectedCount}/${HARD_CAP} bookings`
                : `✅ Slot available — ${selectedCount}/${HARD_CAP} bookings`}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {SLOTS.find(s => s.value === slot)?.label} · {fmtDate(date)}
            </p>
          </div>
        )}

        {/* ── No-change warning ─────────────────────────────────────────── */}
        {!hasChange && date && slot && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            ⚠️ Date and slot are the same as the current schedule. Please change at least one.
          </p>
        )}

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={loading}
            disabled={!date || !slot || !hasChange || (slotCounts[slot] || 0) >= HARD_CAP}
            onClick={handleSubmit}
          >
            Confirm Reschedule
          </Button>
        </div>
      </div>
    </Modal>
  );
}
