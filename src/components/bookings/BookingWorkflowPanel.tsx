/**
 * BookingWorkflowPanel.tsx — CCO Booking Work Management
 *
 * Mirrors the admin BookingWorkflow panel, adapted for CCO role:
 * - Full workflow stepper (Assigned → Closed)
 * - Stage-aware action buttons (accept, arrived, inspect, work, invoice, payment, close)
 * - Quotation approve/reject, invoice generation, payment collection
 * - Status timeline, quotation panel, invoice panel, payment panel
 * - Reschedule + assign technician support
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Booking } from '../../types';
import { bookingActionsService } from '../../services/booking.service';
import { quotationService, Quotation } from '../../services/quotation.service';
import { invoiceService, Invoice } from '../../services/invoice.service';
import { paymentService } from '../../services/payment.service';
import { technicianService } from '../../services/technician.service';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { RescheduleModal } from './RescheduleModal';
import { AssignTechModal } from './AssignTechModal';
import { useBookingWebSocket } from '../../hooks/useCCOWebSocket';
import api from '../../services/api';
import CloudinaryImageUploader from '../ui/CloudinaryImageUploader';
import { escalationService } from '../../services/escalation.service';
import { callLogService } from '../../services/callLog.service';
import CcoQuotationModal from './CcoQuotationModal';

// ─── helpers ────────────────────────────────────────────────────
const money = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

/** Extract human-readable error from Axios error.
 *  Handles FastAPI HTTPException (detail: string)
 *  and Pydantic 422 validation errors (detail: array). */
const extractApiError = (ex: any, fallback = 'Request failed'): string => {
  const d = ex?.response?.data?.detail;
  if (!d) return fallback;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d.map((e: any) => {
      const field = Array.isArray(e.loc) ? e.loc.join(' → ') : String(e.loc || '');
      return field ? `${field}: ${e.msg}` : e.msg;
    }).join('; ');
  }
  return fallback;
};
const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDT   = (d: string) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// ─── Status config ───────────────────────────────────────────────
const STATUS_ORDER = [
  'PENDING','CONFIRMED','ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED',
  'INSPECTING','QUOTATION_APPROVED','IN_PROGRESS','COMPLETED','INVOICE_GENERATED','PAYMENT_PENDING',
  'PAID','PENDING_VERIFICATION','CLOSED',
];
const STATUS_LABEL: Record<string,string> = {
  PENDING:'Pending', CONFIRMED:'Confirmed', ASSIGNED:'Assigned',
  ACCEPTED:'Accepted', EN_ROUTE:'On the Way', ARRIVED:'Arrived',
  INSPECTING:'Inspecting', IN_PROGRESS:'Work in Progress',
  WORK_STARTED:'Work Started', WORK_PAUSED:'Work Paused',
  COMPLETED:'Work Done', INVOICE_GENERATED:'Invoice Ready',
  PAYMENT_PENDING:'Payment Pending', PAID:'Fully Paid',
  CLOSED:'Closed & Settled', SETTLED:'Settled',
  PENDING_VERIFICATION:'Awaiting Verification',
  CANCELLED:'Cancelled', RESCHEDULED:'Rescheduled',
  QUOTATION_APPROVED:'Quotation Approved',
  CANCELLATION_REQUESTED:'Cancel Requested',
};
const STATUS_COLOR: Record<string,string> = {
  PENDING:'#F59E0B', CONFIRMED:'#3B82F6', ASSIGNED:'#8B5CF6',
  ACCEPTED:'#6366F1', EN_ROUTE:'#0EA5E9', ARRIVED:'#06B6D4',
  INSPECTING:'#F97316', QUOTATION_APPROVED:'#059669', IN_PROGRESS:'#10B981', WORK_STARTED:'#10B981',
  WORK_PAUSED:'#F97316', COMPLETED:'#22C55E', INVOICE_GENERATED:'#7C3AED',
  PAYMENT_PENDING:'#EF4444', PAID:'#059669', CLOSED:'#374151',
  CANCELLED:'#DC2626', RESCHEDULED:'#F59E0B', PENDING_VERIFICATION:'#7C3AED',
};

const WORKFLOW_STEPS = [
  { key:'ASSIGNED',           icon:'📋', label:'Assigned to Technician' },
  { key:'ACCEPTED',           icon:'✅', label:'Technician Accepted'    },
  { key:'EN_ROUTE',           icon:'🚗', label:'On the Way'            },
  { key:'ARRIVED',            icon:'📍', label:'Arrived at Customer'   },
  { key:'INSPECTING',         icon:'🔍', label:'Inspection Started'    },
  { key:'QUOTATION_APPROVED',  icon:'✅', label:'Quotation Approved'    },
  { key:'IN_PROGRESS',        icon:'🔧', label:'Work in Progress'      },
  { key:'COMPLETED',          icon:'🏁', label:'Work Completed'        },
  { key:'INVOICE_GENERATED',  icon:'📄', label:'Invoice Generated'     },
  { key:'PAID',               icon:'💰', label:'Payment Collected'     },
  { key:'PENDING_VERIFICATION',icon:'🔍',label:'Awaiting Verification' },
  { key:'CLOSED',             icon:'🔒', label:'Settled & Closed'      },
];

const PAYMENT_METHODS = [
  { value:'CASH',          label:'💵 Cash',          desc:'Collect cash from customer' },
  { value:'UPI',           label:'📱 UPI / QR',       desc:'Generate QR for customer to scan' },
  { value:'BANK_TRANSFER', label:'🏦 Bank Transfer',  desc:'Record UTR / NEFT reference' },
  { value:'RAZORPAY',      label:'🔗 Payment Link',   desc:'Send Razorpay link to customer' },
  { value:'PAY_LATER',     label:'⏰ Pay Later',       desc:'Schedule collection for later date' },
];

// ─── Props ───────────────────────────────────────────────────────
interface Props {
  booking: Booking;
  onClose: () => void;
  onUpdated: () => void;
}

