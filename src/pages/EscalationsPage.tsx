import React, { useState, useEffect, useCallback } from 'react';
import { escalationService } from '../services/escalation.service';
import { Escalation } from '../types';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { AlertBanner } from '../components/ui/AlertBanner';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';

const priorityColors: Record<string, string> = {
  LOW:    'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  HIGH:   'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
};

const statusColors: Record<string, string> = {
  OPEN:        'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-violet-100 text-violet-800',
  ESCALATED:   'bg-red-100 text-red-800',
  RESOLVED:    'bg-emerald-100 text-emerald-800',
  CLOSED:      'bg-gray-100 text-gray-700',
};

const statusIcons: Record<string, string> = {
  OPEN:        '🔵',
  IN_PROGRESS: '🟣',
  ESCALATED:   '🔴',
  RESOLVED:    '✅',
  CLOSED:      '⬛',
};

type ActionType = 'resolve' | 'in_progress' | 'escalate' | 'close' | null;

export function EscalationsPage() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // New ticket modal
  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState('MEDIUM');
  const [newBookingId, setNewBookingId] = useState('');
  const [creating, setCreating] = useState(false);

  // Detail modal
  const [selected, setSelected] = useState<Escalation | null>(null);
  const [selectedFull, setSelectedFull] = useState<Escalation | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionNote, setActionNote] = useState('');
  const [doingAction, setDoingAction] = useState<ActionType>(null);
  const [changingPriority, setChangingPriority] = useState(false);

  const PER_PAGE = 20;

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: pg, limit: PER_PAGE };
      if (statusFilter)   params.status   = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const res = await escalationService.list(params);
      setEscalations(res.items || []);
      setTotal(res.total || 0);
      setPage(pg);
    } catch {
      setError('Failed to load escalations.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    load(1);
    const interval = setInterval(() => load(page), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load, page]);

  const handleOpen = async (e: Escalation) => {
    setSelected(e);
    setSelectedFull(null);
    setActionNote('');
    setDoingAction(null);
    setLoadingDetail(true);
    try {
      const full = await escalationService.getById(e.id);
      setSelectedFull(full);
    } catch {
      setSelectedFull(e);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setSelectedFull(null);
    setActionNote('');
    setDoingAction(null);
  };

  const handleCreate = async () => {
    if (!newSubject.trim() || !newDesc.trim()) { setError('Subject and description are required.'); return; }
    setCreating(true); setError('');
    try {
      await escalationService.create({
        subject: newSubject,
        description: newDesc,
        priority: newPriority,
        booking_id: newBookingId || undefined,
      });
      setSuccess('Ticket raised and sent to admin.');
      setShowNew(false);
      setNewSubject(''); setNewDesc(''); setNewPriority('MEDIUM'); setNewBookingId('');
      load(1);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to create ticket.');
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (action: ActionType, statusValue: string) => {
    if (!selected) return;
    setDoingAction(action);
    try {
      await escalationService.updateStatus(selected.id, statusValue, actionNote || undefined);
      setSuccess(`Ticket ${statusValue.toLowerCase().replace('_', ' ')}.`);
      closeDetail();
      load(page);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Action failed.');
    } finally {
      setDoingAction(null);
    }
  };

  const handleChangePriority = async (newPrio: string) => {
    if (!selected) return;
    setChangingPriority(true);
    try {
      await escalationService.updatePriority(selected.id, newPrio);
      // refresh detail
      const fresh = await escalationService.getById(selected.id);
      setSelectedFull(fresh);
      setSelected(prev => prev ? { ...prev, priority: newPrio } : prev);
      setEscalations(prev => prev.map(e => e.id === selected.id ? { ...e, priority: newPrio } : e));
    } catch {
      setError('Failed to change priority.');
    } finally {
      setChangingPriority(false);
    }
  };

  const displayTicket = selectedFull || selected;
  const openCount = escalations.filter(e => e.status === 'OPEN').length;
  const urgentCount = escalations.filter(e => e.priority === 'URGENT' && !['RESOLVED','CLOSED'].includes(e.status)).length;
  const totalPages = Math.ceil(total / PER_PAGE);

  // Summary stats
  const statusCounts = ['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'].map(s => ({
    status: s,
    count: escalations.filter(e => e.status === s).length,
  }));

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Escalations</h1>
          <p className="text-gray-500 mt-1">Customer complaints and support tickets.</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Raise Ticket
        </Button>
      </div>

      {success && <AlertBanner type="success" message={success} onClose={() => setSuccess('')} />}
      {error   && <AlertBanner type="error"   message={error}   onClose={() => setError('')} />}

      {/* Alert banners */}
      {urgentCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 font-medium flex items-center gap-2">
          🚨 {urgentCount} URGENT ticket{urgentCount > 1 ? 's' : ''} require{urgentCount === 1 ? 's' : ''} immediate attention
        </div>
      )}
      {openCount > 0 && urgentCount === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-800 font-medium">
          ⚠ {openCount} open ticket{openCount > 1 ? 's' : ''} need{openCount === 1 ? 's' : ''} attention
        </div>
      )}

      {/* Status summary strip */}
      <div className="grid grid-cols-5 gap-2">
        {statusCounts.map(({ status, count }) => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
            className={`bg-white rounded-xl border p-3 text-left transition hover:shadow-sm ${
              statusFilter === status ? 'border-[#1B4FD8] ring-1 ring-[#1B4FD8]' : 'border-gray-100'
            }`}
          >
            <p className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-block mb-1 ${statusColors[status]}`}>
              {statusIcons[status]} {status.replace('_', ' ')}
            </p>
            <p className="text-lg font-bold text-gray-900">{count}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="ESCALATED">Escalated</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
          value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
        >
          <option value="">All Priority</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
        {(statusFilter || priorityFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setPriorityFilter(''); }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50">
          <p className="text-sm text-gray-500">{total} ticket{total !== 1 ? 's' : ''}</p>
        </div>
        {loading ? (
          <div className="py-16"><Spinner /></div>
        ) : escalations.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No tickets found.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {escalations.map(e => (
              <div
                key={e.id}
                onClick={() => handleOpen(e)}
                className={`px-5 py-4 hover:bg-gray-50 cursor-pointer transition flex items-start justify-between gap-4 ${
                  e.priority === 'URGENT' && !['RESOLVED','CLOSED'].includes(e.status) ? 'border-l-4 border-red-400' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{e.subject}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColors[e.priority] || 'bg-gray-100 text-gray-700'}`}>
                      {e.priority}
                    </span>
                    {(e as any).resolution_notes && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700">
                        💬 Admin replied
                      </span>
                    )}
                    {(e as any).escalation_level > 1 && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600">
                        ⬆ L{(e as any).escalation_level}
                      </span>
                    )}
                  </div>
                  {(e as any).description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-1">{(e as any).description}</p>
                  )}
                  {(e as any).resolution_notes && (
                    <p className="text-xs text-emerald-700 mt-1 line-clamp-1 font-medium">
                      Admin: {(e as any).resolution_notes}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(e.created_at).toLocaleDateString('en-IN')}
                    {(e as any).booking_id && (
                      <span className="ml-2">📋 Booking linked</span>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[e.status] || 'bg-gray-100 text-gray-700'}`}>
                  {statusIcons[e.status]} {e.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-4 border-t border-gray-50">
            <button onClick={() => load(page - 1)} disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Prev</button>
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <button onClick={() => load(page + 1)} disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next →</button>
          </div>
        )}
      </div>

      {/* New ticket modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Raise New Ticket">
        <div className="space-y-4">
          {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Subject *</label>
            <Input placeholder="Brief issue title" value={newSubject} onChange={e => setNewSubject(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description *</label>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
              rows={4}
              placeholder="Explain the issue in detail..."
              value={newDesc} onChange={e => setNewDesc(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                value={newPriority} onChange={e => setNewPriority(e.target.value)}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Booking # (optional)</label>
              <Input placeholder="Booking ID" value={newBookingId} onChange={e => setNewBookingId(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button loading={creating} onClick={handleCreate}>Raise Ticket</Button>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={!!selected}
        onClose={closeDetail}
        title={selected?.subject || ''}
        size="lg"
      >
        {selected && (
          <div className="space-y-5">
            {loadingDetail ? (
              <div className="py-6"><Spinner /></div>
            ) : (
              <>
                {/* Status / Priority / Level badges */}
                <div className="flex gap-2 flex-wrap items-center">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusColors[displayTicket?.status || '']}`}>
                    {statusIcons[displayTicket?.status || '']} {displayTicket?.status?.replace(/_/g, ' ')}
                  </span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${priorityColors[displayTicket?.priority || '']}`}>
                    {displayTicket?.priority}
                  </span>
                  {(displayTicket as any)?.escalation_level > 1 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">
                      ⬆ Escalation Level {(displayTicket as any).escalation_level}
                    </span>
                  )}
                </div>

                {/* Description */}
                <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl p-4">
                  {displayTicket?.description || <span className="italic text-gray-400">No description</span>}
                </p>

                {/* Metadata grid */}
                <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                  <div><span className="font-medium">Created:</span> {displayTicket?.created_at ? new Date(displayTicket.created_at).toLocaleString('en-IN') : '—'}</div>
                  {(displayTicket as any)?.updated_at && <div><span className="font-medium">Updated:</span> {new Date((displayTicket as any).updated_at).toLocaleString('en-IN')}</div>}
                  {(displayTicket as any)?.booking_id && <div><span className="font-medium">Booking:</span> {(displayTicket as any).booking_id}</div>}
                  {(displayTicket as any)?.assigned_to && <div><span className="font-medium">Assigned to:</span> {(displayTicket as any).assigned_to}</div>}
                  {(displayTicket as any)?.resolved_at && <div><span className="font-medium">Resolved:</span> {new Date((displayTicket as any).resolved_at).toLocaleString('en-IN')}</div>}
                </div>

                {/* Admin reply notes */}
                {(displayTicket as any)?.resolution_notes && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-emerald-800 mb-1 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Admin Reply / Resolution Notes
                    </p>
                    <p className="text-sm text-emerald-900 whitespace-pre-wrap">{(displayTicket as any).resolution_notes}</p>
                  </div>
                )}

                {/* Action section — only for non-closed tickets */}
                {!['RESOLVED', 'CLOSED'].includes(displayTicket?.status || '') && (
                  <div className="border-t pt-4 space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1.5">Notes for this action (optional)</label>
                      <textarea
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
                        rows={3}
                        placeholder="What action did you take / what's the resolution?"
                        value={actionNote}
                        onChange={e => setActionNote(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {/* Mark In Progress */}
                      {displayTicket?.status === 'OPEN' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={doingAction === 'in_progress'}
                          onClick={() => handleAction('in_progress', 'IN_PROGRESS')}
                        >
                          🟣 Mark In Progress
                        </Button>
                      )}

                      {/* Escalate */}
                      {!['ESCALATED'].includes(displayTicket?.status || '') && (
                        <Button
                          size="sm"
                          variant="danger"
                          loading={doingAction === 'escalate'}
                          onClick={() => handleAction('escalate', 'ESCALATED')}
                        >
                          🔴 Escalate Further
                        </Button>
                      )}

                      {/* Resolve */}
                      <Button
                        size="sm"
                        variant="success"
                        loading={doingAction === 'resolve'}
                        onClick={() => handleAction('resolve', 'RESOLVED')}
                      >
                        ✅ Mark Resolved
                      </Button>

                      {/* Close */}
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={doingAction === 'close'}
                        onClick={() => handleAction('close', 'CLOSED')}
                      >
                        ⬛ Close Ticket
                      </Button>
                    </div>

                    {/* Priority changer */}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs text-gray-500 font-medium">Change priority:</span>
                      {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => (
                        <button
                          key={p}
                          disabled={changingPriority || displayTicket?.priority === p}
                          onClick={() => handleChangePriority(p)}
                          className={`text-xs px-2 py-0.5 rounded-full font-medium transition disabled:opacity-40 ${
                            displayTicket?.priority === p
                              ? priorityColors[p] + ' ring-2 ring-offset-1 ring-current'
                              : priorityColors[p] + ' opacity-60 hover:opacity-100'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                      {changingPriority && <div className="w-3 h-3 border-2 border-[#1B4FD8] border-t-transparent rounded-full animate-spin" />}
                    </div>
                  </div>
                )}

                {/* Reopen if resolved/closed */}
                {['RESOLVED', 'CLOSED'].includes(displayTicket?.status || '') && (
                  <div className="border-t pt-4">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={doingAction === 'in_progress'}
                      onClick={() => handleAction('in_progress', 'OPEN')}
                    >
                      ↩ Reopen Ticket
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
