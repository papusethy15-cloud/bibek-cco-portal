/**
 * FollowupTaskModal.tsx
 * Creates a CRM follow-up entry (callback task) for a customer.
 * Triggered automatically when CallLogModal outcome = CALLBACK_REQUESTED,
 * or manually from the dashboard follow-up widget.
 */
import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { crmService } from '../../services/crm.service';

interface Props {
  open: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  /** Pre-fill subject when triggered from a specific context */
  defaultSubject?: string;
  onCreated?: () => void;
}

export function FollowupTaskModal({
  open, onClose, customerId, customerName, defaultSubject, onCreated,
}: Props) {
  const [subject, setSubject] = useState(defaultSubject || '');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  React.useEffect(() => {
    if (open) {
      setSubject(defaultSubject || '');
      setNotes('');
      setDueDate(tomorrowStr);
      setError('');
    }
  }, [open, defaultSubject, tomorrowStr]);

  const handleSave = async () => {
    if (!subject.trim()) { setError('Please enter a subject for the follow-up.'); return; }
    if (!dueDate) { setError('Please select a due date.'); return; }
    setSaving(true);
    setError('');
    try {
      await crmService.createFollowup({
        customer_id: customerId,
        subject: subject.trim(),
        notes: notes.trim() || undefined,
        due_date: dueDate,
      });
      onCreated?.();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to create follow-up task.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Follow-up Task — ${customerName}`} size="sm">
      <div className="space-y-4">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-800">
          A follow-up reminder will be created and appear in your dashboard for today's follow-up tasks.
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Subject *</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            placeholder="e.g. Customer requested callback for booking query"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Due Date *</label>
          <input
            type="date"
            min={new Date().toISOString().split('T')[0]}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
          <textarea
            rows={2}
            placeholder="Context for the callback..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Skip</Button>
          <Button loading={saving} onClick={handleSave}>Create Follow-up</Button>
        </div>
      </div>
    </Modal>
  );
}
