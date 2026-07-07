import React, { useState } from 'react';
import { Spinner } from '../ui/Spinner';
import { Button } from '../ui/Button';
import { customerService } from '../../services/customer.service';
import { CallLogEntry } from '../../services/callLog.service';

interface NoteEntry {
  id: string;
  note: string;
  note_type: string;
  added_by_name?: string;
  created_at: string;
}

interface TimelineItem {
  kind: 'note' | 'call';
  id: string;
  created_at: string;
  content: React.ReactNode;
}

interface Props {
  customerId: string;
  notes: NoteEntry[];
  calls: CallLogEntry[];
  loading: boolean;
  onNoteAdded: () => void;
}

const outcomeLabel: Record<string, string> = {
  RESOLVED: 'Resolved on call',
  TICKET_RAISED: 'Ticket raised',
  CALLBACK_REQUESTED: 'Callback requested',
  PAYMENT_REMINDER: 'Payment reminder',
  NO_ANSWER: 'No answer',
  OTHER: 'Other',
};

function formatDuration(seconds?: number) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export const CustomerNotesTimeline: React.FC<Props> = ({ customerId, notes, calls, loading, onNoteAdded }) => {
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      await customerService.addNote(customerId, noteText.trim());
      setNoteText('');
      onNoteAdded();
    } finally {
      setSaving(false);
    }
  };

  const items: TimelineItem[] = [
    ...notes.map((n) => ({
      kind: 'note' as const,
      id: n.id,
      created_at: n.created_at,
      content: (
        <div>
          <p className="text-sm text-gray-800">{n.note}</p>
          <p className="text-xs text-gray-400 mt-1">{n.added_by_name || 'CCO'} · Note</p>
        </div>
      ),
    })),
    ...calls.map((c) => ({
      kind: 'call' as const,
      id: c.id,
      created_at: c.created_at,
      content: (
        <div>
          <p className="text-sm text-gray-800">{c.summary}</p>
          <p className="text-xs text-gray-400 mt-1">
            {c.cco_name || 'CCO'} · {outcomeLabel[c.outcome] || c.outcome}
            {formatDuration(c.duration_seconds) ? ` · ${formatDuration(c.duration_seconds)}` : ''}
          </p>
        </div>
      ),
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddNote(); }}
          placeholder="Add a quick note about this customer..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20"
        />
        <Button size="sm" onClick={handleAddNote} loading={saving} disabled={!noteText.trim()}>Add</Button>
      </div>

      {loading ? (
        <div className="py-8"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">No notes or calls logged yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={`${item.kind}-${item.id}`} className="flex gap-3">
              <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${item.kind === 'call' ? 'bg-[#1B4FD8]' : 'bg-orange-400'}`} />
              <div className="flex-1 bg-gray-50 rounded-xl px-4 py-3">
                {item.content}
                <p className="text-[11px] text-gray-400 mt-1">
                  {new Date(item.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
