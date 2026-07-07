/**
 * PayLaterCallModal.tsx — Pay-Later Collection Calling Workflow
 *
 * Opened from PaymentsPage when CCO clicks "Call Customer" on an overdue
 * pay-later transaction. Provides a structured flow:
 *
 * 1. Shows customer phone + transaction details at a glance
 * 2. CCO selects call outcome:
 *    - Customer will pay now  → record payment inline
 *    - Promised a new date    → capture new promised date + update notes
 *    - Not reachable          → log attempt
 *    - Refused to pay        → escalate to admin
 * 3. Auto-logs a PAYMENT_REMINDER CallLog entry for admin audit trail
 */
import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { callLogService } from '../../services/callLog.service';
import { paymentService } from '../../services/payment.service';
import api from '../../services/api';

type Outcome = 'WILL_PAY_NOW' | 'PROMISED_DATE' | 'NOT_REACHABLE' | 'REFUSED';

interface Props {
  open: boolean;
  transaction: {
    id: string;
    transaction_number: string;
    booking_id: string;
    invoice_id: string;
    amount: number;
    notes?: string;
  };
  customer: {
    id: string;
    name: string;
    mobile: string;
  };
  onClose: () => void;
  onLogged: () => void;
}

const OUTCOME_LABELS: Record<Outcome, { label: string; icon: string }> = {
  WILL_PAY_NOW:   { label: 'Customer will pay now', icon: '💳' },
  PROMISED_DATE:  { label: 'Promised a new date',   icon: '📅' },
  NOT_REACHABLE:  { label: 'Not reachable',          icon: '📵' },
  REFUSED:        { label: 'Refused to pay',         icon: '⚠️' },
};

const PAYMENT_METHODS = [
  { value: 'CASH',          label: 'Cash'          },
  { value: 'UPI',           label: 'UPI / QR'      },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'RAZORPAY',      label: 'Payment Link'  },
];

export function PayLaterCallModal({ open, transaction, customer, onClose, onLogged }: Props) {
  const [outcome, setOutcome]         = useState<Outcome | null>(null);
  const [promisedDate, setPromisedDate] = useState('');
  const [callNotes, setCallNotes]     = useState('');
  const [payMethod, setPayMethod]     = useState('CASH');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [elapsed, setElapsed]         = useState(0);

  useEffect(() => {
    if (!open) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  const fmtElapsed = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const existingDueMatch = (transaction.notes || '').match(/PAY_LATER: due (\d{4}-\d{2}-\d{2})/);
  const existingDue = existingDueMatch ? existingDueMatch[1] : null;
  const today = new Date().toISOString().split('T')[0];

  const handleSubmit = async () => {
    if (!outcome) { setError('Please select a call outcome.'); return; }
    if (outcome === 'PROMISED_DATE' && !promisedDate) {
      setError('Please enter the promised payment date.'); return;
    }
    setLoading(true); setError('');
    try {
      let summary = `Pay-later collection call. Amount: Rs.${transaction.amount?.toLocaleString('en-IN')}.`;
      if (outcome === 'WILL_PAY_NOW')   summary += ` Customer paid via ${payMethod}.`;
      if (outcome === 'PROMISED_DATE')  summary += ` Customer promised payment by ${promisedDate}.`;
      if (outcome === 'NOT_REACHABLE')  summary += ' Customer not reachable.';
      if (outcome === 'REFUSED')        summary += ' Customer refused — escalation required.';
      if (callNotes)                    summary += ` Notes: ${callNotes}`;

      await callLogService.create({
        customer_id: customer.id,
        booking_id:  transaction.booking_id,
        direction:   'OUTBOUND',
        duration_seconds: elapsed || undefined,
        outcome:     'PAYMENT_REMINDER',
        summary,
      });

      if (outcome === 'WILL_PAY_NOW') {
        await paymentService.recordPayment({
          invoice_id: transaction.invoice_id,
          booking_id: transaction.booking_id,
          method:     payMethod,
          amount:     transaction.amount,
          notes:      `Collected via CCO pay-later call. ${callNotes}`,
        });
      }

      if (outcome === 'PROMISED_DATE') {
        const newNotes = `PAY_LATER: due ${promisedDate}. Previous due: ${existingDue || 'not set'}. ${callNotes}`;
        await api.patch(`/payments/${transaction.id}/notes`, { notes: newNotes }).catch(() => {});
      }

      onLogged();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to log call. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Pay-Later Collection Call — ${transaction.transaction_number}`}
      size="md"
    >
      <div className="space-y-4">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        {/* Transaction summary + live timer */}
        <div className="bg-gray-50 rounded-xl p-4 flex items-start justify-between gap-4 border border-gray-100">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900">{customer.name}</p>
            <a
              href={`tel:${customer.mobile}`}
              className="text-sm text-[#1B4FD8] font-medium hover:underline flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {customer.mobile}
            </a>
            {existingDue && (
              <p className="text-xs text-red-600 font-medium">Original due date: {existingDue}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-gray-900">
              Rs.{transaction.amount?.toLocaleString('en-IN')}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Amount due</p>
            <div className="flex items-center gap-1.5 justify-end mt-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs font-mono font-semibold text-emerald-700">{fmtElapsed(elapsed)}</span>
            </div>
          </div>
        </div>

        {/* Outcome buttons */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">Call outcome *</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(OUTCOME_LABELS) as [Outcome, { label: string; icon: string }][]).map(([key, { label, icon }]) => (
              <button
                key={key}
                onClick={() => setOutcome(key)}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm font-medium transition ${
                  outcome === key
                    ? 'border-[#1B4FD8] bg-blue-50 text-[#1B4FD8]'
                    : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="block text-base mb-0.5">{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Promised date */}
        {outcome === 'PROMISED_DATE' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Promised payment date *</label>
            <input
              type="date" min={today}
              value={promisedDate}
              onChange={(e) => setPromisedDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            />
          </div>
        )}

        {/* Payment method if paying now */}
        {outcome === 'WILL_PAY_NOW' && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Payment method *</label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setPayMethod(m.value)}
                  className={`text-sm px-3 py-2 rounded-lg border font-medium transition ${
                    payMethod === m.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {outcome === 'REFUSED' && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-800">
            This will log the refusal. After logging, consider raising an escalation ticket to admin for further action.
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
          <textarea
            rows={2}
            placeholder="Any context from this call..."
            value={callNotes}
            onChange={(e) => setCallNotes(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={loading}
            disabled={!outcome}
            onClick={handleSubmit}
            variant={outcome === 'WILL_PAY_NOW' ? 'success' : 'primary'}
          >
            {outcome === 'WILL_PAY_NOW' ? 'Record Payment & Log Call' : 'Log Call'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
