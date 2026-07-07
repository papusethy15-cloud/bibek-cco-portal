import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CustomerSearchBar } from '../components/customers/CustomerSearchBar';
import { NewCustomerModal } from '../components/customers/NewCustomerModal';
import { CallLogModal } from '../components/customers/CallLogModal';
import { RaiseTicketModal } from '../components/customers/RaiseTicketModal';
import { CustomerProfileCard } from '../components/customers/CustomerProfileCard';
import { CustomerBookingsTable } from '../components/customers/CustomerBookingsTable';
import { CustomerAddressList } from '../components/customers/CustomerAddressList';
import { CustomerNotesTimeline } from '../components/customers/CustomerNotesTimeline';
import { AlertBanner } from '../components/ui/AlertBanner';
import { Spinner } from '../components/ui/Spinner';
import { customerService } from '../services/customer.service';
import { callLogService, CallLogEntry } from '../services/callLog.service';
import { Customer, Booking } from '../types';
import { bookingService } from '../services/booking.service';
import { BookingWorkflowPanel } from '../components/bookings/BookingWorkflowPanel';
import { NewBookingModal } from '../components/bookings/NewBookingModal';

type Tab = 'bookings' | 'notes' | 'addresses';

export function CustomersPage() {
  const [searching, setSearching] = useState(false);
  const [searchedMobile, setSearchedMobile] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [showCallLogModal, setShowCallLogModal] = useState(false);
  // ── Inbound call auto-timer ─────────────────────────────────────────────
  const [callElapsed, setCallElapsed] = useState(0);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCallTimer = useCallback(() => {
    setCallElapsed(0);
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    callTimerRef.current = setInterval(() => setCallElapsed((s) => s + 1), 1000);
  }, []);

  const stopCallTimer = useCallback(() => {
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
  }, []);

  useEffect(() => () => { if (callTimerRef.current) clearInterval(callTimerRef.current); }, []);

  const fmtElapsed = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const [activeTab, setActiveTab] = useState<Tab>('bookings');
  const [workflowBooking, setWorkflowBooking] = useState<Booking | null>(null);
  const [repeatBooking, setRepeatBooking] = useState<any | null>(null);
  const [ticketBookingId, setTicketBookingId] = useState<string | undefined>(undefined);

  const openBookingWorkflow = async (bookingId: string) => {
    try {
      const b = await bookingService.getById(bookingId);
      setWorkflowBooking(b);
    } catch {}
  };

  const handleRepeatBooking = (booking: any) => {
    setRepeatBooking(booking);
  };

  const handleRaiseTicketForBooking = (bookingId: string) => {
    setTicketBookingId(bookingId);
    setShowTicketModal(true);
  };
  const [bookings, setBookings] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [calls, setCalls] = useState<CallLogEntry[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  const loadCustomerDetails = async (c: Customer) => {
    setLoadingTab(true);
    try {
      const [bookingsRes, addressesRes, notesRes, callsRes] = await Promise.all([
        customerService.getBookings(c.id).catch(() => ({ items: [] as any[] })),
        customerService.getAddresses(c.id).catch(() => []),
        customerService.getNotes(c.id).catch(() => []),
        callLogService.listByCustomer(c.id).catch(() => ({ items: [] as CallLogEntry[] })),
      ]);
      setBookings((bookingsRes as any).items || []);
      setAddresses(addressesRes as any);
      setNotes(notesRes as any);
      setCalls((callsRes as any).items || []);
    } finally {
      setLoadingTab(false);
    }
  };

  const handleSearch = async (mobile: string) => {
    setSearching(true);
    setNotFound(false);
    setCustomer(null);
    setSearchedMobile(mobile);
    try {
      const found = await customerService.searchByMobile(mobile);
      if (found) {
        setCustomer(found);
        setActiveTab('bookings');
        loadCustomerDetails(found);
        startCallTimer();  // auto-start call timer
      } else {
        setNotFound(true);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleCustomerCreated = (c: Customer) => {
    setCustomer(c);
    setNotFound(false);
    setSuccessMessage(`${c.name} registered successfully.`);
    setActiveTab('bookings');
    loadCustomerDetails(c);
    startCallTimer();  // auto-start call timer
  };

  const handleCallLogged = () => {
    stopCallTimer();
    setSuccessMessage('Call logged.');
    if (customer) loadCustomerDetails(customer);
    setActiveTab('notes');
  };

  const handleTicketRaised = () => {
    setSuccessMessage('Ticket raised to admin. They will follow up on this customer\'s issue.');
  };

  const handleNoteAdded = () => {
    if (customer) loadCustomerDetails(customer);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <p className="text-gray-500 mt-1">Search by mobile number first — every call starts here.</p>
      </div>

      {successMessage && (
        <AlertBanner type="success" message={successMessage} onClose={() => setSuccessMessage('')} />
      )}

      <CustomerSearchBar onSearch={handleSearch} loading={searching} />

      {searching && (
        <div className="py-10"><Spinner /></div>
      )}

      {!searching && notFound && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-50 rounded-2xl mb-3">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-gray-900">No customer found for {searchedMobile}</h2>
          <p className="text-sm text-gray-500 mt-1 mb-4">This looks like a new customer — register them now.</p>
          <button
            onClick={() => setShowNewCustomerModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B4FD8] hover:bg-[#1640B0] text-white text-sm font-medium transition"
          >
            Register new customer
          </button>
        </div>
      )}

      {!searching && customer && (
        <>
          <CustomerProfileCard
            customer={customer}
            onLogCall={() => setShowCallLogModal(true)}
            callTimerDisplay={callElapsed > 0 ? fmtElapsed(callElapsed) : undefined}
            onRaiseTicket={() => setShowTicketModal(true)}
          />

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex border-b border-gray-100 px-5">
              {([
                { key: 'bookings', label: 'Booking history' },
                { key: 'notes', label: 'Notes & calls' },
                { key: 'addresses', label: 'Addresses' },
              ] as { key: Tab; label: string }[]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition -mb-px ${
                    activeTab === t.key
                      ? 'border-[#1B4FD8] text-[#1B4FD8]'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {activeTab === 'bookings' && (
                <CustomerBookingsTable
                  bookings={bookings}
                  loading={loadingTab}
                  onSelect={openBookingWorkflow}
                  onRepeat={handleRepeatBooking}
                  onRaiseTicket={handleRaiseTicketForBooking}
                />
              )}
              {activeTab === 'notes' && (
                <CustomerNotesTimeline
                  customerId={customer.id}
                  notes={notes}
                  calls={calls}
                  loading={loadingTab}
                  onNoteAdded={handleNoteAdded}
                />
              )}
              {activeTab === 'addresses' && (
                <CustomerAddressList
                  customerId={customer.id}
                  addresses={addresses}
                  loading={loadingTab}
                  onRefresh={() => loadCustomerDetails(customer)}
                />
              )}
            </div>
          </div>
        </>
      )}

      <NewCustomerModal
        open={showNewCustomerModal}
        onClose={() => setShowNewCustomerModal(false)}
        prefillMobile={searchedMobile}
        onCreated={handleCustomerCreated}
      />

      {customer && (
        <>
          <CallLogModal
            open={showCallLogModal}
            onClose={() => setShowCallLogModal(false)}
            customerId={customer.id}
            customerName={customer.name}
            bookings={bookings.map(b => ({ id: b.id, booking_number: b.booking_number, status: b.status }))}
            onLogged={handleCallLogged}
            elapsedSeconds={callElapsed}
          />
          <RaiseTicketModal
            open={showTicketModal}
            onClose={() => { setShowTicketModal(false); setTicketBookingId(undefined); }}
            customerName={customer.name}
            bookingId={ticketBookingId}
            onRaised={handleTicketRaised}
          />
        </>
      )}
      {/* Repeat booking modal — pre-fills service from previous booking */}
      {customer && repeatBooking && (
        <NewBookingModal
          open={!!repeatBooking}
          onClose={() => setRepeatBooking(null)}
          onCreated={(booking) => {
            setRepeatBooking(null);
            setSuccessMessage(`Repeat booking ${booking.booking_number} created!`);
            loadCustomerDetails(customer);
          }}
          prefillCustomer={customer}
          prefillServiceId={repeatBooking.service_id}
          prefillBrand={repeatBooking.appliance_brand}
          prefillModel={repeatBooking.appliance_model}
        />
      )}

      {workflowBooking && (
        <BookingWorkflowPanel
          booking={workflowBooking}
          onClose={() => setWorkflowBooking(null)}
          onUpdated={() => {
            setWorkflowBooking(null);
            if (customer) loadCustomerDetails(customer);
          }}
        />
      )}
    </div>
  );
}