// ─── Main Component ──────────────────────────────────────────────
export function BookingWorkflowPanel({ booking: initBooking, onClose, onUpdated }: Props) {
  const [booking,    setBooking]    = useState<any>(initBooking);
  const [timeline,   setTimeline]   = useState<any[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [invoices,   setInvoices]   = useState<Invoice[]>([]);
  const [payments,   setPayments]   = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [acting,     setActing]     = useState(false);
  const [err,        setErr]        = useState('');
  const [ok,         setOk]         = useState('');

  // Modals
  const [showReschedule, setShowReschedule] = useState(false);
  const [showAssign,     setShowAssign]     = useState(false);
  const [showCancel,     setShowCancel]     = useState(false);
  const [cancelReason,   setCancelReason]   = useState('');
  const [cancelling,     setCancelling]     = useState(false);

  // Invoice form
  const [showInvoiceForm,     setShowInvoiceForm]     = useState(false);
  const [invTargetQuotation,  setInvTargetQuotation]  = useState<Quotation | null>(null);
  const [invNotes,            setInvNotes]            = useState('');
  const [invSaving,           setInvSaving]           = useState(false);
  const [invErr,              setInvErr]              = useState('');

  // Reject quotation
  const [rejectingQ,    setRejectingQ]    = useState<Quotation | null>(null);
  const [rejectReason,  setRejectReason]  = useState('');
  const [rejecting,     setRejecting]     = useState(false);
  const [rejectErr,     setRejectErr]     = useState('');

  // Payment form
  const [showPayForm,     setShowPayForm]     = useState(false);
  const [payTargetInv,    setPayTargetInv]    = useState<Invoice | null>(null);
  const [payMethod,       setPayMethod]       = useState('CASH');
  const [payAmount,       setPayAmount]       = useState('');
  const [payRef,          setPayRef]          = useState('');
  const [payNotes,        setPayNotes]        = useState('');
  const [payDue,          setPayDue]          = useState('');
  const [payQR,           setPayQR]           = useState('');
  const [payLink,         setPayLink]         = useState('');
  const [paySaving,       setPaySaving]       = useState(false);
  const [payErr,          setPayErr]          = useState('');

  // ── CCO Inspection submission ───────────────────────────────
  const [showInspForm, setShowInspForm]   = useState(false);
  const [inspNotes, setInspNotes]         = useState('');
  const [inspPhotos, setInspPhotos]       = useState<string[]>([]);
  const [inspSaving, setInspSaving]       = useState(false);
  const [inspErr, setInspErr]             = useState('');

  // Escalation (raise ticket)
  const [showEscalation,    setShowEscalation]    = useState(false);
  const [escSubject,        setEscSubject]         = useState('');
  const [escDesc,           setEscDesc]            = useState('');
  const [escPriority,       setEscPriority]        = useState('MEDIUM');
  const [escSaving,         setEscSaving]          = useState(false);
  const [escErr,            setEscErr]             = useState('');

  // Slot overdue detection
  const [slotOverdue, setSlotOverdue] = useState(false);

  // CCO Action mode — advance status on behalf of technician with mandatory note
  const [ccoMode, setCcoMode]               = useState(false);
  const [ccoActionPending, setCcoActionPending] = useState<{ action: keyof typeof bookingActionsService; label: string } | null>(null);
  const [ccoNote, setCcoNote]               = useState('');
  const [ccoActing, setCcoActing]           = useState(false);
  const [techCallLogging, setTechCallLogging] = useState(false);

  // Invoice form — GST fields (admin-parity)
  const [invGstin,          setInvGstin]          = useState('');
  const [invBusinessName,   setInvBusinessName]   = useState('');
  const [invBusinessAddr,   setInvBusinessAddr]   = useState('');
  const [invTaxMode,        setInvTaxMode]        = useState('');

  // Settle & Close
  const [showSettle,        setShowSettle]        = useState(false);
  const [settlePreview,     setSettlePreview]     = useState<any>(null);
  const [settleLoading,     setSettleLoading]     = useState(false);
  const [settleOverrides,   setSettleOverrides]   = useState<Record<number,string>>({});
  const [settleNotes,       setSettleNotes]       = useState('');
  const [settling,          setSettling]          = useState(false);
  const [settleErr,         setSettleErr]         = useState('');

  // Quotation management modal
  const [showQuotationModal, setShowQuotationModal] = useState(false);

  // Quotation approval confirm modal — shows full line-item detail before CCO approves
  const [approveTarget,   setApproveTarget]   = useState<any | null>(null); // full quotation detail
  const [approveFetching, setApproveFetching] = useState(false);
  const [approveErr,      setApproveErr]      = useState('');
  const [approving,       setApproving]       = useState(false);

  // Platform Loss Inspection
  const [showLoss,          setShowLoss]          = useState(false);

  // Check if booking slot is breached (today's booking, active status, slot start > 30min ago)
  useEffect(() => {
    // Use local (IST) date — toISOString() gives UTC and is wrong after 18:30 IST
    const _n = new Date();
    const today = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
    // Normalise scheduled_date (may come as "2026-07-10T00:00:00" from some responses)
    const schedDate = (initBooking.scheduled_date || '').split('T')[0];
    if (schedDate !== today) { setSlotOverdue(false); return; }
    if (!['PENDING','CONFIRMED','ASSIGNED','ACCEPTED'].includes(initBooking.status)) { setSlotOverdue(false); return; }
    if (!initBooking.scheduled_slot) { setSlotOverdue(false); return; }
    const [h, m] = initBooking.scheduled_slot.split(':').map(Number);
    const slotStartMin = h * 60 + m;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    setSlotOverdue(nowMin > slotStartMin + 30);
  }, [initBooking]);

  // Call technician + auto-log action
  const callTechnicianReminder = async () => {
    if (!booking?.technician_id || !booking?.technician?.mobile) return;
    setTechCallLogging(true);
    try {
      // Log an outbound call to indicate CCO reminded technician
      await callLogService.create({
        customer_id: booking.customer_id || (booking.customer as any)?.id || '',
        booking_id: booking.id,
        direction: 'OUTBOUND',
        outcome: 'OTHER',
        summary: `CCO called technician ${booking.technician?.name} (${booking.technician?.mobile}) to remind about overdue slot ${booking.scheduled_slot} for booking ${booking.booking_number}.`,
      });
      setOk(`✅ Reminder logged. Call technician: ${booking.technician?.mobile}`);
    } catch {
      setOk(`📞 Call technician: ${booking.technician?.mobile}`);
    } finally { setTechCallLogging(false); }
  };

  // ── Load all data ──────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setErr(''); setOk('');
    try {
      const [bRes, tRes, qRes, iRes, pRes] = await Promise.allSettled([
        api.get(`/bookings/${initBooking.id}`),
        bookingActionsService.timeline(initBooking.id),
        api.get(`/quotations?booking_id=${initBooking.id}&per_page=50`),
        api.get(`/invoices?booking_id=${initBooking.id}&per_page=20`),
        api.get(`/payments/history?booking_id=${initBooking.id}&per_page=50`),
      ]);

      if (bRes.status === 'fulfilled') setBooking((bRes.value as any).data.data);
      if (tRes.status === 'fulfilled') setTimeline((tRes.value as any).data.data || []);
      if (qRes.status === 'fulfilled') setQuotations((qRes.value as any).data.data?.items || []);
      if (iRes.status === 'fulfilled') {
        const d = (iRes.value as any).data.data;
        setInvoices(d?.items || d || []);
      }
      if (pRes.status === 'fulfilled') setPayments((pRes.value as any).data.data?.items || []);
    } catch (ex: any) {
      setErr('Failed to load booking data.');
    } finally { setLoading(false); }
  }, [initBooking.id]);

  useEffect(() => { load(); }, [load]);

  // ── Real-time sync via WebSocket (admin-parity) ────────────────
  const currentUserId = (window as any).__cco_user_id__ || '';
  const { lastEvent: wsEvent } = useBookingWebSocket(initBooking.id);
  useEffect(() => {
    if (!wsEvent) return;
    const isQuotation   = ['QUOTATION_CREATED','QUOTATION_UPDATED','QUOTATION_DELETED'].includes(wsEvent.type);
    const isBooking     = wsEvent.type === 'BOOKING_STATUS_CHANGED';
    const isInspection  = wsEvent.type === 'INSPECTION_SUBMITTED';
    if (!isQuotation && !isBooking && !isInspection) return;
    // Skip own actions (we already reload after every button click)
    const actorId = wsEvent.payload?.actor_user_id;
    if (actorId && currentUserId && actorId === currentUserId) return;
    load(); // silent refresh
  }, [wsEvent]);

  // ── Derived state ──────────────────────────────────────────────
  const status    = booking?.status || 'PENDING';
  const statusIdx = STATUS_ORDER.indexOf(status);
  const noTech    = !booking?.technician_id;

  const approvedQuotations = quotations.filter(q => q.status === 'APPROVED');
  const hasAnyApproved     = approvedQuotations.length > 0;
  const allRepairsDone     = quotations.length > 0 && approvedQuotations.length === 0;

  const invoiceByQId: Record<string, Invoice> = {};
  invoices.forEach(inv => { if ((inv as any).quotation_id) invoiceByQId[(inv as any).quotation_id] = inv; });

  // ── Authoritative balance: use server-computed balance_amount from invoice ──────────────────
  // DO NOT sum SUCCESS payment transactions for balance — the DB may contain legacy duplicate
  // records. The backend's _apply_invoice_payment_state() is the single source of truth.
  const balanceByInvId: Record<string, number> = {};
  invoices.forEach(inv => {
    // Prefer server balance_amount; fall back to total_amount if not yet set (e.g. brand-new invoice)
    const serverBalance = (inv as any).balance_amount;
    balanceByInvId[inv.id] = Math.max(
      serverBalance !== undefined && serverBalance !== null
        ? serverBalance
        : (inv.total_amount || 0),
      0
    );
  });

  const totalInvoiced   = invoices.reduce((s, inv) => s + (inv.total_amount || 0), 0);
  const totalOutstanding = Object.values(balanceByInvId).reduce((s,v) => s+v, 0);
  // totalPaid derived from invoiced - outstanding (avoids double-counting duplicate DB transactions)
  const totalPaid       = Math.max(totalInvoiced - totalOutstanding, 0);

  // Keep paidByInvId for per-invoice paid display (audit trail only — not used for balance logic)
  const paidByInvId: Record<string, number> = {};
  payments.filter(p => p.status === 'SUCCESS').forEach(p => {
    if (p.invoice_id) paidByInvId[p.invoice_id] = (paidByInvId[p.invoice_id] || 0) + (p.amount || 0);
  });
  const hasInvoice      = invoices.length > 0;

  // ── Pay Later derived state ──────────────────────────────────────────────
  // Pending PAY_LATER transactions — deferred collections not yet converted to real payment.
  const payLaterPending = payments.filter(
    (p: any) => (p.method === 'PAY_LATER' || p.reference_number === 'PAY_LATER') && p.status === 'PENDING'
  );
  const hasPayLaterPending = payLaterPending.length > 0;
  // Earliest due date across pending Pay Later records
  const payLaterEarliestDue: string | null = payLaterPending
    .map((p: any) => p.due_collect_at as string | null)
    .filter(Boolean)
    .sort()[0] || null;

  // Platform loss inspection derived values (admin-parity)
  const invoicedQuotations = quotations.filter(q => (q as any).status === 'CONVERTED_TO_INVOICE');
  const totalMarketCost    = invoicedQuotations.reduce((s, q) => s + ((q as any).parts_total || 0), 0);
  const totalDiscount      = invoicedQuotations.reduce((s, q) => s + ((q as any).discount_amount || 0) + ((q as any).coupon_discount || 0), 0);
  const platformRisk       = totalMarketCost + totalDiscount + totalOutstanding;

  // ── CCO-mode transition (with mandatory audit note) ─────────────
  const executeCcoTransition = async () => {
    if (!ccoActionPending) return;
    if (!ccoNote.trim()) { setErr('CCO Action mode requires a note explaining why you are advancing this status.'); return; }
    setCcoActing(true); setErr(''); setOk('');
    try {
      await (bookingActionsService[ccoActionPending.action] as (id: string) => Promise<any>)(booking.id);
      // Log audit note to call log
      await callLogService.create({
        customer_id: booking.customer_id || booking.customer?.id,
        booking_id: booking.id,
        direction: 'OUTBOUND',
        outcome: 'OTHER',
        summary: `CCO advanced booking to ${ccoActionPending.label} on behalf of technician. Reason: ${ccoNote}`,
      }).catch(() => {}); // non-fatal
      setOk(`✅ ${ccoActionPending.label} (CCO action logged)`);
      setCcoActionPending(null);
      setCcoNote('');
      await load(); onUpdated();
    } catch (ex: any) {
      setErr(extractApiError(ex, `Failed: ${ccoActionPending.label}`));
    } finally { setCcoActing(false); }
  };

  // ── Transition helper ──────────────────────────────────────────
  const transition = async (action: keyof typeof bookingActionsService, label: string) => {
    // In CCO Action mode — intercept and require a note
    if (ccoMode) {
      setCcoActionPending({ action, label });
      setCcoNote('');
      return;
    }
    setActing(true); setErr(''); setOk('');
    try {
      await (bookingActionsService[action] as (id: string) => Promise<any>)(booking.id);
      setOk(`✅ ${label}`);
      await load(); onUpdated();
    } catch (ex: any) {
      setErr(extractApiError(ex, `Failed: ${label}`));
    } finally { setActing(false); }
  };

  // ── CCO Inspection Submit ──────────────────────────────────
  const submitInspection = async () => {
    if (!inspNotes.trim()) { setInspErr('Inspection findings are required'); return; }
    setInspSaving(true); setInspErr('');
    try {
      await api.post(`/bookings/${booking.id}/submit-inspection`, {
        notes: inspNotes.trim(),
        photo_urls: inspPhotos,
      });
      setOk('✅ Inspection submitted — work started');
      setShowInspForm(false);
      setInspNotes(''); setInspPhotos([]);
      await load(); onUpdated();
    } catch (ex: any) {
      setInspErr(extractApiError(ex, 'Failed to submit inspection'));
    } finally { setInspSaving(false); }
  };

  // ── Cancel ────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!cancelReason.trim()) { setErr('Enter cancellation reason'); return; }
    setCancelling(true);
    try {
      await bookingActionsService.cancel(booking.id, cancelReason);
      setOk('✅ Booking cancelled');
      setShowCancel(false);
      await load(); onUpdated();
    } catch (ex: any) {
      setErr(extractApiError(ex, 'Failed to cancel'));
    } finally { setCancelling(false); }
  };

  // ── Invoice create ─────────────────────────────────────────────
  const openInvoiceForm = (q: Quotation) => {
    setInvTargetQuotation(q);
    setInvNotes('');
    setInvErr('');
    // Carry over GST/tax fields from quotation (admin-parity)
    setInvGstin((q as any).customer_gst_number || '');
    setInvBusinessName((q as any).customer_gst_name || '');
    setInvBusinessAddr((q as any).customer_gst_address || '');
    const mode = ((q as any).tax_mode || 'B2C').toUpperCase();
    setInvTaxMode(mode === 'NONE' ? 'NON_GST' : mode === 'B2B' ? 'GST_B2B' : 'GST_B2C');
    setShowInvoiceForm(true);
  };

  const createInvoice = async () => {
    if (!invTargetQuotation) return;
    setInvSaving(true); setInvErr('');
    try {
      await invoiceService.generate(
        booking.id,
        invTargetQuotation.id,
        invTaxMode || 'GST_B2C',
        invGstin || undefined,
        invBusinessName || undefined,
        invBusinessAddr || undefined,
        invNotes || undefined,
      );
      setShowInvoiceForm(false);
      setInvTargetQuotation(null);
      setOk('✅ Invoice generated');
      await load(); onUpdated();
    } catch (ex: any) {
      setInvErr(extractApiError(ex, 'Failed to generate invoice'));
    } finally { setInvSaving(false); }
  };

  // ── Reject quotation ───────────────────────────────────────────
  const rejectQuotation = async () => {
    if (!rejectingQ || !rejectReason.trim()) { setRejectErr('Reason required'); return; }
    setRejecting(true); setRejectErr('');
    try {
      await quotationService.reject(rejectingQ.id, rejectReason);
      setOk(`✅ Quotation ${rejectingQ.quotation_number} rejected`);
      setRejectingQ(null); setRejectReason('');
      await load(); onUpdated();
    } catch (ex: any) {
      setRejectErr(extractApiError(ex, 'Rejection failed'));
    } finally { setRejecting(false); }
  };

  // ── Approve quotation — step 1: fetch full detail, show confirm modal ──
  const approveQuotation = async (q: Quotation) => {
    setApproveFetching(true); setErr('');
    try {
      const res = await quotationService.get(q.id);
      const detail = (res as any).data?.data ?? (res as any).data ?? q;
      setApproveTarget(detail);
      setApproveErr('');
    } catch (ex: any) {
      setErr(extractApiError(ex, 'Failed to load quotation details'));
    } finally { setApproveFetching(false); }
  };

  // ── Approve quotation — step 2: confirmed, call API ──────────────
  const confirmApprove = async () => {
    if (!approveTarget) return;
    setApproving(true); setApproveErr('');
    try {
      await quotationService.approve(approveTarget.id);
      setOk('✅ Quotation approved');
      setApproveTarget(null);
      await load(); onUpdated();
    } catch (ex: any) {
      setApproveErr(extractApiError(ex, 'Approval failed — please retry'));
    } finally { setApproving(false); }
  };

  // ── Payment submit ─────────────────────────────────────────────
  const openPayForm = (inv: Invoice) => {
    setPayTargetInv(inv);
    setPayAmount((balanceByInvId[inv.id] || 0).toFixed(2));
    setPayMethod('CASH'); setPayRef(''); setPayNotes('');
    setPayDue(''); setPayQR(''); setPayLink(''); setPayErr('');
    setShowPayForm(true);
  };

  const submitPayment = async () => {
    if (!payTargetInv) return;
    const bal = balanceByInvId[payTargetInv.id] || 0;

    if (payMethod === 'PAY_LATER') {
      if (!payDue) { setPayErr('Select collection date'); return; }
      setPaySaving(true); setPayErr('');
      try {
        // Convert date string (YYYY-MM-DD) to ISO datetime (end-of-day UTC)
        const dueDateTime = new Date(`${payDue}T23:59:00`).toISOString();
        await api.post('/payments/cash', {
          invoice_id: payTargetInv.id,
          amount: bal,
          is_pay_later: true,
          due_collect_at: dueDateTime,
          notes: payNotes || undefined,
          on_behalf_technician_id: booking?.technician_id || undefined,
        });
        setOk(`✅ Pay Later scheduled for ${payDue}`);
        setShowPayForm(false);
        await load(); onUpdated();
      } catch (ex: any) { setPayErr(extractApiError(ex, 'Failed')); }
      finally { setPaySaving(false); }
      return;
    }

    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) { setPayErr('Enter a valid amount'); return; }
    if (amt > bal + 0.01)        { setPayErr(`Amount exceeds balance ${money(bal)}`); return; }

    setPaySaving(true); setPayErr(''); setPayQR(''); setPayLink('');
    const base = {
      invoice_id: payTargetInv.id, amount: amt,
      notes: payNotes || undefined,
      on_behalf_technician_id: booking?.technician_id || undefined,
    };
    try {
      if (payMethod === 'CASH') {
        await api.post('/payments/cash', { ...base, reference_number: payRef || undefined });
        setOk(`✅ Cash payment ${money(amt)} recorded`); setShowPayForm(false);
      } else if (payMethod === 'BANK_TRANSFER') {
        if (!payRef) { setPayErr('UTR / Reference required'); setPaySaving(false); return; }
        await api.post('/payments/bank-transfer', { ...base, reference_number: payRef });
        setOk(`✅ Bank transfer ${money(amt)} recorded`); setShowPayForm(false);
      } else if (payMethod === 'UPI') {
        const r = await api.post('/payments/generate-qr', base);
        setPayQR((r as any).data?.data?.qr_payload || '');
        setOk('✅ UPI QR generated — show to customer');
      } else if (payMethod === 'RAZORPAY') {
        const r = await api.post('/payments/generate-link', base);
        setPayLink((r as any).data?.data?.payment_link || '');
        setOk('✅ Payment link generated');
      }
      await load(); onUpdated();
    } catch (ex: any) { setPayErr(extractApiError(ex, 'Payment failed')); }
    finally { setPaySaving(false); }
  };

  // ── Raise escalation ──────────────────────────────────────────
  const submitEscalation = async () => {
    if (!escSubject.trim() || !escDesc.trim()) { setEscErr('Subject and description are required'); return; }
    setEscSaving(true); setEscErr('');
    try {
      await escalationService.create({
        subject: escSubject,
        description: escDesc,
        priority: escPriority,
        booking_id: booking.id,
      });
      setOk('✅ Ticket raised and sent to admin');
      setShowEscalation(false);
      setEscSubject(''); setEscDesc(''); setEscPriority('MEDIUM');
    } catch (ex: any) {
      setEscErr(extractApiError(ex, 'Failed to raise ticket'));
    } finally { setEscSaving(false); }
  };

  // ─── RENDER ────────────────────────────────────────────────────
  const canCancel = !['COMPLETED','CANCELLED','PAID','CLOSED','SETTLED','INVOICE_GENERATED','CANCELLATION_REQUESTED'].includes(status);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-50 w-full max-w-5xl h-screen bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900 font-mono">{booking.booking_number}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${STATUS_COLOR[status]}20`, color: STATUS_COLOR[status] }}
                >
                  {STATUS_LABEL[status] || status}
                </span>
                {booking.source && (
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {booking.source.replace(/_/g,' ')}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAssign(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition"
            >
              {booking.technician_id ? '🔄 Reassign' : '👷 Assign Tech'}
            </button>
            <button
              onClick={() => setShowReschedule(true)}
              disabled={['COMPLETED','CANCELLED','PAID','CLOSED','SETTLED'].includes(status)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition disabled:opacity-40"
            >
              📅 Reschedule
            </button>
            {/* CCO Action mode toggle */}
            <button
              onClick={() => { setCcoMode(v => !v); setCcoActionPending(null); setCcoNote(''); setErr(''); }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border-2 transition ${ccoMode ? 'border-orange-500 bg-orange-50 text-orange-700 animate-pulse' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              title="CCO Action mode: advance booking status on behalf of technician with mandatory audit note"
            >
              {ccoMode ? '🔴 CCO Mode ON' : '🟡 CCO Mode'}
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition ml-1">
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center"><Spinner /></div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="flex gap-0 h-full">

              {/* ══ LEFT COLUMN — Customer info + Stepper + Actions ══ */}
              <div className="w-72 shrink-0 border-r border-gray-100 flex flex-col overflow-y-auto bg-gray-50/50">
                <div className="p-4 space-y-4">

                  {/* Alerts */}
                  {ok && <AlertBanner type="success" message={ok} onClose={() => setOk('')} />}
                  {err && <AlertBanner type="error" message={err} onClose={() => setErr('')} />}

                  {/* ── CCO Action mode banner + confirmation ── */}
                  {ccoMode && !ccoActionPending && (
                    <div className="bg-orange-50 border-2 border-orange-400 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <svg className="w-4 h-4 text-orange-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        <p className="text-xs font-bold text-orange-800">CCO Action Mode Active</p>
                      </div>
                      <p className="text-xs text-orange-700">Clicking any status action will require you to enter an audit note before it is executed. This is logged to admin.</p>
                      <button
                        onClick={() => { setCcoMode(false); setCcoNote(''); setCcoActionPending(null); }}
                        className="mt-2 text-xs text-orange-700 underline hover:text-orange-900"
                      >
                        Turn off CCO mode
                      </button>
                    </div>
                  )}

                  {/* ── CCO Action confirmation dialog ── */}
                  {ccoActionPending && (
                    <div className="bg-orange-50 border-2 border-orange-500 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        <p className="text-xs font-bold text-orange-800">Confirm CCO Action: <span className="text-orange-900">{ccoActionPending.label}</span></p>
                      </div>
                      <p className="text-xs text-orange-700">You are advancing this booking on behalf of the technician. Provide a mandatory reason — this is audit-logged.</p>
                      <textarea
                        className="w-full border-2 border-orange-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none bg-white"
                        rows={3}
                        placeholder="e.g. Technician confirmed arrival via phone call at 10:45 AM..."
                        value={ccoNote}
                        onChange={e => setCcoNote(e.target.value)}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={executeCcoTransition}
                          disabled={ccoActing || !ccoNote.trim()}
                          className="flex-1 py-2 text-xs rounded-lg bg-orange-600 text-white hover:bg-orange-700 font-bold disabled:opacity-50 transition"
                        >
                          {ccoActing ? '⏳ Executing...' : '✅ Confirm & Log'}
                        </button>
                        <button
                          onClick={() => { setCcoActionPending(null); setCcoNote(''); }}
                          className="px-3 py-2 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Slot overdue alert */}
                  {slotOverdue && (
                    <div className="bg-red-50 border border-red-300 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-4 h-4 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs font-bold text-red-800">⚠ Slot overdue — {booking.scheduled_slot}</p>
                      </div>
                      <p className="text-xs text-red-700 mb-2">Technician has not reached customer. Action required.</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {booking.technician?.mobile && (
                          <a
                            href={`tel:${booking.technician.mobile}`}
                            onClick={callTechnicianReminder}
                            className="flex-1 text-center py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium"
                          >
                            📞 Call Technician
                          </a>
                        )}
                        <button
                          onClick={() => setShowReschedule(true)}
                          className="flex-1 py-1.5 text-xs rounded-lg bg-white border border-red-300 text-red-700 hover:bg-red-50 font-medium"
                        >
                          📅 Reschedule
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Booking info card */}
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-1.5">
                    <p className="text-sm font-semibold text-gray-900">{booking.customer?.name || booking.customer_name || '—'}</p>
                    {(booking.customer?.mobile || booking.customer_mobile) && (
                      <a href={`tel:${booking.customer?.mobile || booking.customer_mobile}`} className="text-sm text-[#1B4FD8] flex items-center gap-1">
                        📞 {booking.customer?.mobile || booking.customer_mobile}
                      </a>
                    )}
                    <p className="text-xs text-gray-500">🔧 {booking.service_name || '—'}</p>
                    <p className="text-xs text-gray-500">📅 {fmtDate(booking.scheduled_date)} · {booking.scheduled_slot || 'No slot'}</p>
                    {booking.appliance_brand && (
                      <p className="text-xs text-gray-400">{booking.appliance_brand} {booking.appliance_model}</p>
                    )}
                    {(booking.address_line || booking.city) && (
                      <p className="text-xs text-gray-400 truncate">📍 {[booking.address_line, booking.city].filter(Boolean).join(', ')}</p>
                    )}
                    {booking.technician && (
                      <div className="pt-1 border-t border-blue-100">
                        <p className="text-xs text-gray-500">👷 {booking.technician.name}</p>
                        <a href={`tel:${booking.technician.mobile}`} className="text-xs text-[#1B4FD8]">{booking.technician.mobile}</a>
                      </div>
                    )}
                  </div>

                  {/* Workflow Stepper */}
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Workflow Progress</p>
                    {WORKFLOW_STEPS.map((step, i, arr) => {
                      const stepIdx = STATUS_ORDER.indexOf(step.key);
                      const isPast   = stepIdx < statusIdx;
                      const isActive = step.key === status;
                      // Special: PAID step has a Pay Later pending indicator when payment is deferred
                      const isPayLaterStep = step.key === 'PAID' && !isPast && !isActive && hasPayLaterPending;
                      const color    = isPayLaterStep ? '#B45309' : (STATUS_COLOR[step.key] || '#94A3B8');
                      return (
                        <div key={step.key} className="flex gap-2.5">
                          <div className="flex flex-col items-center w-6">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0"
                              style={{
                                background: isPast ? color : isActive ? `${color}20` : isPayLaterStep ? '#FEF3C7' : '#F1F5F9',
                                border: isActive ? `2px solid ${color}` : isPayLaterStep ? `2px dashed #B45309` : 'none',
                                color: isPast ? 'white' : isActive ? color : isPayLaterStep ? '#B45309' : '#94A3B8',
                                boxShadow: isActive ? `0 0 0 3px ${color}30` : 'none',
                              }}
                            >
                              {isPast ? '✓' : isPayLaterStep ? '⏰' : step.icon}
                            </div>
                            {i < arr.length - 1 && (
                              <div className="w-0.5 flex-1 min-h-[14px]" style={{ background: isPast ? color : '#E2E8F0', margin: '2px 0' }} />
                            )}
                          </div>
                          <div className="pb-3 flex-1">
                            <p className={`text-xs font-medium ${isPast ? 'text-emerald-600' : isActive ? 'text-gray-900 font-bold' : isPayLaterStep ? 'text-amber-700 font-semibold' : 'text-gray-400'}`}>
                              {step.label}
                            </p>
                            {isActive && (
                              <p className="text-xs font-bold mt-0.5" style={{ color }}> ← Current</p>
                            )}
                            {isPayLaterStep && (
                              <p className="text-xs font-semibold text-amber-600 mt-0.5">
                                ⏰ Pay Later{payLaterEarliestDue ? ` — due ${fmtDate(payLaterEarliestDue)}` : ' pending'}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Action Buttons ── */}
                  <div className="space-y-2 pb-4">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">CCO Actions</p>

                    {/* ── Rescheduled visit banner with repair-stage context ── */}
                    {status === 'RESCHEDULED' && (() => {
                      const preStatus = (booking as any).pre_reschedule_status as string | undefined;
                      const isResumingWork    = preStatus === 'IN_PROGRESS';
                      const isResumingInspect = preStatus === 'INSPECTING' || preStatus === 'ARRIVED';
                      return (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2 mb-1">
                          <p className="text-xs font-bold text-amber-800">🔄 Rescheduled Visit</p>
                          <p className="text-xs text-amber-700">
                            {isResumingWork
                              ? '⚠️ Repair was IN PROGRESS — after technician arrives, resume work directly. No re-inspection needed.'
                              : isResumingInspect
                                ? '⚠️ Inspection was underway — technician should continue inspection after arrival.'
                                : 'Booking rescheduled — proceed with normal visit workflow.'}
                          </p>
                          {preStatus && (
                            <p className="text-xs text-amber-600">
                              Stage before reschedule: <span className="font-bold">{preStatus.replace(/_/g, ' ')}</span>
                            </p>
                          )}
                          {(booking as any).scheduled_date && (
                            <p className="text-xs text-amber-700 font-semibold">
                              📅 {(booking as any).scheduled_date}
                              {(booking as any).scheduled_slot && <> · {(booking as any).scheduled_slot.replace('-', ' – ')}</>}
                            </p>
                          )}
                          {/* Resume Work — only when pre-status was IN_PROGRESS */}
                          {isResumingWork && (
                            <ActionBtn icon="🔧" label="Resume Work (Skip to In Progress)"
                              color="#166534" bg="#DCFCE7" border="#86EFAC"
                              hint="Repair was already in progress — skip en-route / inspection, go straight to work"
                              onClick={() => transition('startWork', '🔧 Resumed — work in progress')}
                              loading={acting} disabled={noTech} />
                          )}
                          {/* Continue Inspection — only when pre-status was INSPECTING or ARRIVED */}
                          {isResumingInspect && (
                            <ActionBtn icon="🔍" label="Continue Inspection"
                              color="#92400E" bg="#FEF3C7" border="#FCD34D"
                              hint="Inspection was underway — mark arrived and proceed"
                              onClick={() => transition('arrived', 'Technician arrived (rescheduled visit)')}
                              loading={acting} disabled={noTech} />
                          )}
                          {/* If just ACCEPTED/ASSIGNED before reschedule — normal flow */}
                          {!isResumingWork && !isResumingInspect && (
                            <ActionBtn icon="📍" label="Mark Arrived"
                              color="#0E7490" bg="#CFFAFE" border="#67E8F9"
                              hint="Technician reached customer — begin visit"
                              onClick={() => transition('arrived', 'Technician arrived (rescheduled)')}
                              loading={acting} disabled={noTech} />
                          )}
                          {/* Always allow Manage Quotation if quotations exist */}
                          {quotations.length > 0 && (
                            <ActionBtn icon="📋" label="Manage Quotation"
                              color="#1B4FD8" bg="#EFF6FF" border="#BFDBFE"
                              hint={`${quotations.length} quotation(s) — open to edit/approve`}
                              onClick={() => setShowQuotationModal(true)}
                              loading={false} />
                          )}
                        </div>
                      );
                    })()}

                    {/* Accept */}
                    {['PENDING','CONFIRMED','ASSIGNED'].includes(status) && (
                      <ActionBtn icon="✅" label="Accept Booking" color="#166534" bg="#DCFCE7" border="#86EFAC"
                        hint="Confirm and begin technician workflow"
                        onClick={() => transition('accept', 'Booking accepted')} loading={acting} />
                    )}

                    {/* Arrived */}
                    {['ACCEPTED','EN_ROUTE'].includes(status) && (
                      <ActionBtn icon="📍" label="Mark Arrived" color="#0E7490" bg="#CFFAFE" border="#67E8F9"
                        hint={noTech ? 'Assign technician first' : 'Technician reached customer'}
                        onClick={() => transition('arrived', 'Technician arrived')} loading={acting} disabled={noTech} />
                    )}

                    {/* Start Inspection */}
                    {status === 'ARRIVED' && (
                      <ActionBtn icon="🔍" label="Start Inspection" color="#92400E" bg="#FEF3C7" border="#FCD34D"
                        hint={noTech ? 'Assign technician first' : 'Begin inspection & quotation'}
                        onClick={() => transition('startInspection', 'Inspection started')} loading={acting} disabled={noTech} />
                    )}

                    {/* Manage Quotation — available during inspection / quotation approved / work phases */}
                    {['INSPECTING','QUOTATION_APPROVED','IN_PROGRESS','WORK_PAUSED','ARRIVED'].includes(status) && (
                      <ActionBtn icon="📋" label="Manage Quotation"
                        color="#1B4FD8" bg="#EFF6FF" border="#BFDBFE"
                        hint={quotations.length === 0 ? 'Create quotation on behalf of technician' : `${quotations.length} quotation(s) — open to edit/approve`}
                        onClick={() => setShowQuotationModal(true)}
                        loading={false} />
                    )}

                    {/* CCO: Submit Inspection Report when status is INSPECTING */}
                    {status === 'INSPECTING' && !(booking as any).inspection_submitted_by && (
                      <ActionBtn icon="📋" label="Submit Inspection Report"
                        color="#7C3AED" bg="#F5F3FF" border="#DDD6FE"
                        hint="Enter findings and photos on behalf of technician"
                        onClick={() => { setShowInspForm(true); setInspErr(''); }}
                        loading={false} />
                    )}

                    {/* Show already-submitted inspection banner */}
                    {status === 'INSPECTING' && (booking as any).inspection_submitted_by && (
                      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-1">
                        <p className="text-xs font-bold text-violet-800">
                          ✅ Inspection submitted by {(booking as any).inspection_submitted_by}
                        </p>
                        {(booking as any).inspection_notes && (
                          <p className="text-xs text-gray-600 line-clamp-2">{(booking as any).inspection_notes}</p>
                        )}
                        <p className="text-xs text-gray-400">Work is in progress.</p>
                      </div>
                    )}

                    {/* Start Work — needs at least 1 approved quotation */}
                    {['INSPECTING','QUOTATION_APPROVED'].includes(status) && (
                      hasAnyApproved ? (
                        <ActionBtn icon="🔧" label="Start Repair Work" color="#166534" bg="#DCFCE7" border="#86EFAC"
                          hint={`${approvedQuotations.length} quotation(s) approved — begin repair`}
                          onClick={() => transition('startWork', 'Work started')} loading={acting} disabled={noTech} />
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                          ⚠ Approve a quotation before starting work.
                        </div>
                      )
                    )}

                    {/* Pause / Resume */}
                    {status === 'IN_PROGRESS' && (
                      <ActionBtn icon="⏸" label="Pause Work" color="#92400E" bg="#FEF3C7" border="#FCD34D"
                        hint="Temporarily pause repair"
                        onClick={() => transition('pauseWork', 'Work paused')} loading={acting} />
                    )}
                    {status === 'WORK_PAUSED' && (
                      <ActionBtn icon="▶" label="Resume Work" color="#166534" bg="#DCFCE7" border="#86EFAC"
                        hint="Continue paused repair"
                        onClick={() => transition('resumeWork', 'Work resumed')} loading={acting} />
                    )}

                    {/* Generate Invoice buttons (per approved quotation) */}
                    {['QUOTATION_APPROVED','IN_PROGRESS','WORK_PAUSED','COMPLETED'].includes(status) && approvedQuotations.map(q => (
                      <ActionBtn key={q.id} icon="📄" label={`Invoice: ${q.quotation_number}`}
                        color="#7C3AED" bg="#F5F3FF" border="#DDD6FE"
                        hint={`${money(q.total_amount)} — convert to invoice`}
                        onClick={() => openInvoiceForm(q)} loading={false} disabled={noTech} />
                    ))}

                    {/* Complete Work */}
                    {['QUOTATION_APPROVED','IN_PROGRESS','WORK_PAUSED'].includes(status) && (
                      allRepairsDone ? (
                        <ActionBtn icon="🏁" label="Complete Repair" color="#7C3AED" bg="#F5F3FF" border="#DDD6FE"
                          hint="All quotations invoiced — mark complete"
                          onClick={() => transition('completeWork', 'Work completed')} loading={acting} disabled={noTech} />
                      ) : (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                          ⚠ Generate invoice for all {approvedQuotations.length} approved quotation(s) before completing.
                        </div>
                      )
                    )}

                    {/* Pay Later pending banner — shown when deferred collection is scheduled */}
                    {hasPayLaterPending && (
                      <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-base">⏰</span>
                          <p className="text-xs font-bold text-amber-800">Pay Later Scheduled</p>
                        </div>
                        <p className="text-xs text-amber-700">
                          Payment is deferred.{' '}
                          {payLaterEarliestDue
                            ? <>Due by <strong>{fmtDate(payLaterEarliestDue)}</strong>.</>
                            : 'No due date set.'}
                        </p>
                        <p className="text-xs text-gray-500">Use <strong>Collect Payment</strong> below to collect it now or reschedule.</p>
                      </div>
                    )}

                    {/* Collect Payment — per invoice with outstanding balance */}
                    {invoices.filter(inv => balanceByInvId[inv.id] > 0).map(inv => {
                      // Check if this invoice has a Pay Later scheduled
                      const invPayLater = payLaterPending.find((p: any) => p.invoice_id === inv.id);
                      const collectLabel = invoices.length > 1
                        ? `Collect — ${(inv as any).invoice_number}: ${money(balanceByInvId[inv.id])}`
                        : invPayLater
                          ? `⏰ Collect Pay Later — ${money(balanceByInvId[inv.id])} due`
                          : `Collect Payment — ${money(balanceByInvId[inv.id])} due`;
                      const collectHint = invPayLater
                        ? (invPayLater.due_collect_at ? `Pay Later due ${fmtDate(invPayLater.due_collect_at)}` : 'Pay Later scheduled')
                        : (paidByInvId[inv.id] || 0) > 0
                          ? `Partial: ${money(paidByInvId[inv.id]||0)} collected`
                          : 'Full payment pending';
                      return (
                        <ActionBtn key={inv.id} icon={invPayLater ? '⏰' : '💳'}
                          label={collectLabel}
                          color={invPayLater ? '#B45309' : '#059669'}
                          bg={invPayLater ? '#FFFBEB' : '#F0FDF4'}
                          border={invPayLater ? '#FCD34D' : '#86EFAC'}
                          hint={collectHint}
                          onClick={() => openPayForm(inv)} loading={false} />
                      );
                    })}

                    {/* Mark Paid */}
                    {hasInvoice && totalOutstanding <= 0 && !['PAID','CLOSED','SETTLED'].includes(status) && (
                      <ActionBtn icon="✅" label="Mark as Fully Paid" color="#059669" bg="#F0FDF4" border="#86EFAC"
                        hint={`All ${invoices.length} invoice(s) collected (${money(totalPaid)})`}
                        onClick={() => transition('markPaid', 'Marked as fully paid')} loading={acting} />
                    )}

                    {/* PENDING_VERIFICATION — visiting charge */}
                    {status === 'PENDING_VERIFICATION' && (
                      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-bold text-violet-800">🔍 Visiting Charge — Pending Verification</p>
                        <p className="text-xs text-gray-500">Technician collected a visiting charge. Verify below then settle.</p>
                        {invoices.filter(inv => balanceByInvId[inv.id] > 0).map(inv => (
                          <ActionBtn key={inv.id} icon="💳"
                            label={`Collect Visiting Charge — ${money(balanceByInvId[inv.id])}`}
                            color="#059669" bg="#F0FDF4" border="#86EFAC"
                            hint="Record visiting charge payment"
                            onClick={() => openPayForm(inv)} loading={false} />
                        ))}
                        {totalOutstanding <= 0 && hasInvoice && (
                          <ActionBtn icon="🔒" label="Verify & Close Booking" color="#374151" bg="#F0FDF4" border="#86EFAC"
                            hint="Visiting charge collected — settle and close"
                            onClick={async () => {
                              setSettleErr(''); setSettleOverrides({}); setSettleNotes('Visiting charge — CCO verified');
                              setSettleLoading(true); setShowSettle(true);
                              try {
                                const r = await api.get(`/bookings/${booking.id}/commission-preview`);
                                setSettlePreview((r as any).data?.data);
                              } catch (ex: any) { setSettleErr(extractApiError(ex, 'Failed to load preview')); setSettlePreview(null); }
                              finally { setSettleLoading(false); }
                            }} loading={false} />
                        )}
                      </div>
                    )}

                    {/* Settle & Close — all invoices paid */}
                    {hasInvoice && totalOutstanding <= 0 && !['PAID','CLOSED','SETTLED','PENDING_VERIFICATION'].includes(status) && (
                      <ActionBtn icon="🔒" label="Settle & Close Booking" color="#374151" bg="#F0FDF4" border="#86EFAC"
                        hint="Review commission and settle with technician"
                        onClick={async () => {
                          setSettleErr(''); setSettleOverrides({}); setSettleNotes('');
                          setSettleLoading(true); setShowSettle(true);
                          try {
                            const r = await api.get(`/bookings/${booking.id}/commission-preview`);
                            setSettlePreview((r as any).data?.data);
                          } catch (ex: any) { setSettleErr(extractApiError(ex, 'Failed to load preview')); setSettlePreview(null); }
                          finally { setSettleLoading(false); }
                        }} loading={false} />
                    )}

                    {/* Platform Loss Inspection toggle */}
                    <button
                      onClick={() => setShowLoss(v => !v)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs font-medium transition ${showLoss ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-dashed border-gray-200 text-gray-400 hover:bg-gray-50'}`}
                    >
                      🔍 Platform Loss Inspection
                      {platformRisk > 0 && (
                        <span className="ml-2 bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold">{money(platformRisk)} risk</span>
                      )}
                    </button>

                    {/* Raise Ticket */}
                    <button
                      onClick={() => { setShowEscalation(true); setEscSubject(`Issue with ${booking.booking_number}`); setEscDesc(''); setEscErr(''); }}
                      className="w-full text-left px-3 py-2.5 rounded-xl border border-violet-200 text-xs font-medium text-violet-700 hover:bg-violet-50 transition"
                    >
                      🎫 Raise Ticket to Admin
                    </button>

                    {/* ── CANCELLATION_REQUESTED: CCO must confirm or reject ── */}
                    {status === 'CANCELLATION_REQUESTED' && (
                      <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-bold text-amber-800">⚠️ Cancellation Requested</p>
                        <p className="text-xs text-amber-700">
                          Technician has requested cancellation. Confirm to cancel, or reject to restore.
                          {booking.cancelled_reason && <><br /><span className="font-medium">Reason: {booking.cancelled_reason}</span></>}
                        </p>
                        <div className="flex gap-2">
                          <button
                            disabled={acting}
                            onClick={async () => {
                              setActing(true); setErr(''); setOk('');
                              try {
                                await bookingActionsService.confirmCancellation(booking.id, booking.cancelled_reason || 'Confirmed by CCO');
                                setOk('✅ Cancellation confirmed');
                                await load(); onUpdated();
                              } catch (ex: any) { setErr(extractApiError(ex, 'Failed')); }
                              finally { setActing(false); }
                            }}
                            className="flex-1 py-2 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 font-bold disabled:opacity-50"
                          >✓ Confirm Cancel</button>
                          <button
                            disabled={acting}
                            onClick={async () => {
                              setActing(true); setErr(''); setOk('');
                              try {
                                await bookingActionsService.rejectCancellation(booking.id, 'Rejected by CCO — booking restored');
                                setOk('✅ Cancellation rejected — booking restored');
                                await load(); onUpdated();
                              } catch (ex: any) { setErr(extractApiError(ex, 'Failed')); }
                              finally { setActing(false); }
                            }}
                            className="flex-1 py-2 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 font-bold disabled:opacity-50"
                          >✕ Reject (Restore)</button>
                        </div>
                      </div>
                    )}

                    {/* ── Visiting Charge (on behalf of technician) ── */}
                    {['ARRIVED', 'INSPECTING', 'IN_PROGRESS', 'QUOTATION_APPROVED'].includes(status) && (
                      <ActionBtn icon="🚶" label="Visiting Charge (Customer Declined)"
                        color="#B91C1C" bg="#FEF2F2" border="#FECACA"
                        hint="Technician arrived but customer won't proceed — initiate visiting charge invoice"
                        onClick={async () => {
                          const amtStr = prompt("Enter base visiting charge amount (₹):");
                          if (!amtStr) return;
                          const amt = parseFloat(amtStr);
                          if (isNaN(amt) || amt <= 0) { setErr("Invalid amount"); return; }
                          const notes = prompt("Reason/notes:") || "Customer declined repair";
                          setActing(true); setErr(""); setOk("");
                          try {
                            await bookingActionsService.visitingCharge(booking.id, amt, notes);
                            setOk(`✅ Visiting charge ₹${amt.toFixed(2)} initiated`);
                            await load(); onUpdated();
                          } catch (ex: any) { setErr(extractApiError(ex, "Failed")); }
                          finally { setActing(false); }
                        }}
                        loading={acting} />
                    )}

                    {/* Cancel */}
                    {canCancel && !showCancel && (
                      <button onClick={() => setShowCancel(true)}
                        className="w-full text-left px-3 py-2.5 rounded-lg border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 transition">
                        ✕ Cancel Booking
                      </button>
                    )}
                    {showCancel && (
                      <div className="border border-red-200 rounded-lg p-3 space-y-2">
                        <textarea
                          className="w-full border border-red-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
                          rows={3} placeholder="Reason for cancellation..."
                          value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button onClick={() => setShowCancel(false)} className="flex-1 py-2 text-xs rounded-lg border border-gray-200 hover:bg-gray-50">Back</button>
                          <button onClick={handleCancel} disabled={cancelling}
                            className="flex-1 py-2 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50">
                            {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ══ RIGHT COLUMN — Quotations, Invoices, Payments, Timeline ══ */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">

                {/* ── Quotations ── */}
                <PanelSection title="Quotations" icon="📋" count={quotations.length}>
                  {quotations.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3 text-center">No quotations yet. Technician creates them during inspection.</p>
                  ) : quotations.map(q => {
                    const isApproved  = q.status === 'APPROVED';
                    const isConverted = (q.status as string) === 'CONVERTED_TO_INVOICE';
                    const isRejected  = q.status === 'REJECTED';
                    const linked      = invoiceByQId[q.id];
                    return (
                      <div key={q.id} className={`rounded-xl border p-3 mb-2 ${
                        isApproved  ? 'bg-emerald-50 border-emerald-200' :
                        isConverted ? 'bg-blue-50 border-blue-200' :
                        isRejected  ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
                      }`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold font-mono text-gray-800">{q.quotation_number}</span>
                          <QuotationBadge status={q.status} />
                        </div>
                        <div className="flex gap-4 text-xs text-gray-600">
                          <span>Services: <b>{money((q as any).services_total || 0)}</b></span>
                          <span>Parts: <b>{money((q as any).parts_total || 0)}</b></span>
                          <span className="text-emerald-700 font-bold">Total: {money(q.total_amount)}</span>
                        </div>
                        {isConverted && linked && (
                          <div className="mt-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-lg">
                            ✅ Invoice: <b>{(linked as any).invoice_number}</b> · {money(linked.total_amount)}
                          </div>
                        )}
                        {isRejected && (q as any).rejection_reason && (
                          <div className="mt-2 text-xs bg-red-100 text-red-700 px-2 py-1 rounded-lg">
                            ✕ {(q as any).rejection_reason}
                          </div>
                        )}
                        {/* ── DRAFT / REJECTED / REVISED → Edit button opens CcoQuotationModal ── */}
                        {['DRAFT', 'REJECTED', 'REVISED'].includes(q.status) && (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => setShowQuotationModal(true)}
                              className="flex-1 py-1.5 text-xs rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 font-medium"
                            >
                              ✏️ Open & Edit
                            </button>
                          </div>
                        )}
                        {q.status === 'SUBMITTED' && (
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => approveQuotation(q)} disabled={acting || approveFetching}
                              className="flex-1 py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 font-medium disabled:opacity-60">
                              {approveFetching ? '⏳ Loading…' : '✅ Review & Approve'}
                            </button>
                            <button onClick={() => { setRejectingQ(q); setRejectReason(''); setRejectErr(''); }}
                              className="flex-1 py-1.5 text-xs rounded-lg bg-red-100 text-red-700 hover:bg-red-200 font-medium">
                              ✕ Reject
                            </button>
                          </div>
                        )}
                        {isApproved && (
                          <div className="mt-2 flex gap-2 flex-wrap">
                            {['QUOTATION_APPROVED','IN_PROGRESS','WORK_PAUSED','COMPLETED'].includes(status) && (
                              <button onClick={() => openInvoiceForm(q)}
                                className="py-1.5 px-3 text-xs rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 font-medium">
                                📄 Generate Invoice
                              </button>
                            )}
                            <button onClick={() => { setRejectingQ(q); setRejectReason(''); setRejectErr(''); }}
                              className="py-1.5 px-3 text-xs rounded-lg bg-red-100 text-red-700 hover:bg-red-200 font-medium">
                              ✕ Reject
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </PanelSection>

                {/* ── Invoices ── */}
                <PanelSection title="Invoices" icon="🧾" count={invoices.length}>
                  {invoices.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3 text-center">Invoice generated after quotation is approved and work is in progress.</p>
                  ) : invoices.map(inv => (
                    <div key={inv.id} className="border border-gray-200 rounded-xl p-3 mb-2 bg-white">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold font-mono">{(inv as any).invoice_number}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                          (inv.status as any) === 'PARTIALLY_PAID' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{inv.status}</span>
                      </div>
                      <div className="flex gap-4 text-xs">
                        <span>Total: <b className="text-emerald-700">{money(inv.total_amount)}</b></span>
                        <span>Paid: <b className="text-emerald-600">{money(paidByInvId[inv.id]||0)}</b></span>
                        {balanceByInvId[inv.id] > 0 && (
                          <span>Due: <b className="text-red-600">{money(balanceByInvId[inv.id])}</b></span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{(inv as any).invoice_type} · {fmtDT(inv.created_at)}</p>
                      {balanceByInvId[inv.id] > 0 && (
                        <button onClick={() => openPayForm(inv)}
                          className="mt-2 w-full py-1.5 text-xs rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 font-medium">
                          💳 Collect {money(balanceByInvId[inv.id])}
                        </button>
                      )}
                    </div>
                  ))}

                  {invoices.length > 0 && (
                    <div className="flex justify-between text-xs font-semibold bg-gray-50 px-3 py-2 rounded-lg">
                      <span>Total Collected</span>
                      <span className="text-emerald-700">{money(totalPaid)}</span>
                    </div>
                  )}
                </PanelSection>

                {/* ── Payments ── */}
                <PanelSection title="Payment Transactions" icon="💰" count={payments.length}>
                  {payments.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3 text-center">No payments recorded yet.</p>
                  ) : payments.map((p, i) => (
                    <div key={p.id || i} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-xs font-semibold text-gray-900">
                          {p.method === 'CASH' ? '💵' : p.method === 'UPI' ? '📱' : p.method === 'BANK_TRANSFER' ? '🏦' : p.method === 'PAY_LATER' ? '⏰' : '🔗'} {p.method === 'PAY_LATER' ? 'Pay Later' : p.method}
                          {(p.method === 'PAY_LATER' || p.reference_number === 'PAY_LATER') && (
                            <span className="ml-2 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded">⏰ PAY LATER</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{fmtDT(p.paid_at || p.created_at)}</p>
                        {p.due_collect_at && (
                          <p className="text-xs text-amber-600 font-medium">Due: {fmtDate(p.due_collect_at)}</p>
                        )}
                        {p.reference_number && p.reference_number !== 'PAY_LATER' && (
                          <p className="text-xs text-gray-400">Ref: {p.reference_number}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`text-xs font-bold ${p.status === 'SUCCESS' ? 'text-emerald-700' : 'text-gray-400'}`}>{money(p.amount)}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${p.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{p.status}</span>
                      </div>
                    </div>
                  ))}
                  {payments.length > 0 && (
                    <div className="flex justify-between text-xs font-semibold bg-emerald-50 px-3 py-2 rounded-lg mt-2">
                      <span>Total Collected</span><span className="text-emerald-700">{money(totalPaid)}</span>
                    </div>
                  )}
                  {totalOutstanding > 0 && (
                    <div className="flex justify-between text-xs font-semibold bg-red-50 px-3 py-2 rounded-lg mt-1">
                      <span className="text-red-700">Outstanding</span><span className="text-red-700">{money(totalOutstanding)}</span>
                    </div>
                  )}
                </PanelSection>

                {/* ── Status Timeline ── */}
                <PanelSection title="Status Timeline" icon="📅" count={timeline.length}>
                  {timeline.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3 text-center">No events yet.</p>
                  ) : (
                    <div className="border-l-2 border-gray-200 pl-4 space-y-3">
                      {[...timeline].reverse().map((t: any, i) => (
                        <div key={i} className="relative">
                          <div
                            className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white"
                            style={{ background: STATUS_COLOR[t.status] || '#94A3B8' }}
                          />
                          <p className="text-xs font-bold text-gray-900">{STATUS_LABEL[t.status] || t.status}</p>
                          {t.notes && <p className="text-xs text-gray-500 mt-0.5">{t.notes}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">{fmtDT(t.at || t.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </PanelSection>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Platform Loss Inspection Panel ── */}
      {showLoss && (
        <div className="mx-6 mb-4 bg-amber-50 border-2 border-amber-400 rounded-2xl p-4">
          <p className="text-sm font-bold text-amber-800 mb-3">🔍 Platform Loss Inspection</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[
              { icon: '🛒', label: 'Parts Cost (Invoiced)', value: money(totalMarketCost), risk: totalMarketCost > 0,
                detail: totalMarketCost > 0 ? 'Verify purchase bills uploaded' : 'No parts cost on invoiced quotations' },
              { icon: '🏷', label: 'Total Discounts Given', value: money(totalDiscount), risk: totalDiscount > 500,
                detail: totalDiscount > 500 ? '⚠ Exceeds ₹500 — admin review required' : 'Within acceptable range' },
              { icon: '⏳', label: 'Outstanding Balance', value: money(totalOutstanding), risk: totalOutstanding > 0,
                detail: totalOutstanding > 0 ? `Follow up needed (${invoices.filter(i => balanceByInvId[i.id] > 0).length} invoice(s))` : 'All invoices fully collected' },
              { icon: '💼', label: 'Commission Status', value: hasInvoice && totalOutstanding <= 0 ? 'Eligible' : 'Pending', risk: false,
                detail: hasInvoice && totalOutstanding <= 0 ? 'All payments done — can settle' : 'Commission held until all invoices paid' },
            ].map(c => (
              <div key={c.label} className={`rounded-xl p-3 ${c.risk ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'}`}>
                <p className="text-lg mb-1">{c.icon}</p>
                <p className="text-xs text-gray-500 mb-0.5">{c.label}</p>
                <p className={`text-sm font-bold ${c.risk ? 'text-red-700' : 'text-emerald-700'}`}>{c.value}</p>
                <p className={`text-xs mt-0.5 ${c.risk ? 'text-red-600' : 'text-emerald-600'}`}>{c.detail}</p>
              </div>
            ))}
          </div>
          {platformRisk > 0 ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800">
              <p className="font-bold">⚠ Total Platform Risk: {money(platformRisk)}</p>
              <p className="mt-1 text-red-700">Invoiced: {money(totalInvoiced)} · Collected: {money(totalPaid)} · Outstanding: {money(totalOutstanding)}</p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800">
              ✅ No platform risk detected. Invoiced: {money(totalInvoiced)} · Collected: {money(totalPaid)}. Safe to settle.
            </div>
          )}
        </div>
      )}

      {/* ── Settle & Close Modal ── */}
      {showSettle && (
        <Modal open title={`Settle & Close — ${booking.booking_number}`} onClose={() => { setShowSettle(false); setSettlePreview(null); }} size="lg">
          <div className="space-y-4">
            {settleLoading ? (
              <div className="py-12 text-center"><Spinner /></div>
            ) : settleErr && !settlePreview ? (
              <AlertBanner type="error" message={settleErr} onClose={() => setSettleErr('')} />
            ) : settlePreview ? (
              <>
                {/* Technician + group info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <p className="text-xs text-gray-500 mb-1">👷 Technician</p>
                    <p className="font-bold text-blue-800 text-sm">{settlePreview.technician?.name || '—'}</p>
                  </div>
                  <div className={`rounded-xl p-3 ${settlePreview.commission_group ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">💼 Commission Group</p>
                    <p className={`font-bold text-sm ${settlePreview.commission_group ? 'text-emerald-800' : 'text-amber-800'}`}>
                      {settlePreview.commission_group?.name || '⚠ No group — manual entry required'}
                    </p>
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-2">Commission Breakdown</p>
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-5 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500">
                      <span className="col-span-2">Item</span><span className="text-right">Amount</span><span className="text-right">Rate</span><span className="text-right">Commission</span>
                    </div>
                    {settlePreview.line_items?.map((item: any, idx: number) => (
                      <div key={idx} className={`grid grid-cols-5 px-3 py-2.5 border-t border-gray-100 text-xs items-center ${item.match_status === 'unmatched' ? 'bg-amber-50' : 'bg-white'}`}>
                        <div className="col-span-2">
                          <p className="font-semibold text-gray-900">{item.type === 'PART' ? '🔩' : '🔧'} {item.name}</p>
                          <p className="text-gray-400">{item.quotation_number}
                            {item.match_status === 'unmatched' && <span className="ml-1 text-amber-700 bg-amber-100 px-1 rounded">⚠ Not in group</span>}
                          </p>
                        </div>
                        <div className="text-right text-gray-700">{money(item.total_price)}</div>
                        <div className="text-right text-gray-500">{item.rate != null ? (item.commission_type === 'PERCENTAGE' ? `${item.rate}%` : `₹${item.rate}`) : '—'}</div>
                        <div className="text-right">
                          {item.match_status === 'unmatched' ? (
                            <input type="number" min="0" step="0.01" placeholder="0"
                              value={settleOverrides[idx] ?? ''}
                              onChange={e => setSettleOverrides(ov => ({ ...ov, [idx]: e.target.value }))}
                              className="w-20 text-right text-xs border border-amber-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                          ) : (
                            <span className="font-bold text-emerald-700">{money(item.commission_amount || 0)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="grid grid-cols-5 px-3 py-2.5 bg-emerald-50 border-t-2 border-emerald-300 text-xs font-bold">
                      <span className="col-span-4 text-emerald-800">Total Commission</span>
                      <span className="text-right text-emerald-700 text-sm">
                        {money(settlePreview.line_items?.reduce((s: number, item: any, idx: number) =>
                          item.match_status === 'unmatched'
                            ? s + (parseFloat(settleOverrides[idx] || '0') || 0)
                            : s + (item.commission_amount || 0), 0) || 0)}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Settlement Notes (optional)</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                    placeholder="e.g. All payments verified, parts bill confirmed"
                    value={settleNotes} onChange={e => setSettleNotes(e.target.value)} />
                </div>

                {settleErr && <AlertBanner type="error" message={settleErr} onClose={() => setSettleErr('')} />}

                <div className="flex gap-2">
                  <button
                    disabled={settling}
                    onClick={async () => {
                      setSettling(true); setSettleErr('');
                      try {
                        const overrides = settlePreview.line_items
                          ?.map((item: any, idx: number) => item.match_status === 'unmatched'
                            ? { item_index: idx, commission_amount: parseFloat(settleOverrides[idx] || '0') || 0 }
                            : null)
                          .filter(Boolean);
                        await api.post(`/bookings/${booking.id}/settle`, { overrides, notes: settleNotes || undefined });
                        setShowSettle(false);
                        setOk('✅ Booking settled — commission credited to technician wallet');
                        await load(); onUpdated();
                      } catch (ex: any) { setSettleErr(extractApiError(ex, 'Settlement failed')); }
                      finally { setSettling(false); }
                    }}
                    className="flex-1 py-2.5 text-sm rounded-lg bg-[#1B4FD8] text-white hover:bg-blue-700 font-medium disabled:opacity-50"
                  >
                    {settling ? '⏳ Settling...' : '🔒 Confirm Settlement & Close'}
                  </button>
                  <button onClick={() => { setShowSettle(false); setSettlePreview(null); }}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
                </div>
              </>
            ) : null}
          </div>
        </Modal>
      )}

      {/* ── Raise Ticket / Escalation Modal ── */}
      {showEscalation && (
        <Modal open title={`Raise Ticket — ${booking.booking_number}`} onClose={() => setShowEscalation(false)}>
          <div className="space-y-3">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-xs text-violet-800">
              🎫 Ticket will be linked to booking <b>{booking.booking_number}</b> and sent to admin for resolution.
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject *</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                placeholder="Brief issue title"
                value={escSubject} onChange={e => setEscSubject(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Description *</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
                rows={4} placeholder="Describe the issue in detail..."
                value={escDesc} onChange={e => setEscDesc(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                value={escPriority} onChange={e => setEscPriority(e.target.value)}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            {escErr && <AlertBanner type="error" message={escErr} onClose={() => setEscErr('')} />}
            <div className="flex gap-2 pt-1">
              <button onClick={submitEscalation} disabled={escSaving}
                className="flex-1 py-2.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 font-medium disabled:opacity-50">
                {escSaving ? 'Raising...' : '🎫 Raise Ticket'}
              </button>
              <button onClick={() => setShowEscalation(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── CCO: Submit Inspection Report Modal ── */}
      {showInspForm && (
        <Modal open title="Submit Inspection Report" onClose={() => { setShowInspForm(false); setInspErr(''); }} size="lg">
          <div className="space-y-4">
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3">
              <p className="text-xs text-violet-800 font-medium">
                📋 You are submitting this inspection on behalf of the technician.
                This will move the booking to <strong>In Progress</strong> and notify all parties.
              </p>
            </div>

            {/* Inspection Notes */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Inspection Findings *</label>
              <textarea
                rows={4}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400"
                placeholder="Describe faults found, parts needed, repair scope…"
                value={inspNotes}
                onChange={e => setInspNotes(e.target.value)}
              />
            </div>

            {/* Photos */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">Inspection Photos (Optional)</label>
              {inspPhotos.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {inspPhotos.map((url, i) => (
                    <div key={i} className="relative">
                      <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                      <button
                        onClick={() => setInspPhotos(p => p.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              <CloudinaryImageUploader
                label="Add Photo"
                fieldKey={`inspection_${booking.id}_${inspPhotos.length}`}
                hint="Upload inspection photos from Cloudinary"
                onChange={url => setInspPhotos(p => [...p, url])}
              />
            </div>

            {inspErr && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{inspErr}</p>}

            <div className="flex gap-2 pt-2">
              <button
                onClick={submitInspection}
                disabled={inspSaving || !inspNotes.trim()}
                className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-bold py-2.5 rounded-xl transition"
              >
                {inspSaving ? 'Submitting…' : '✅ Submit Inspection Report'}
              </button>
              <button
                onClick={() => { setShowInspForm(false); setInspErr(''); }}
                className="px-4 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-xl transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Approve Quotation Confirm Modal ── */}
      {approveTarget && (
        <Modal open title={`Approve Quotation — ${approveTarget.quotation_number}`} onClose={() => { setApproveTarget(null); setApproveErr(''); }} size="lg">
          <div className="space-y-4">

            {/* Header summary */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-emerald-800">{approveTarget.quotation_number} · v{approveTarget.version}</p>
                  <p className="text-xs text-emerald-600 mt-0.5">Status: <b>{approveTarget.status}</b></p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-emerald-700">{money(approveTarget.total_amount)}</p>
                  <p className="text-xs text-emerald-600">incl. GST {money(approveTarget.tax_amount)}</p>
                </div>
              </div>
            </div>

            {/* Services line items */}
            {Array.isArray(approveTarget.services) && approveTarget.services.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">🔧 Services</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Service</th>
                        <th className="text-center px-2 py-2 font-medium text-gray-500">Qty</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500">Unit</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approveTarget.services.map((s: any, i: number) => (
                        <tr key={s.id ?? i} className="border-t border-gray-50">
                          <td className="px-3 py-2 text-gray-800">
                            {s.service_name || s.custom_service_name}
                            {s.appliance_label && <span className="ml-1 text-gray-400">({s.appliance_label})</span>}
                            {s.is_repeat_complaint && <span className="ml-1 text-amber-600 font-bold">[Repeat]</span>}
                          </td>
                          <td className="px-2 py-2 text-center text-gray-600">{s.quantity}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{money(s.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800">{money(s.total_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Parts line items */}
            {Array.isArray(approveTarget.parts) && approveTarget.parts.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">🔩 Parts</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">Part</th>
                        <th className="text-center px-2 py-2 font-medium text-gray-500">Qty</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500">Unit</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approveTarget.parts.map((p: any, i: number) => (
                        <tr key={p.id ?? i} className="border-t border-gray-50">
                          <td className="px-3 py-2 text-gray-800">
                            {p.part_name}
                            {p.appliance_label && <span className="ml-1 text-gray-400">({p.appliance_label})</span>}
                            {p.vendor_name && <span className="ml-1 text-gray-400">· {p.vendor_name}</span>}
                          </td>
                          <td className="px-2 py-2 text-center text-gray-600">{p.quantity}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{money(p.unit_price)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800">{money(p.total_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Totals breakdown */}
            <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-xs">
              {(approveTarget.services_total ?? 0) > 0 && (
                <div className="flex justify-between text-gray-600"><span>Services subtotal</span><span>{money(approveTarget.services_total)}</span></div>
              )}
              {(approveTarget.parts_total ?? 0) > 0 && (
                <div className="flex justify-between text-gray-600"><span>Parts subtotal</span><span>{money(approveTarget.parts_total)}</span></div>
              )}
              {(approveTarget.discount_amount ?? 0) > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Discount</span><span>−{money(approveTarget.discount_amount)}</span></div>
              )}
              {(approveTarget.coupon_discount ?? 0) > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Coupon ({approveTarget.coupon_code})</span><span>−{money(approveTarget.coupon_discount)}</span></div>
              )}
              {(approveTarget.adjustment_amount ?? 0) !== 0 && (
                <div className="flex justify-between text-gray-600"><span>Adjustment</span><span>{approveTarget.adjustment_amount > 0 ? '+' : ''}{money(approveTarget.adjustment_amount)}</span></div>
              )}
              <div className="flex justify-between text-gray-600 border-t border-gray-200 pt-1"><span>GST ({approveTarget.tax_percent}%)</span><span>{money(approveTarget.tax_amount)}</span></div>
              <div className="flex justify-between font-bold text-gray-900 text-sm border-t border-gray-300 pt-1"><span>Grand Total</span><span>{money(approveTarget.total_amount)}</span></div>
            </div>

            {approveTarget.remarks && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700">
                📝 Remarks: {approveTarget.remarks}
              </div>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
              ⚠ Approving this quotation will allow the technician to proceed with work and generate an invoice. This action is logged.
            </div>

            {approveErr && <AlertBanner type="error" message={approveErr} onClose={() => setApproveErr('')} />}

            <div className="flex gap-2 pt-1">
              <button onClick={confirmApprove} disabled={approving}
                className="flex-1 py-2.5 text-sm rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 font-bold disabled:opacity-50">
                {approving ? '⏳ Approving…' : '✅ Confirm Approval'}
              </button>
              <button onClick={() => { setApproveTarget(null); setApproveErr(''); }}
                className="px-5 py-2.5 text-sm rounded-xl border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reject Quotation Modal ── */}
      {rejectingQ && (
        <Modal open title={`Reject — ${rejectingQ.quotation_number}`} onClose={() => setRejectingQ(null)}>
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              ⚠ Rejecting an <b>{rejectingQ.status}</b> quotation worth <b>{money(rejectingQ.total_amount)}</b>. This is logged.
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Rejection Reason *</label>
              <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
                rows={3} placeholder="Reason for rejection..."
                value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            </div>
            {rejectErr && <AlertBanner type="error" message={rejectErr} onClose={() => setRejectErr('')} />}
            <div className="flex gap-2">
              <button onClick={rejectQuotation} disabled={rejecting}
                className="flex-1 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium disabled:opacity-50">
                {rejecting ? 'Rejecting...' : '✕ Confirm Rejection'}
              </button>
              <button onClick={() => setRejectingQ(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Invoice Generate Modal ── */}
      {showInvoiceForm && invTargetQuotation && (
        <Modal open title={`Generate Invoice — ${invTargetQuotation.quotation_number}`} onClose={() => { setShowInvoiceForm(false); setInvTargetQuotation(null); }}>
          <div className="space-y-4">
            {/* Quotation summary */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm">
              <p className="font-bold text-emerald-800">{invTargetQuotation.quotation_number}</p>
              <div className="flex gap-4 text-xs text-gray-600 mt-1">
                <span>Services: <b>{money((invTargetQuotation as any).services_total || 0)}</b></span>
                <span>Parts: <b>{money((invTargetQuotation as any).parts_total || 0)}</b></span>
                <span className="font-bold text-emerald-700">Total: {money(invTargetQuotation.total_amount)}</span>
              </div>
            </div>

            {/* Tax / invoice type badge */}
            {invTaxMode === 'NON_GST' ? (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs text-gray-600">
                🚫 <b>Non-GST Invoice</b> — No tax applied. Invoice generated without GST.
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs">
                <p className="font-bold text-blue-800">{invTaxMode === 'GST_B2B' ? '🏢 GST B2B Invoice' : '🧾 GST B2C Invoice'}</p>
                <p className="text-gray-600 mt-1">Tax: <b>{(invTargetQuotation as any).tax_percent ?? 18}%</b> · Tax Amount: <b className="text-violet-700">{money((invTargetQuotation as any).tax_amount || 0)}</b></p>
                {invTaxMode === 'GST_B2B' && <p className="text-gray-400 mt-0.5">B2B invoice — customer GSTIN required below.</p>}
              </div>
            )}

            {/* B2B GST fields */}
            {invTaxMode === 'GST_B2B' && (
              <>
                {invGstin && invBusinessName && (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    ✓ GST details pre-filled from quotation — edit only if incorrect.
                  </p>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Customer GSTIN *</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                    placeholder="e.g. 21AABCP1234M1ZV" value={invGstin} onChange={e => setInvGstin(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Business Name *</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                    placeholder="Registered business name" value={invBusinessName} onChange={e => setInvBusinessName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Business Address *</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                    placeholder="Registered address" value={invBusinessAddr} onChange={e => setInvBusinessAddr(e.target.value)} />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
              <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
                rows={2} value={invNotes} onChange={e => setInvNotes(e.target.value)} />
            </div>
            {invErr && <AlertBanner type="error" message={invErr} onClose={() => setInvErr('')} />}
            <div className="flex gap-2">
              <button onClick={createInvoice} disabled={invSaving}
                className="flex-1 py-2.5 text-sm rounded-lg bg-[#1B4FD8] text-white hover:bg-blue-700 font-medium disabled:opacity-50">
                {invSaving ? 'Generating...' : '📄 Generate Invoice'}
              </button>
              <button onClick={() => { setShowInvoiceForm(false); setInvTargetQuotation(null); }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Payment Collection Modal ── */}
      {showPayForm && payTargetInv && (
        <Modal open title={`Collect Payment — ${(payTargetInv as any).invoice_number}`} onClose={() => { setShowPayForm(false); setPayQR(''); setPayLink(''); }} size="lg">
          <div className="space-y-4">
            {/* Invoice summary */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm">
              <p className="font-bold">{(payTargetInv as any).invoice_number}</p>
              <div className="flex gap-4 text-xs mt-1 flex-wrap">
                <span>Total: <b className="text-emerald-700">{money(payTargetInv.total_amount)}</b></span>
                <span>Paid: <b className="text-emerald-600">{money(paidByInvId[payTargetInv.id]||0)}</b></span>
                <span>Balance: <b className="text-red-600">{money(balanceByInvId[payTargetInv.id]||0)}</b></span>
              </div>
              {(() => {
                const pl = payLaterPending.find((p: any) => p.invoice_id === payTargetInv.id);
                return pl ? (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded">
                      ⏰ Pay Later Scheduled: {money(pl.amount)}
                      {pl.due_collect_at ? ` — due ${fmtDate(pl.due_collect_at)}` : ''}
                    </span>
                    <span className="text-xs text-gray-500">Select CASH/UPI below to collect now and clear this schedule.</span>
                  </div>
                ) : null;
              })()}
            </div>

            {/* Method selector */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Payment Method</label>
              <div className="flex flex-wrap gap-2">
                {PAYMENT_METHODS.map(m => (
                  <button key={m.value} onClick={() => { setPayMethod(m.value); setPayQR(''); setPayLink(''); }}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border-2 transition ${payMethod === m.value ? 'border-[#1B4FD8] bg-blue-50 text-[#1B4FD8]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">{PAYMENT_METHODS.find(m => m.value === payMethod)?.desc}</p>
            </div>

            {/* Amount */}
            {payMethod !== 'PAY_LATER' ? (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount (₹) *</label>
                <input type="number" min="0.01" step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={payAmount} onChange={e => setPayAmount(e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">Outstanding: <b className="text-red-600">{money(balanceByInvId[payTargetInv.id]||0)}</b></p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <p className="font-bold">⏰ Scheduling future collection</p>
                <p className="mt-1">Outstanding <b>{money(balanceByInvId[payTargetInv.id]||0)}</b> recorded as due on selected date.</p>
              </div>
            )}

            {/* Reference */}
            {['CASH','BANK_TRANSFER'].includes(payMethod) && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{payMethod === 'BANK_TRANSFER' ? 'UTR / Reference *' : 'Receipt No. (optional)'}</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  placeholder={payMethod === 'BANK_TRANSFER' ? 'UTR number' : 'Optional'} value={payRef} onChange={e => setPayRef(e.target.value)} />
              </div>
            )}

            {/* Pay Later date */}
            {payMethod === 'PAY_LATER' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Collection Date *</label>
                <input type="date" min={(() => { const _d = new Date(); return `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`; })()}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={payDue} onChange={e => setPayDue(e.target.value)} />
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                placeholder="e.g. Customer paid via PhonePe" value={payNotes} onChange={e => setPayNotes(e.target.value)} />
            </div>

            {payErr && <AlertBanner type="error" message={payErr} onClose={() => setPayErr('')} />}

            {/* QR / Link display */}
            {payQR && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <p className="text-xs font-bold text-emerald-800 mb-2">📱 UPI QR Generated</p>
                <p className="font-mono text-xs break-all text-gray-700 bg-emerald-100 p-2 rounded">{payQR}</p>
                <p className="text-xs text-emerald-700 mt-2">Show to customer to scan. Once paid, record the receipt.</p>
              </div>
            )}
            {payLink && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <p className="text-xs font-bold text-blue-800 mb-2">🔗 Payment Link</p>
                <a href={payLink} target="_blank" rel="noreferrer" className="font-mono text-xs break-all text-[#1B4FD8] underline">{payLink}</a>
                <p className="text-xs text-blue-700 mt-2">Send to customer via WhatsApp or SMS.</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={submitPayment} disabled={paySaving}
                className="flex-1 py-2.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium disabled:opacity-50">
                {paySaving ? 'Processing...' :
                  payMethod === 'CASH' ? '💵 Record Cash' :
                  payMethod === 'BANK_TRANSFER' ? '🏦 Record Transfer' :
                  payMethod === 'UPI' ? '📱 Generate QR' :
                  payMethod === 'RAZORPAY' ? '🔗 Generate Link' : '⏰ Schedule Pay Later'}
              </button>
              <button onClick={() => { setShowPayForm(false); setPayQR(''); setPayLink(''); }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Quotation Management Modal */}
      {showQuotationModal && (
        <CcoQuotationModal
          booking={booking}
          onClose={() => setShowQuotationModal(false)}
          onDone={() => { setShowQuotationModal(false); load(); onUpdated(); }}
        />
      )}

      {/* Reschedule + Assign modals */}
      <RescheduleModal open={showReschedule} onClose={() => setShowReschedule(false)}
        bookingId={booking.id} bookingNumber={booking.booking_number}
        currentDate={booking.scheduled_date}
        currentSlot={booking.scheduled_slot}
        onRescheduled={() => { setShowReschedule(false); setOk('Booking rescheduled'); load(); onUpdated(); }} />
      <AssignTechModal open={showAssign} onClose={() => setShowAssign(false)}
        bookingId={booking.id} bookingNumber={booking.booking_number}
        booking={booking}
        onAssigned={() => { setShowAssign(false); setOk('Technician assigned'); load(); onUpdated(); }} />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionBtn({ icon, label, hint, color, bg, border, onClick, loading, disabled }: {
  icon: string; label: string; hint: string; color: string; bg: string; border: string;
  onClick: () => void; loading: boolean; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={loading || disabled}
      className="w-full text-left px-3 py-2.5 rounded-xl transition"
      style={{ background: bg, border: `1px solid ${border}`, opacity: (loading || disabled) ? 0.5 : 1, cursor: (loading || disabled) ? 'default' : 'pointer' }}>
      <p className="text-xs font-bold flex items-center gap-1.5" style={{ color }}>
        {loading ? '⏳' : icon} {label}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
    </button>
  );
}

function PanelSection({ title, icon, count, children }: { title: string; icon: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-50 bg-gray-50/50">
        <span>{icon}</span>
        <span className="text-sm font-bold text-gray-800">{title}</span>
        {count > 0 && <span className="text-xs bg-gray-200 text-gray-600 font-bold px-2 py-0.5 rounded-full">{count}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function QuotationBadge({ status }: { status: string }) {
  const cfg: Record<string,string> = {
    DRAFT: 'bg-gray-100 text-gray-600',
    SUBMITTED: 'bg-blue-100 text-blue-700',
    APPROVED: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-red-100 text-red-700',
    CONVERTED_TO_INVOICE: 'bg-violet-100 text-violet-700',
    REVISED: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg[status] || cfg.DRAFT}`}>
      {status === 'CONVERTED_TO_INVOICE' ? '✅ INVOICED' : status}
    </span>
  );
}
