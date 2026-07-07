import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { callLogService, CallOutcome } from '../../services/callLog.service';
import { FollowupTaskModal } from './FollowupTaskModal';

interface Props {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  bookingId?: string;
  bookings?: { id: string; booking_number: string; status: string }[];
  onLogged: () => void;
  /** Auto-filled from the call timer in CustomersPage */
  elapsedSeconds?: number;
}

const OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: 'RESOLVED', label: 'Resolved on call' },
  { value: 'TICKET_RAISED', label: 'Ticket raised to admin' },
  { value: 'CALLBACK_REQUESTED', label: 'Callback requested' },
  { value: 'PAYMENT_REMINDER', label: 'Payment reminder given' },
  { value: 'NO_ANSWER', label: 'No answer' },
  { value: 'OTHER', label: 'Other' },
];

export const CallLogModal: React.FC<Props> = ({ open, onClose, customerId, customerName, bookingId, bookings = [], onLogged, elapsedSeconds }) => {
  const [outcome, setOutcome] = useState<CallOutcome>('RESOLVED');
  const [summary, setSummary] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('INBOUND');
  const [linkedBookingId, setLinkedBookingId] = useState(bookingId || '');
  const [showFollowup, setShowFollowup] = useState(false);

  // Capture elapsed at the moment the modal OPENS — do NOT include elapsedSeconds
  // in the dep array, as it ticks every second and would wipe the summary textarea.
  const elapsedAtOpen = React.useRef(0);
  React.useEffect(() => {
    if (open) {
      elapsedAtOpen.current = elapsedSeconds || 0;
      setOutcome('RESOLVED');
      setSummary('');
      setError('');
      setDirection('INBOUND');
      setLinkedBookingId(bookingId || '');
      if (elapsedAtOpen.current > 0) {
        setMinutes(String(Math.floor(elapsedAtOpen.current / 60)));
        setSeconds(String(elapsedAtOpen.current % 60));
      } else {
        setMinutes('');
        setSeconds('');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingId]); // intentionally omit elapsedSeconds — captured via ref

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) { setError('Please add a short summary of the call.'); return; }
    setSaving(true);
    setError('');
    try {
      const duration = (parseInt(minutes || '0', 10) * 60) + parseInt(seconds || '0', 10);
      await callLogService.create({
        customer_id: customerId,
        booking_id: linkedBookingId || bookingId || undefined,
        direction,
        outcome,
        summary: summary.trim(),
        duration_seconds: duration || undefined,
      });
      onLogged();
      if (outcome === 'CALLBACK_REQUESTED') {
        // Keep modal open, show follow-up prompt
        setShowFollowup(true);
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not save call log.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <Modal open={open} onClose={onClose} title={`Log call — ${customerName}`} size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        {/* Direction */}
        <div>
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">Call direction</label>
          <div className="flex gap-2">
            {(['INBOUND', 'OUTBOUND'] as const).map(d => (
              <button key={d} type="button" onClick={() => setDirection(d)}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition ${direction === d ? 'border-[#1B4FD8] bg-blue-50 text-[#1B4FD8]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                {d === 'INBOUND' ? '📞 Inbound (customer called)' : '📲 Outbound (CCO called)'}
              </button>
            ))}
          </div>
        </div>

        {/* Link to booking */}
        {bookings.length > 0 && (
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">Link to booking (optional)</label>
            <select
              value={linkedBookingId}
              onChange={e => setLinkedBookingId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20"
            >
              <option value="">— Not linked to a specific booking —</option>
              {bookings.map(b => (
                <option key={b.id} value={b.id}>{b.booking_number} · {b.status.replace(/_/g,' ')}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">Call outcome</label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                className={`text-left px-3 py-2 rounded-lg border text-sm transition ${
                  outcome === o.value
                    ? 'border-[#1B4FD8] bg-blue-50 text-[#1B4FD8] font-medium'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">
            Call duration (optional)
            {elapsedSeconds && elapsedSeconds > 0 && (
              <span className="ml-2 text-emerald-600 font-semibold normal-case tracking-normal">(auto-filled from call timer)</span>
            )}
          </label>
          <div className="flex gap-3">
            <input type="number" min={0} placeholder="Minutes" value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20" />
            <input type="number" min={0} max={59} placeholder="Seconds" value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20" />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">Call summary</label>
          <textarea
            rows={4}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What did the customer need? What was discussed / resolved?"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Save call log</Button>
        </div>
      </form>
    </Modal>

    {showFollowup && (
      <FollowupTaskModal
        open={showFollowup}
        onClose={() => { setShowFollowup(false); onClose(); }}
        customerId={customerId}
        customerName={customerName}
        defaultSubject={`Callback requested by ${customerName}`}
        onCreated={() => { setShowFollowup(false); onClose(); }}
      />
    )}
  </>
  );
};
