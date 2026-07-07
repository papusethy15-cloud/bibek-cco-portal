import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { escalationService } from '../../services/escalation.service';

interface Props {
  open: boolean;
  onClose: () => void;
  customerName: string;
  bookingId?: string;
  onRaised: () => void;
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export const RaiseTicketModal: React.FC<Props> = ({ open, onClose, customerName, bookingId, onRaised }) => {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (open) { setSubject(''); setDescription(''); setPriority('MEDIUM'); setError(''); }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) {
      setError('Subject and description are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await escalationService.create({ booking_id: bookingId, subject: subject.trim(), description: description.trim(), priority });
      onRaised();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not raise ticket.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Raise ticket — ${customerName}`} size="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        {bookingId ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
            🎫 Ticket will be linked to the selected booking and sent to admin for resolution.
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
            🎫 General ticket for customer <b>{customerName}</b> — not linked to a specific booking.
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">Priority</label>
          <div className="flex gap-2">
            {PRIORITIES.map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition ${
                  priority === p ? 'border-[#1B4FD8] bg-blue-50 text-[#1B4FD8]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Payment failed issue, Technician complaint"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20" />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2 block">Description</label>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue so admin can act on it"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" loading={saving}>Raise ticket to admin</Button>
        </div>
      </form>
    </Modal>
  );
};
