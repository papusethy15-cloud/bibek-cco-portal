import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  callbackRequestService,
  CallbackRequest,
  CallbackDetail,
  CallbackStatus,
} from '../services/callbackRequest.service';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { AlertBanner } from '../components/ui/AlertBanner';
import { Modal } from '../components/ui/Modal';

const STATUS_COLORS: Record<CallbackStatus, string> = {
  PENDING:  'bg-amber-100 text-amber-800',
  CALLED:   'bg-blue-100 text-blue-700',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  SKIPPED:  'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<CallbackStatus, string> = {
  PENDING:  '🔔 Pending',
  CALLED:   '📞 Called',
  RESOLVED: '✅ Resolved',
  SKIPPED:  '⏭ Skipped',
};

const SOURCE_LABELS: Record<string, string> = {
  CHATBOT:        '🤖 Chatbot',
  WEBSITE:        '🌐 Website',
  WEBSITE_MODAL:  '💬 Website Modal',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function CallbackRequestsPage() {
  const [items, setItems] = useState<CallbackRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const PER_PAGE = 30;

  // Detail modal
  const [selected, setSelected] = useState<CallbackRequest | null>(null);
  const [detail, setDetail] = useState<CallbackDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [savingStatus, setSavingStatus] = useState<CallbackStatus | null>(null);

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const res = await callbackRequestService.list({
        status: statusFilter || undefined,
        search: search || undefined,
        skip: (pg - 1) * PER_PAGE,
        limit: PER_PAGE,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
      setPage(pg);
    } catch {
      setError('Failed to load callback requests.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { load(1); }, [load]);

  // Auto-poll every 2 min
  useEffect(() => {
    const iv = setInterval(() => load(page), 2 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load, page]);

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setSearch(val), 400);
  };

  const openDetail = async (item: CallbackRequest) => {
    setSelected(item);
    setDetail(null);
    setAdminNotes(item.admin_notes || '');
    setLoadingDetail(true);
    try {
      const d = await callbackRequestService.getById(item.id);
      setDetail(d);
      setAdminNotes(d.admin_notes || '');
    } catch {
      setDetail(item as any);
    } finally {
      setLoadingDetail(false);
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setDetail(null);
  };

  const handleUpdateStatus = async (newStatus: CallbackStatus) => {
    if (!selected) return;
    setSavingStatus(newStatus);
    try {
      await callbackRequestService.update(selected.id, {
        status: newStatus,
        admin_notes: adminNotes,
      });
      setSuccess(`Marked as ${newStatus}.`);
      closeDetail();
      load(page);
    } catch {
      setError('Failed to update.');
    } finally {
      setSavingStatus(null);
    }
  };

  const handleSaveNotes = async () => {
    if (!selected) return;
    setSavingStatus('PENDING'); // reuse loader
    try {
      await callbackRequestService.update(selected.id, { admin_notes: adminNotes });
      setSuccess('Notes saved.');
      // refresh detail
      const d = await callbackRequestService.getById(selected.id);
      setDetail(d);
      // patch item in list
      setItems(prev => prev.map(i => i.id === selected.id ? { ...i, admin_notes: adminNotes } : i));
    } catch {
      setError('Failed to save notes.');
    } finally {
      setSavingStatus(null);
    }
  };

  const pendingCount = items.filter(i => i.status === 'PENDING').length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const displayItem = detail || selected;

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Callback Requests</h1>
          <p className="text-gray-500 mt-1">
            Leads &amp; customers who requested a call — from chatbot or website.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => load(page)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {success && <AlertBanner type="success" message={success} onClose={() => setSuccess('')} />}
      {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

      {/* Pending alert */}
      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 font-medium flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {pendingCount} pending callback{pendingCount > 1 ? 's' : ''} need{pendingCount === 1 ? 's' : ''} to be called
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        <input
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] flex-1 min-w-[160px]"
          placeholder="Search name or mobile..."
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
        />
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); }}
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="CALLED">Called</option>
          <option value="RESOLVED">Resolved</option>
          <option value="SKIPPED">Skipped</option>
        </select>
        {(statusFilter || search) && (
          <button
            onClick={() => { setStatusFilter(''); setSearch(''); setSearchInput(''); }}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {(['PENDING', 'CALLED', 'RESOLVED', 'SKIPPED'] as CallbackStatus[]).map(s => {
          const count = items.filter(i => i.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`bg-white rounded-xl border p-3 text-left transition hover:shadow-sm ${
                statusFilter === s ? 'border-[#1B4FD8] ring-1 ring-[#1B4FD8]' : 'border-gray-100'
              }`}
            >
              <p className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-block mb-1 ${STATUS_COLORS[s]}`}>
                {STATUS_LABELS[s]}
              </p>
              <p className="text-xl font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-400">on this page</p>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50 flex items-center justify-between">
          <p className="text-sm text-gray-500">{total} total callback request{total !== 1 ? 's' : ''}</p>
        </div>

        {loading ? (
          <div className="py-16"><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-3xl mb-2">📵</p>
            <p className="text-sm text-gray-400">No callback requests found.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {items.map(item => (
              <div
                key={item.id}
                onClick={() => openDetail(item)}
                className={`px-5 py-4 hover:bg-gray-50 cursor-pointer transition flex items-start justify-between gap-4 ${
                  item.status === 'PENDING' ? 'border-l-4 border-amber-400' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">
                      {item.name || 'Unknown'}
                    </p>
                    <span className="text-sm font-mono text-[#1B4FD8]">{item.mobile}</span>
                    {item.has_customer && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                        Existing customer
                      </span>
                    )}
                  </div>
                  {item.message && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-1">{item.message}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-gray-400">
                      {SOURCE_LABELS[item.source] || item.source}
                    </span>
                    {item.location && (
                      <span className="text-xs text-gray-400">📍 {item.location}</span>
                    )}
                    <span className="text-xs text-gray-400">{timeAgo(item.created_at)}</span>
                    {item.admin_notes && (
                      <span className="text-xs text-violet-600 font-medium">📝 Has notes</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[item.status]}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                  {item.called_at && (
                    <span className="text-xs text-gray-400">
                      Called: {new Date(item.called_at).toLocaleDateString('en-IN')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-4 border-t border-gray-50">
            <button
              onClick={() => load(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              ← Prev
            </button>
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <button
              onClick={() => load(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Modal
        open={!!selected}
        onClose={closeDetail}
        title={`Callback — ${selected?.name || selected?.mobile || ''}`}
        size="lg"
      >
        {selected && (
          <div className="space-y-5">
            {loadingDetail ? (
              <div className="py-8"><Spinner /></div>
            ) : (
              <>
                {/* Status badge + quick actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_COLORS[displayItem?.status as CallbackStatus || 'PENDING']}`}>
                    {STATUS_LABELS[displayItem?.status as CallbackStatus || 'PENDING']}
                  </span>
                  <span className="text-xs text-gray-400">{SOURCE_LABELS[displayItem?.source || ''] || displayItem?.source}</span>
                  <span className="text-xs text-gray-400">{displayItem?.created_at ? new Date(displayItem.created_at).toLocaleString('en-IN') : ''}</span>
                </div>

                {/* Contact info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4 space-y-1">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</p>
                    <p className="text-base font-bold text-gray-900">{displayItem?.name || '—'}</p>
                    <p className="text-sm font-mono text-[#1B4FD8]">{displayItem?.mobile}</p>
                    {displayItem?.location && (
                      <p className="text-xs text-gray-400">📍 {displayItem.location}</p>
                    )}
                  </div>

                  {/* Existing customer block */}
                  {(detail as CallbackDetail)?.customer ? (
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-1">
                      <p className="text-xs font-medium text-blue-600 uppercase tracking-wide">Existing Customer</p>
                      <p className="text-sm font-bold text-gray-900">{(detail as CallbackDetail).customer!.name}</p>
                      <p className="text-xs text-gray-500">Code: {(detail as CallbackDetail).customer!.customer_code}</p>
                      <p className="text-xs text-gray-500">{(detail as CallbackDetail).customer!.total_bookings} booking(s)</p>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-1">
                      <p className="text-xs font-medium text-amber-600 uppercase tracking-wide">Lead / New Contact</p>
                      <p className="text-xs text-gray-500">No existing customer record.</p>
                      {displayItem?.page_url && (
                        <p className="text-xs text-gray-400 break-all">🔗 {displayItem.page_url}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Message */}
                {displayItem?.message && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Customer Message</p>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 whitespace-pre-wrap">{displayItem.message}</p>
                  </div>
                )}

                {/* Last bookings */}
                {(detail as CallbackDetail)?.customer?.last_bookings?.length ? (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Recent Bookings</p>
                    <div className="space-y-1.5">
                      {(detail as CallbackDetail).customer!.last_bookings.map((b: any) => (
                        <div key={b.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                          <span className="font-mono text-gray-700">{b.booking_number}</span>
                          <span className="text-gray-500">{b.service_name}</span>
                          <span className={`px-2 py-0.5 rounded-full font-medium ${b.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                            {b.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Admin Notes */}
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">
                    CCO / Admin Notes
                  </label>
                  <textarea
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
                    rows={3}
                    placeholder="Notes from this call — what was discussed, next steps..."
                    value={adminNotes}
                    onChange={e => setAdminNotes(e.target.value)}
                  />
                  <div className="flex justify-end mt-1.5">
                    <button
                      onClick={handleSaveNotes}
                      disabled={savingStatus !== null}
                      className="text-xs text-[#1B4FD8] hover:underline disabled:opacity-50"
                    >
                      Save notes
                    </button>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="border-t pt-4">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Update Status</p>
                  <div className="flex flex-wrap gap-2">
                    {displayItem?.status !== 'CALLED' && (
                      <Button
                        size="sm"
                        loading={savingStatus === 'CALLED'}
                        onClick={() => handleUpdateStatus('CALLED')}
                      >
                        📞 Mark Called
                      </Button>
                    )}
                    {displayItem?.status !== 'RESOLVED' && (
                      <Button
                        size="sm"
                        variant="success"
                        loading={savingStatus === 'RESOLVED'}
                        onClick={() => handleUpdateStatus('RESOLVED')}
                      >
                        ✅ Mark Resolved
                      </Button>
                    )}
                    {displayItem?.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={savingStatus === 'SKIPPED'}
                        onClick={() => handleUpdateStatus('SKIPPED')}
                      >
                        ⏭ Skip
                      </Button>
                    )}
                    {(displayItem?.status === 'SKIPPED' || displayItem?.status === 'CALLED') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={savingStatus === 'PENDING'}
                        onClick={() => handleUpdateStatus('PENDING')}
                      >
                        ↩ Reopen
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
