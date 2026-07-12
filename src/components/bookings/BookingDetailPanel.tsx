import React, { useState, useEffect } from 'react';
import { Booking } from '../../types';
import { statusColors, statusLabels } from '../../utils/statusColors';
import { bookingService } from '../../services/booking.service';
import { WhatsAppBookingLocationModal } from './WhatsAppBookingLocationModal';
import { quotationService, Quotation } from '../../services/quotation.service';
import { invoiceService, Invoice } from '../../services/invoice.service';
import { RescheduleModal } from './RescheduleModal';
import { AssignTechModal } from './AssignTechModal';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';

interface Props {
  booking: Booking;
  onClose: () => void;
  onUpdated: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-50 pt-4 mt-4">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</h4>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start text-sm py-1">
      <span className="text-gray-500 shrink-0 mr-4">{label}</span>
      <span className="text-gray-900 text-right font-medium">{value || '—'}</span>
    </div>
  );
}

const slotLabels: Record<string, string> = {
  '08:00-10:00': '8–10 AM', '10:00-12:00': '10 AM–12 PM',
  '12:00-14:00': '12–2 PM', '14:00-16:00': '2–4 PM',
  '16:00-18:00': '4–6 PM', '18:00-20:00': '6–8 PM',
};

export function BookingDetailPanel({ booking, onClose, onUpdated }: Props) {
  const [detail, setDetail] = useState<Booking>(booking);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showGeoModal, setShowGeoModal] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadAll();
  }, [booking.id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [fresh, quots, inv] = await Promise.all([
        bookingService.getById(booking.id).catch(() => booking),
        quotationService.listByBooking(booking.id).then((r: any) => r.data?.data?.items || r.data?.data || []).catch(() => []),
        invoiceService.getByBooking(booking.id).catch(() => null),
      ]);
      setDetail(fresh);
      setQuotations(quots);
      setInvoice(inv);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelReason.trim()) { setError('Please enter cancellation reason.'); return; }
    setCancelling(true); setError('');
    try {
      await bookingService.updateStatus(booking.id, 'CANCELLED', cancelReason);
      setSuccess('Booking cancelled.');
      setShowCancel(false);
      onUpdated();
      loadAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to cancel.');
    } finally {
      setCancelling(false);
    }
  };

  const handleApproveQuotation = async (qId: string) => {
    setError('');
    try {
      await quotationService.approve(qId);
      setSuccess('Quotation approved.');
      loadAll();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to approve quotation.');
    }
  };

  const canAssign = ['PENDING', 'CONFIRMED'].includes(detail.status);
  const canReschedule = !['COMPLETED', 'CANCELLED', 'PAID', 'CLOSED', 'SETTLED'].includes(detail.status);
  const canCancel = !['COMPLETED', 'CANCELLED', 'PAID', 'CLOSED', 'SETTLED'].includes(detail.status);

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-base font-bold text-gray-900">{detail.booking_number}</h3>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${statusColors[detail.status] || 'bg-gray-100 text-gray-700'}`}>
            {statusLabels[detail.status] || detail.status}
          </span>
        </div>
        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition">
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="py-12"><Spinner /></div>
        ) : (
          <>
            {success && <AlertBanner type="success" message={success} onClose={() => setSuccess('')} />}
            {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

            <Section title="Customer">
              <Row label="Name" value={detail.customer?.name} />
              <Row label="Mobile" value={
                detail.customer?.mobile
                  ? <a href={`tel:${detail.customer.mobile}`} className="text-[#1B4FD8] hover:underline">{detail.customer.mobile}</a>
                  : undefined
              } />
            </Section>

            <Section title="Booking Details">
              <Row label="Service" value={detail.service_name} />
              <Row label="Brand / Model" value={[detail.appliance_brand, detail.appliance_model].filter(Boolean).join(' · ')} />
              <Row label="Address" value={
                detail.address_str && detail.address_str !== '—'
                  ? (detail.address_label ? `[${detail.address_label}] ${detail.address_str}` : detail.address_str)
                  : [detail.address_line, detail.city].filter(Boolean).join(', ') || '—'
              } />
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-500">GPS</span>
                {detail.address_latitude && detail.address_longitude ? (
                  <a
                    href={`https://www.google.com/maps?q=${detail.address_latitude},${detail.address_longitude}`}
                    target="_blank" rel="noreferrer"
                    className="text-xs text-emerald-600 font-medium hover:underline"
                  >
                    📍 {detail.address_latitude?.toFixed(4)}, {detail.address_longitude?.toFixed(4)}
                  </a>
                ) : (
                  <span className="text-xs text-amber-500 font-medium">⚠️ No GPS</span>
                )}
              </div>
              <button
                onClick={() => setShowGeoModal(true)}
                className="mt-1 flex items-center gap-1.5 text-xs text-[#1B4FD8] font-semibold hover:underline"
              >
                💬 Paste WhatsApp Location
              </button>
              <Row label="Date" value={detail.scheduled_date} />
              <Row label="Slot" value={slotLabels[detail.scheduled_slot || ''] || detail.scheduled_slot} />
              <Row label="Source" value={detail.source?.replace(/_/g, ' ')} />
              <Row label="Priority" value={<Badge label={detail.priority} color={detail.priority === 'URGENT' ? 'red' : detail.priority === 'HIGH' ? 'orange' : 'gray'} />} />
              {detail.notes && <Row label="Notes" value={<span className="text-gray-600 text-xs">{detail.notes}</span>} />}
            </Section>

            <Section title="Technician">
              {detail.technician ? (
                <>
                  <Row label="Name" value={detail.technician.name} />
                  <Row label="Mobile" value={
                    <a href={`tel:${detail.technician.mobile}`} className="text-[#1B4FD8] hover:underline">{detail.technician.mobile}</a>
                  } />
                </>
              ) : (
                <p className="text-sm text-amber-600 font-medium">No technician assigned</p>
              )}
            </Section>

            <Section title="Financials">
              <Row label="Base" value={`₹${detail.base_amount?.toLocaleString('en-IN') || 0}`} />
              <Row label="Discount" value={`₹${detail.discount_amount?.toLocaleString('en-IN') || 0}`} />
              <Row label="GST" value={`₹${detail.gst_amount?.toLocaleString('en-IN') || 0}`} />
              <Row label="Total" value={<span className="text-base font-bold text-gray-900">₹{detail.total_amount?.toLocaleString('en-IN') || 0}</span>} />
            </Section>

            {quotations.length > 0 && (
              <Section title={`Quotations (${quotations.length})`}>
                {quotations.map(q => (
                  <div key={q.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{q.quotation_number}</p>
                      <p className="text-xs text-gray-400">₹{q.total_amount?.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        q.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        q.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' :
                        q.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{q.status}</span>
                      {q.status === 'SUBMITTED' && (
                        <button
                          onClick={() => handleApproveQuotation(q.id)}
                          className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded-lg hover:bg-emerald-700 transition"
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {invoice && (
              <Section title="Invoice">
                <Row label="Invoice #" value={invoice.invoice_number} />
                <Row label="Amount" value={`₹${invoice.total_amount?.toLocaleString('en-IN')}`} />
                <Row label="Status" value={
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    invoice.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                    invoice.status === 'OVERDUE' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>{invoice.status}</span>
                } />
              </Section>
            )}

            {showCancel && (
              <Section title="Cancel Booking">
                <textarea
                  className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                  rows={3}
                  placeholder="Reason for cancellation..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
                <div className="flex gap-2 mt-2">
                  <Button variant="secondary" onClick={() => setShowCancel(false)}>Back</Button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex-1 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition disabled:opacity-50"
                  >
                    {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
                  </button>
                </div>
              </Section>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="px-6 py-4 border-t border-gray-100 flex flex-wrap gap-2">
        {canAssign && (
          <Button onClick={() => setShowAssign(true)} variant="secondary">
            {detail.technician ? 'Reassign Tech' : 'Assign Tech'}
          </Button>
        )}
        {canReschedule && (
          <Button onClick={() => setShowReschedule(true)} variant="secondary">Reschedule</Button>
        )}
        {canCancel && !showCancel && (
          <button
            onClick={() => setShowCancel(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 transition"
          >
            Cancel Booking
          </button>
        )}
      </div>

      {showGeoModal && (
        <WhatsAppBookingLocationModal
          open={showGeoModal}
          onClose={() => setShowGeoModal(false)}
          booking={detail}
          onSaved={(lat, lng) => {
            setDetail(prev => ({ ...prev, address_latitude: lat, address_longitude: lng }));
            setShowGeoModal(false);
          }}
        />
      )}
      <RescheduleModal
        open={showReschedule}
        onClose={() => setShowReschedule(false)}
        bookingId={detail.id}
        bookingNumber={detail.booking_number}
        currentDate={detail.scheduled_date}
        currentSlot={detail.scheduled_slot}
        onRescheduled={() => { loadAll(); onUpdated(); }}
      />
      <AssignTechModal
        open={showAssign}
        onClose={() => setShowAssign(false)}
        bookingId={booking.id}
        bookingNumber={booking.booking_number}
        onAssigned={() => { loadAll(); onUpdated(); }}
      />
    </div>
  );
}
