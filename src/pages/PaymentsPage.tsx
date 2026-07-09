import React, { useState, useEffect, useCallback } from 'react';
import { paymentService, SETTLED_PAYMENT_STATUSES } from '../services/payment.service';
import { PaymentTransaction } from '../types';
import { Spinner } from '../components/ui/Spinner';
import { AlertBanner } from '../components/ui/AlertBanner';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { bookingService } from '../services/booking.service';
import { Booking } from '../types';
import { BookingWorkflowPanel } from '../components/bookings/BookingWorkflowPanel';
import { PayLaterCallModal } from '../components/payments/PayLaterCallModal';

const methodColors: Record<string, string> = {
  RAZORPAY:      'bg-blue-100 text-blue-800',
  UPI:           'bg-purple-100 text-purple-800',
  CASH:          'bg-emerald-100 text-emerald-700',
  BANK_TRANSFER: 'bg-indigo-100 text-indigo-800',
  WALLET:        'bg-cyan-100 text-cyan-800',
  PAY_LATER:     'bg-amber-100 text-amber-800',
};

const statusColors: Record<string, string> = {
  PENDING:            'bg-yellow-100 text-yellow-800',
  SUCCESS:            'bg-emerald-100 text-emerald-800',
  FAILED:             'bg-red-100 text-red-800',
  REFUNDED:           'bg-pink-100 text-pink-800',
  PARTIALLY_REFUNDED: 'bg-orange-100 text-orange-800',
  CANCELLED:          'bg-gray-100 text-gray-500 line-through',
};

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={`rounded-2xl p-4 ${color}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm font-medium mt-1">{label}</p>
      {sub && <p className="text-xs mt-0.5 opacity-70">{sub}</p>}
    </div>
  );
}

function parseDueDate(tx: PaymentTransaction): string | null {
  // 1. Prefer the structured due_collect_at field (always set for new records)
  if (tx.due_collect_at) return tx.due_collect_at.split('T')[0];
  // 2. Fallback: legacy notes-encoded due date
  const match = (tx.notes || '').match(/PAY_LATER: due (\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export function PaymentsPage() {
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [allSuccessful, setAllSuccessful] = useState<PaymentTransaction[]>([]);
  const [payLaterDue, setPayLaterDue] = useState<PaymentTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'paylater'>('all');
  const [showAll, setShowAll] = useState(false);
  const [workflowBooking, setWorkflowBooking] = useState<Booking | null>(null);
  const [callModalTx, setCallModalTx] = useState<PaymentTransaction | null>(null);
  const [callModalCustomer, setCallModalCustomer] = useState<{ id: string; name: string; mobile: string } | null>(null);

  // Mark collected / void confirmation modal
  const [actionTx, setActionTx] = useState<PaymentTransaction | null>(null);
  const [actionType, setActionType] = useState<'collect' | 'void' | null>(null);
  const [actioning, setActioning] = useState(false);

  // Stats
  const [collectedToday, setCollectedToday] = useState(0);
  const [collectedTodayAmt, setCollectedTodayAmt] = useState(0);
  const [collectedWeek, setCollectedWeekAmt] = useState(0);

  const openBookingWorkflow = async (bookingId: string) => {
    try { const b = await bookingService.getById(bookingId); setWorkflowBooking(b); } catch {}
  };

  const PER_PAGE = 20;

  const load = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: pg, per_page: PER_PAGE };
      if (statusFilter) params.status = statusFilter;
      if (methodFilter) params.method = methodFilter;
      const res = showAll
        ? await paymentService.listAll(params)
        : await paymentService.list(params);
      setTransactions(res.items || []);
      setTotal(res.total || 0);
      setPage(pg);
    } catch {
      setError('Failed to load payments.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, methodFilter, showAll]);

  const loadPayLater = async () => {
    try {
      const due = await paymentService.getPayLaterDue();
      setPayLaterDue(due);
    } catch {}
  };

  const loadCollectedStats = async () => {
    try {
      // Fetch up to 100 successful payments for stats (backend max is 100 per page).
      // Stats only need recent data; date_from = 30 days ago keeps the response small.
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const res = await paymentService.listAll({ status: 'SUCCESS', per_page: '100', date_from: thirtyDaysAgo });
      const items = res.items || [];
      setAllSuccessful(items);
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const todayItems = items.filter(t => (t.paid_at || t.created_at)?.startsWith(today));
      const weekItems = items.filter(t => (t.paid_at || t.created_at) >= weekAgo);
      setCollectedToday(todayItems.length);
      setCollectedTodayAmt(todayItems.reduce((s, t) => s + (t.amount || 0), 0));
      setCollectedWeekAmt(weekItems.reduce((s, t) => s + (t.amount || 0), 0));
    } catch {}
  };

  const refreshAll = () => { load(page); loadPayLater(); loadCollectedStats(); };

  useEffect(() => { load(1); loadPayLater(); loadCollectedStats(); }, [load]);

  // ── Action handlers ──────────────────────────────────────────────────
  const handleMarkCollected = async () => {
    if (!actionTx) return;
    setActioning(true);
    try {
      await paymentService.markCollected(actionTx.id);
      setSuccess(`${actionTx.transaction_number} marked as collected.`);
      setActionTx(null); setActionType(null);
      refreshAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to mark collected.');
    } finally {
      setActioning(false);
    }
  };

  const handleVoid = async () => {
    if (!actionTx) return;
    setActioning(true);
    try {
      await paymentService.voidPayLater(actionTx.id);
      setSuccess(`${actionTx.transaction_number} voided.`);
      setActionTx(null); setActionType(null);
      refreshAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to void.');
    } finally {
      setActioning(false);
    }
  };

  const totalPages = Math.ceil(total / PER_PAGE);
  const payLaterTotal = payLaterDue.reduce((s, t) => s + t.amount, 0);
  const overdueCount = payLaterDue.filter(t => {
    const d = parseDueDate(t);
    return d && d < new Date().toISOString().split('T')[0];
  }).length;

  const filtered = filter
    ? transactions.filter(t =>
        t.transaction_number?.toLowerCase().includes(filter.toLowerCase()) ||
        t.invoice_number?.toLowerCase().includes(filter.toLowerCase()) ||
        t.booking_number?.toLowerCase().includes(filter.toLowerCase()) ||
        t.customer_name?.toLowerCase().includes(filter.toLowerCase())
      )
    : transactions;

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <p className="text-gray-500 mt-1">Track collections, pay-later dues, and transaction history.</p>
      </div>

      {error   && <AlertBanner type="error"   message={error}   onClose={() => setError('')}   />}
      {success && <AlertBanner type="success" message={success} onClose={() => setSuccess('')} />}

      {/* Overdue alert */}
      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800 font-medium flex items-center gap-2">
          ⚠ {overdueCount} pay-later collection{overdueCount > 1 ? 's' : ''} overdue — call customers now
          <button
            onClick={() => setActiveTab('paylater')}
            className="ml-auto text-xs underline"
          >
            View →
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Collected Today"
          value={collectedToday.toString()}
          sub={`₹${collectedTodayAmt.toLocaleString('en-IN')} total`}
          color="bg-emerald-50 text-emerald-900"
        />
        <StatCard
          label="Collected This Week"
          value={`₹${collectedWeek.toLocaleString('en-IN')}`}
          sub="Last 7 days"
          color="bg-blue-50 text-blue-900"
        />
        <StatCard
          label="Pay-Later Pending"
          value={payLaterDue.length.toString()}
          sub={`₹${payLaterTotal.toLocaleString('en-IN')} total due`}
          color={payLaterDue.length > 0 ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-700'}
        />
        <StatCard
          label="Total Transactions"
          value={total.toString()}
          sub="in current view"
          color="bg-gray-50 text-gray-700"
        />
      </div>

      {/* Tabs + toggle */}
      <div className="flex items-center justify-between border-b border-gray-100">
        <div className="flex">
          {(['all', 'paylater'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition -mb-px ${
                activeTab === tab ? 'border-[#1B4FD8] text-[#1B4FD8]' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'all'
                ? 'Pending / Failed'
                : `Pay-Later Due (${payLaterDue.length})`
              }
              {tab === 'paylater' && overdueCount > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full">
                  {overdueCount}
                </span>
              )}
            </button>
          ))}
        </div>
        {activeTab === 'all' && (
          <button
            onClick={() => setShowAll(v => !v)}
            className={`mr-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              showAll
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {showAll ? '✓ All records' : 'Show all'}
          </button>
        )}
      </div>

      {/* ── ALL TRANSACTIONS TAB ── */}
      {activeTab === 'all' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex flex-wrap gap-3 p-4 border-b border-gray-50">
            <div className="flex-1 min-w-[180px]">
              <Input
                placeholder="Search transaction #, invoice, booking, customer..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="">All Status</option>
              <option value="PENDING">Pending</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
              <option value="REFUNDED">Refunded</option>
            </select>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
              value={methodFilter} onChange={e => setMethodFilter(e.target.value)}
            >
              <option value="">All Methods</option>
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="RAZORPAY">Razorpay</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="PAY_LATER">Pay Later</option>
            </select>
          </div>

          {loading ? (
            <div className="py-16"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No transactions found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Transaction</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Method</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Amount</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date / Due</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const dueDate = t.method === 'PAY_LATER' ? parseDueDate(t) : null;
                    const isOverdue = dueDate && dueDate < new Date().toISOString().split('T')[0];
                    return (
                      <tr
                        key={t.id}
                        className={`border-b border-gray-50 hover:bg-gray-50/50 ${
                          isOverdue ? 'bg-red-50/30' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">{t.transaction_number}</p>
                          <p className="text-xs text-gray-400">
                            {t.invoice_number || t.invoice_id?.slice(0, 8)}
                          </p>
                          {t.booking_number && (
                            <p className="text-xs text-gray-400">{t.booking_number}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-700">{t.customer_name || '—'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${methodColors[t.method] || 'bg-gray-100 text-gray-700'}`}>
                            {t.method?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[t.status] || 'bg-gray-100 text-gray-700'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-semibold text-gray-900">
                            ₹{t.amount?.toLocaleString('en-IN')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {t.paid_at ? (
                            <p className="text-sm text-gray-600">{new Date(t.paid_at).toLocaleDateString('en-IN')}</p>
                          ) : dueDate ? (
                            <p className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                              {isOverdue ? '⚠ Overdue ' : 'Due: '}{dueDate}
                            </p>
                          ) : (
                            <p className="text-sm text-gray-400">—</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {t.booking_id && (
                              <button
                                onClick={() => openBookingWorkflow(t.booking_id)}
                                className="text-xs text-[#1B4FD8] hover:underline font-medium"
                              >
                                📋 Open
                              </button>
                            )}
                            {/* PAY_LATER PENDING actions */}
                            {t.method === 'PAY_LATER' && t.status === 'PENDING' && (
                              <>
                                <button
                                  onClick={() => { setActionTx(t); setActionType('collect'); }}
                                  className="text-xs text-emerald-700 hover:underline font-medium"
                                >
                                  ✅ Mark Collected
                                </button>
                                <button
                                  onClick={() => { setActionTx(t); setActionType('void'); }}
                                  className="text-xs text-red-500 hover:underline font-medium"
                                >
                                  🗑 Void
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 px-5 py-4 border-t border-gray-50">
              <button onClick={() => load(page - 1)} disabled={page <= 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">← Prev</button>
              <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
              <button onClick={() => load(page + 1)} disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition">Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ── PAY-LATER TAB ── */}
      {activeTab === 'paylater' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {payLaterDue.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-emerald-600 text-sm font-medium">No pay-later dues pending</p>
            </div>
          ) : (
            <div>
              <div className="px-5 py-3 border-b border-gray-50 bg-amber-50">
                <p className="text-sm font-semibold text-amber-800">
                  {payLaterDue.length} pending collections · ₹{payLaterTotal.toLocaleString('en-IN')} total
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Call customers to collect. Use "Mark Collected" if already paid via other channel.
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {payLaterDue.map(t => {
                  const dueDate = parseDueDate(t);
                  const isOverdue = dueDate && dueDate < new Date().toISOString().split('T')[0];
                  return (
                    <div key={t.id} className={`px-5 py-4 hover:bg-gray-50/50 ${isOverdue ? 'bg-red-50/30 border-l-4 border-red-400' : ''}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900">{t.transaction_number}</p>
                            {t.customer_name && (
                              <span className="text-sm text-gray-600">{t.customer_name}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {t.invoice_number || t.invoice_id?.slice(0, 8)}
                            {t.booking_number && ` · ${t.booking_number}`}
                          </p>
                          {dueDate && (
                            <p className={`text-xs font-semibold mt-1 ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                              {isOverdue ? '⚠ Overdue since' : 'Due:'} {dueDate}
                            </p>
                          )}
                          {t.last_reminder_at && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              Last reminded: {new Date(t.last_reminder_at).toLocaleDateString('en-IN')}
                            </p>
                          )}
                          {t.booking_id && (
                            <button
                              onClick={() => openBookingWorkflow(t.booking_id)}
                              className="text-xs text-[#1B4FD8] hover:underline mt-1 font-medium"
                            >
                              📋 Open Booking →
                            </button>
                          )}
                        </div>
                        <div className="text-right flex flex-col items-end gap-2 shrink-0">
                          <p className="text-lg font-bold text-amber-700">₹{t.amount?.toLocaleString('en-IN')}</p>
                          <p className="text-xs text-gray-400">{new Date(t.created_at).toLocaleDateString('en-IN')}</p>
                          <div className="flex flex-col gap-1.5">
                            <button
                              onClick={() => {
                                setCallModalTx(t);
                                setCallModalCustomer(
                                  t.customer
                                    ? { id: (t.customer as any).id, name: (t.customer as any).name, mobile: (t.customer as any).mobile }
                                    : { id: t.booking_id, name: t.customer_name || 'Customer', mobile: '—' }
                                );
                              }}
                              className="text-xs bg-[#1B4FD8] text-white px-3 py-1.5 rounded-lg hover:bg-[#1640B0] transition font-medium"
                            >
                              📞 Call Customer
                            </button>
                            <button
                              onClick={() => { setActionTx(t); setActionType('collect'); }}
                              className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition font-medium"
                            >
                              ✅ Mark Collected
                            </button>
                            <button
                              onClick={() => { setActionTx(t); setActionType('void'); }}
                              className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition font-medium"
                            >
                              🗑 Void (Already Paid)
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Confirmation modal for Mark Collected / Void ── */}
      <Modal
        open={!!actionTx && !!actionType}
        onClose={() => { setActionTx(null); setActionType(null); }}
        title={actionType === 'collect' ? 'Mark as Collected' : 'Void PAY_LATER Transaction'}
        size="sm"
      >
        {actionTx && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
              <p><span className="font-medium">Transaction:</span> {actionTx.transaction_number}</p>
              {actionTx.invoice_number && <p><span className="font-medium">Invoice:</span> {actionTx.invoice_number}</p>}
              {actionTx.customer_name && <p><span className="font-medium">Customer:</span> {actionTx.customer_name}</p>}
              <p><span className="font-medium">Amount:</span> ₹{actionTx.amount?.toLocaleString('en-IN')}</p>
            </div>

            {actionType === 'collect' ? (
              <p className="text-sm text-gray-700">
                This will mark the PAY_LATER record as <strong>collected (SUCCESS)</strong> and update the invoice balance accordingly.
                Use this when the customer has paid via cash/UPI directly to office.
              </p>
            ) : (
              <p className="text-sm text-gray-700">
                This will <strong>void this PAY_LATER record</strong> — it will no longer appear as pending.
                Use this when payment was already collected via a separate transaction and this is a ghost/duplicate record.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => { setActionTx(null); setActionType(null); }}>
                Cancel
              </Button>
              {actionType === 'collect' ? (
                <Button variant="success" loading={actioning} onClick={handleMarkCollected}>
                  ✅ Confirm Collected
                </Button>
              ) : (
                <Button variant="danger" loading={actioning} onClick={handleVoid}>
                  🗑 Confirm Void
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {workflowBooking && (
        <BookingWorkflowPanel
          booking={workflowBooking}
          onClose={() => setWorkflowBooking(null)}
          onUpdated={() => { refreshAll(); setWorkflowBooking(null); }}
        />
      )}

      {callModalTx && callModalCustomer && (
        <PayLaterCallModal
          open={!!callModalTx}
          transaction={{
            id: callModalTx.id,
            transaction_number: callModalTx.transaction_number,
            booking_id: callModalTx.booking_id,
            invoice_id: callModalTx.invoice_id,
            amount: callModalTx.amount,
            notes: callModalTx.notes,
          }}
          customer={callModalCustomer}
          onClose={() => { setCallModalTx(null); setCallModalCustomer(null); }}
          onLogged={() => { loadPayLater(); load(page); loadCollectedStats(); }}
        />
      )}
    </div>
  );
}
