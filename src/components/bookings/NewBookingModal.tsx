/**
 * NewBookingModal.tsx — CCO Portal advanced booking creation modal
 *
 * Redesigned to match admin dashboard feature parity + CCO-specific improvements:
 *  ✅ Step 1: Mobile lookup
 *  ✅ Step 2: Customer preview — last 5 bookings (active first) + active booking warning
 *  ✅ Step 3: Booking form
 *      • Domain selector → searchable service type-ahead (handles 100+ services)
 *      • Price panel: base + city override + GST + total
 *      • Customer appliance selector (optional)
 *      • Quick-add address inline (if no addresses exist)
 *      • Duplicate booking guard info banner
 *  ✅ Step 4: Slot availability grid (from RescheduleModal logic, reused here)
 *      • Real slot counts from /bookings/slot-summary
 *      • Capacity bar per slot — FULL / BUSY / Available
 *      • Hard cap guard before submit
 *  ✅ Multi-booking session support
 *  ✅ Repeat booking pre-fill support (prefillServiceId, prefillBrand, prefillModel)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { customerService } from '../../services/customer.service';
import { bookingService } from '../../services/booking.service';
import api from '../../services/api';
import { Customer, CustomerAddress } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (booking: any) => void;
  prefillCustomer?: Customer | null;
  prefillServiceId?: string;
  prefillBrand?: string;
  prefillModel?: string;
}

interface ServiceOption { id: string; name: string; base_price: number; gst_percent?: number; category_name?: string; }
interface DomainOption  { id: string; name: string; }
interface ApplianceOption { id: string; category?: string; category_name?: string; brand_name?: string; model?: string; serial_number?: string; is_under_warranty?: boolean; }

// ─── Constants ────────────────────────────────────────────────────────────────
const SLOTS = [
  { value: '08:00-10:00', label: '8:00 – 10:00 AM',    short: '8–10 AM'   },
  { value: '10:00-12:00', label: '10:00 AM – 12:00 PM', short: '10 AM–12' },
  { value: '12:00-14:00', label: '12:00 – 2:00 PM',    short: '12–2 PM'  },
  { value: '14:00-16:00', label: '2:00 – 4:00 PM',     short: '2–4 PM'   },
  { value: '16:00-18:00', label: '4:00 – 6:00 PM',     short: '4–6 PM'   },
  { value: '18:00-20:00', label: '6:00 – 8:00 PM',     short: '6–8 PM'   },
];

const SOFT_CAP = 5;
const HARD_CAP = 10;

const ACTIVE_STATUSES = ['PENDING', 'CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'INSPECTING', 'IN_PROGRESS'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}

function fmtDate(d: string): string {
  if (!d) return '—';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return d; }
}

function fmtDateShort(d: string): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
}

const money = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

const statusColor = (s: string): { bg: string; color: string } => {
  if (ACTIVE_STATUSES.includes(s)) return { bg: '#DCFCE7', color: '#166534' };
  if (s === 'COMPLETED')           return { bg: '#F1F5F9', color: '#475569' };
  if (s === 'CANCELLED')           return { bg: '#FEE2E2', color: '#991B1B' };
  if (s === 'RESCHEDULED')         return { bg: '#FEF3C7', color: '#92400E' };
  return { bg: '#F1F5F9', color: '#475569' };
};

const shortAddress = (b: any): string => {
  if (b.address_str && b.address_str !== '—') return b.address_label ? `[${b.address_label}] ${b.address_str}` : b.address_str;
  const a = b.address || b.service_address;
  if (a && typeof a === 'object') return [a.address_line1 || a.line1, a.city, a.pincode].filter(Boolean).join(', ') || '—';
  return b.address_line || '—';
};

const bkgService = (b: any): string => b.service_name || b.service?.name || b.domain_name || '—';

// ─── Sub-components ───────────────────────────────────────────────────────────

function SlotCapacityBar({ count }: { count: number }) {
  const filled  = Math.min(count, HARD_CAP);
  const pct     = Math.round((filled / HARD_CAP) * 100);
  const barColor = count >= HARD_CAP ? 'bg-red-500' : count >= SOFT_CAP ? 'bg-amber-400' : count >= 3 ? 'bg-yellow-300' : 'bg-emerald-500';
  const txtColor = count >= HARD_CAP ? 'text-red-600' : count >= SOFT_CAP ? 'text-amber-600' : count >= 3 ? 'text-yellow-600' : 'text-emerald-700';
  const label    = count >= HARD_CAP ? `Full (${HARD_CAP}/${HARD_CAP})` : count >= SOFT_CAP ? `${count}/${HARD_CAP} — busy` : count === 0 ? 'Available' : `${count}/${HARD_CAP} booked`;
  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`text-[10px] font-semibold ${txtColor}`}>{label}</p>
    </div>
  );
}

function SlotButton({ slot, count, isSelected, dateSelected, loadingSlots, onClick }: {
  slot: typeof SLOTS[0]; count: number; isSelected: boolean;
  dateSelected: boolean; loadingSlots: boolean; onClick: () => void;
}) {
  const isFull = count >= HARD_CAP;
  const isBusy = count >= SOFT_CAP && count < HARD_CAP;
  let borderClass = 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer';
  if (isSelected)  borderClass = 'border-[#1B4FD8] bg-blue-50 ring-1 ring-[#1B4FD8]';
  else if (isFull) borderClass = 'border-red-200 bg-red-50 cursor-not-allowed';
  else if (isBusy) borderClass = 'border-amber-200 hover:border-amber-300 cursor-pointer';
  return (
    <button
      onClick={() => !isFull && onClick()}
      disabled={!dateSelected || isFull}
      className={`text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${borderClass} ${!dateSelected ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center justify-between gap-1 min-w-0">
        <span className={`font-semibold truncate ${isSelected ? 'text-[#1B4FD8]' : isFull ? 'text-red-600' : isBusy ? 'text-amber-700' : 'text-gray-800'}`}>
          {slot.label}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {isFull && <span className="text-[9px] font-bold bg-red-100 text-red-600 rounded px-1 py-0.5 leading-none">FULL</span>}
          {isBusy && !isFull && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 rounded px-1 py-0.5 leading-none">BUSY</span>}
        </div>
      </div>
      {dateSelected && (
        loadingSlots
          ? <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full animate-pulse" />
          : <SlotCapacityBar count={count} />
      )}
    </button>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export function NewBookingModal({ open, onClose, onCreated, prefillCustomer, prefillServiceId, prefillBrand, prefillModel }: Props) {
  const today = todayIST();

  // ── Step state ──────────────────────────────────────────────────────────────
  type Step = 'customer' | 'preview' | 'service' | 'schedule';
  const [step, setStep] = useState<Step>(prefillCustomer ? 'service' : 'customer');

  // ── Step 1: mobile lookup ───────────────────────────────────────────────────
  const [mobile,    setMobile]    = useState('');
  const [searching, setSearching] = useState(false);

  // ── Customer + sub-data ─────────────────────────────────────────────────────
  const [customer,    setCustomer]    = useState<Customer | null>(prefillCustomer || null);
  const [addresses,   setAddresses]   = useState<CustomerAddress[]>([]);
  const [appliances,  setAppliances]  = useState<ApplianceOption[]>([]);
  const [recentBkgs,  setRecentBkgs]  = useState<any[]>([]);
  const [loadingBkgs, setLoadingBkgs] = useState(false);

  // ── Step 3: service form ────────────────────────────────────────────────────
  const [domains,   setDomains]   = useState<DomainOption[]>([]);
  const [domainId,  setDomainId]  = useState('');
  const [allSvcs,   setAllSvcs]   = useState<ServiceOption[]>([]);
  const [svcSearch, setSvcSearch] = useState('');
  const [loadSvc,   setLoadSvc]   = useState(false);
  const [selSvc,    setSelSvc]    = useState<ServiceOption | null>(null);
  const [svcDropOpen, setSvcDropOpen] = useState(false);
  const [cityPrices,  setCityPrices]  = useState<any[]>([]);
  const [cities,      setCities]      = useState<any[]>([]);
  const [loadPrice,   setLoadPrice]   = useState(false);

  const [addressId,   setAddressId]   = useState('');
  const [applianceId, setApplianceId] = useState('');
  const [brand,       setBrand]       = useState(prefillBrand || '');
  const [model,       setModel]       = useState(prefillModel || '');
  const [notes,       setNotes]       = useState('');
  const [priority,    setPriority]    = useState('NORMAL');

  // Quick-add address
  const [showAddAddr, setShowAddAddr] = useState(false);
  const [addrForm, setAddrForm] = useState({ label: 'Home', address_line1: '', address_line2: '', city: '', state: '', pincode: '' });
  const [addrSaving, setAddrSaving] = useState(false);
  const [addrErr,    setAddrErr]    = useState('');

  // ── Step 4: schedule ────────────────────────────────────────────────────────
  const [scheduledDate, setScheduledDate] = useState('');
  const [slot,          setSlot]          = useState('');
  const [slotCounts,    setSlotCounts]    = useState<Record<string, number>>({});
  const [loadingSlots,  setLoadingSlots]  = useState(false);

  // ── Submit ──────────────────────────────────────────────────────────────────
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [created,  setCreated]  = useState<any[]>([]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────────────────
  // Load cities list for address form dropdown
  useEffect(() => {
    api.get<any>('/cities?limit=100').then(r => {
      const items = r.data?.data?.items ?? r.data?.data ?? [];
      setCities(Array.isArray(items) ? items : []);
    }).catch(() => {});
  }, []);

    useEffect(() => {
    if (!open) return;
    loadDomains();
    if (prefillCustomer) {
      setCustomer(prefillCustomer);
      setStep('service');
      loadCustomerData(prefillCustomer.id);
    }
    if (prefillBrand) setBrand(prefillBrand);
    if (prefillModel) setModel(prefillModel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Prefill service from repeat booking
  useEffect(() => {
    if (!prefillServiceId || !open) return;
    (async () => {
      try {
        const res = await api.get<any>(`/services/${prefillServiceId}`);
        const svc = res.data?.data || res.data;
        if (!svc) return;
        const dId = svc.domain_id;
        if (dId) {
          setDomainId(dId);
          const items = await fetchServices(dId);
          const match = items.find((s: ServiceOption) => s.id === prefillServiceId);
          if (match) { setSelSvc(match); setSvcSearch(match.name); }
        }
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillServiceId, open]);

  // Load city prices when service changes
  useEffect(() => {
    if (!selSvc) { setCityPrices([]); return; }
    setLoadPrice(true);
    api.get<any>(`/services/${selSvc.id}/city-prices`)
      .then(r => setCityPrices(r.data?.data || []))
      .catch(() => setCityPrices([]))
      .finally(() => setLoadPrice(false));
  }, [selSvc]);

  // Fetch slot counts when date changes
  const fetchSlotCounts = useCallback(async (d: string) => {
    if (!d) { setSlotCounts({}); return; }
    setLoadingSlots(true);
    try {
      const counts = await bookingService.slotSummary(d);
      setSlotCounts(counts);
    } catch { setSlotCounts({}); }
    finally { setLoadingSlots(false); }
  }, []);

  useEffect(() => {
    if (open && scheduledDate) fetchSlotCounts(scheduledDate);
  }, [scheduledDate, open, fetchSlotCounts]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Data loaders
  // ─────────────────────────────────────────────────────────────────────────────
  const loadDomains = async () => {
    try {
      const res = await api.get<any>('/domains?limit=50');
      setDomains(res.data?.data?.items || res.data?.data || []);
    } catch {}
  };

  const loadCustomerData = async (customerId: string) => {
    setLoadingBkgs(true);
    try {
      const [addrRes, applRes, bkgRes] = await Promise.all([
        customerService.getAddresses(customerId),
        api.get<any>(`/appliances/customer/${customerId}`).catch(() => ({ data: { data: [] } })),
        customerService.getBookings(customerId, 1),
      ]);
      const addrs = addrRes;
      setAddresses(addrs);
      const def = addrs.find((a: CustomerAddress) => a.is_default);
      if (def) setAddressId(def.id);

      setAppliances(applRes.data?.data || []);

      const allBkgs: any[] = (bkgRes as any)?.items || (bkgRes as any) || [];
      const sorted = [...allBkgs].sort((a, b) => {
        const aA = ACTIVE_STATUSES.includes(a.status) ? 1 : 0;
        const bA = ACTIVE_STATUSES.includes(b.status) ? 1 : 0;
        if (bA !== aA) return bA - aA;
        return new Date(b.created_at || b.scheduled_date || 0).getTime() - new Date(a.created_at || a.scheduled_date || 0).getTime();
      });
      setRecentBkgs(sorted.slice(0, 5));
    } catch {}
    finally { setLoadingBkgs(false); }
  };

  const fetchServices = async (dId: string): Promise<ServiceOption[]> => {
    try {
      const res = await api.get<any>(`/services?domain_id=${dId}&limit=200`);
      const items: ServiceOption[] = res.data?.data?.items || res.data?.data || [];
      setAllSvcs(items);
      return items;
    } catch { setAllSvcs([]); return []; }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  const handleSearchCustomer = async () => {
    if (!mobile || mobile.length < 10) return;
    setSearching(true); setError('');
    try {
      const found = await customerService.searchByMobile(mobile);
      if (found) {
        setCustomer(found);
        await loadCustomerData(found.id);
        setStep('preview');
      } else {
        setError('No customer found. Please register the customer first from the Customers page.');
      }
    } finally { setSearching(false); }
  };

  const handleDomainChange = (dId: string) => {
    setDomainId(dId);
    setSelSvc(null); setSvcSearch(''); setAllSvcs([]);
    if (dId) { setLoadSvc(true); fetchServices(dId).finally(() => setLoadSvc(false)); }
  };

  const pickService = (s: ServiceOption) => {
    setSelSvc(s);
    setSvcSearch(s.name);
    setSvcDropOpen(false);
  };

  const filteredSvcs = svcSearch.trim() && !selSvc
    ? allSvcs.filter(s => s.name.toLowerCase().includes(svcSearch.toLowerCase()) || (s.category_name || '').toLowerCase().includes(svcSearch.toLowerCase()))
    : allSvcs;

  const saveQuickAddress = async () => {
    if (!customer) return;
    if (!addrForm.address_line1.trim() || !addrForm.city.trim() || !addrForm.state.trim() || !addrForm.pincode.trim()) {
      setAddrErr('Address line, city, state and pincode are required.'); return;
    }
    setAddrSaving(true); setAddrErr('');
    try {
      await customerService.addAddress(customer.id, { ...addrForm, is_default: true } as any);
      const addrs = await customerService.getAddresses(customer.id);
      setAddresses(addrs);
      const def = addrs.find(a => a.is_default);
      if (def) setAddressId(def.id);
      setShowAddAddr(false);
      setAddrForm({ label: 'Home', address_line1: '', address_line2: '', city: '', state: '', pincode: '' });
    } catch (ex: any) {
      setAddrErr(ex?.response?.data?.detail || 'Failed to save address.');
    } finally { setAddrSaving(false); }
  };

  const handleSubmit = async () => {
    if (!customer || !selSvc || !scheduledDate || !slot) { setError('Please fill all required fields.'); return; }
    const count = slotCounts[slot] || 0;
    if (count >= HARD_CAP) { setError(`Slot is full (${HARD_CAP}/${HARD_CAP}). Please choose another slot.`); return; }
    setLoading(true); setError('');
    try {
      const selAppl = appliances.find(a => a.id === applianceId);
      const booking = await bookingService.create({
        customer_id:     customer.id,
        service_id:      selSvc.id,
        address_id:      addressId || undefined,
        domain_id:       domainId || undefined,
        city_id:         cityPrice?.city_id || undefined,
        city:            cityPrice?.city_name || (selAddr as any)?.city || undefined,
        appliance_brand: selAppl?.brand_name || brand || undefined,
        appliance_model: selAppl?.model      || model || undefined,
        appliance_id:    selAppl?.id         || undefined,
        scheduled_date:  scheduledDate,
        scheduled_slot:  slot,
        notes:           notes || undefined,
        priority,
        source:          'CALL_CENTER',
      } as any);
      setCreated(prev => [...prev, booking]);
      onCreated(booking);
      // Reset service + schedule for possible multi-booking, keep customer
      setSelSvc(null); setSvcSearch(''); setDomainId(''); setAllSvcs([]);
      setScheduledDate(''); setSlot(''); setSlotCounts({});
      setNotes(''); setApplianceId('');
      setStep('service');
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.response?.data?.detail || 'Failed to create booking.');
    } finally { setLoading(false); }
  };

  const handleClose = () => {
    setStep(prefillCustomer ? 'service' : 'customer');
    setMobile(''); setCustomer(prefillCustomer || null);
    setAddresses([]); setAppliances([]); setRecentBkgs([]);
    setDomainId(''); setSelSvc(null); setSvcSearch(''); setAllSvcs([]);
    setBrand(''); setModel(''); setAddressId(''); setApplianceId('');
    setScheduledDate(''); setSlot(''); setSlotCounts({});
    setNotes(''); setError(''); setCreated([]);
    setShowAddAddr(false); setAddrErr('');
    onClose();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────────
  const activeBkgCount = recentBkgs.filter(b => ACTIVE_STATUSES.includes(b.status)).length;
  const selAddr        = addresses.find(a => a.id === addressId);
  const cityPrice      = selAddr ? cityPrices.find(cp => cp.city_name?.toLowerCase() === selAddr.city?.toLowerCase()) : null;
  const basePrice      = selSvc?.base_price ?? 0;
  const effectivePrice = cityPrice ? cityPrice.price : basePrice;
  const gstPct         = selSvc?.gst_percent ?? 0;
  const gstAmt         = +(effectivePrice * gstPct / 100).toFixed(2);
  const totalPrice     = +(effectivePrice + gstAmt).toFixed(2);
  const selectedSlotCount = slot ? (slotCounts[slot] || 0) : 0;
  const totalOnDate    = Object.values(slotCounts).reduce((a, b) => a + b, 0);

  const STEP_LABELS: Step[] = ['customer', 'preview', 'service', 'schedule'];
  const stepIdx = STEP_LABELS.indexOf(step);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <Modal open={open} onClose={handleClose} title={customer ? `New Booking — ${customer.name}` : 'New Booking'} size="lg">
      <div className="space-y-5">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        {/* ── Step indicator ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          {(['customer', 'preview', 'service', 'schedule'] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <span className={`px-3 py-1 rounded-full font-medium capitalize text-xs ${
                step === s ? 'bg-[#1B4FD8] text-white' :
                stepIdx > i ? 'bg-emerald-100 text-emerald-700' :
                'bg-gray-100 text-gray-400'
              }`}>
                {i + 1}. {s === 'preview' ? 'History' : s === 'service' ? 'Service' : s}
              </span>
              {i < 3 && <span className="text-gray-300 text-xs">→</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Multi-booking session banner */}
        {created.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <p className="text-sm font-semibold text-emerald-700 mb-1">✓ {created.length} booking{created.length > 1 ? 's' : ''} created this session</p>
            {created.map(b => (
              <p key={b.id} className="text-xs text-emerald-600">• <b>{b.booking_number}</b> — {b.status}</p>
            ))}
            <p className="text-xs text-emerald-500 mt-1">You can add another booking below (different service or address).</p>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 1 — Mobile lookup
        ══════════════════════════════════════════════════════════════════ */}
        {step === 'customer' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 font-medium">Search customer by mobile number</p>
            <div className="flex gap-2">
              <Input
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchCustomer()}
                maxLength={10}
                autoFocus
              />
              <Button onClick={handleSearchCustomer} loading={searching} disabled={mobile.length < 10}>
                Find Customer
              </Button>
            </div>
            <p className="text-xs text-gray-400">Enter the customer's registered mobile to look up their profile, addresses, and booking history.</p>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 2 — Customer preview + recent bookings
        ══════════════════════════════════════════════════════════════════ */}
        {step === 'preview' && customer && (
          <div className="space-y-4">
            {/* Customer card */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-base text-blue-800">{customer.name}</p>
                  <p className="text-sm text-blue-600 mt-0.5">📱 {customer.mobile}</p>
                  {(customer as any).email && <p className="text-xs text-blue-400 mt-0.5">✉ {(customer as any).email}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 mb-1">Customer Code</p>
                  <span className="font-mono font-bold text-blue-700 bg-white px-2 py-0.5 rounded text-sm">{customer.customer_code}</span>
                </div>
              </div>
              <div className="flex gap-4 mt-3 flex-wrap text-xs text-gray-600">
                <span>📋 Bookings: <b className="text-blue-700">{(customer as any).total_bookings || 0}</b></span>
                <span>📍 Addresses: <b className="text-blue-700">{addresses.length}</b></span>
                <span>🔧 Appliances: <b className="text-blue-700">{appliances.length}</b></span>
              </div>
            </div>

            {/* Active booking warning */}
            {activeBkgCount > 0 && (
              <div className="bg-orange-50 border-2 border-orange-400 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">🟠</span>
                  <div>
                    <p className="font-bold text-sm text-orange-700">{activeBkgCount} Active Booking{activeBkgCount > 1 ? 's' : ''} Found</p>
                    <p className="text-xs text-orange-600 mt-1">
                      Creating in the <strong>same category</strong> at the <strong>same address</strong> will be blocked as duplicate.
                      Different category or different address is allowed.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Recent bookings */}
            <div>
              <p className="text-xs font-bold text-gray-600 mb-2 flex items-center gap-2">
                Booking History — Last {recentBkgs.length > 0 ? recentBkgs.length : '0'} Records
                {activeBkgCount > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">🟡 {activeBkgCount} active</span>
                )}
              </p>
              {loadingBkgs ? (
                <div className="text-center py-6 text-sm text-gray-400">Loading history…</div>
              ) : recentBkgs.length === 0 ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">
                  ✓ No existing bookings — this will be the customer's first booking.
                </div>
              ) : (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  {recentBkgs.map((b, i) => {
                    const sc = statusColor(b.status);
                    const isActive = ACTIVE_STATUSES.includes(b.status);
                    return (
                      <div key={b.id} className={`px-4 py-3 ${i < recentBkgs.length - 1 ? 'border-b border-gray-100' : ''} ${isActive ? 'bg-amber-50 border-l-4 border-l-amber-400' : 'bg-white border-l-4 border-l-transparent'}`}>
                        <div className="flex justify-between items-center mb-1.5">
                          <div className="flex items-center gap-2">
                            {isActive && <span className="text-sm">🟡</span>}
                            <span className="font-bold text-xs font-mono text-gray-900">{b.booking_number || b.id?.slice(0, 8)}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>{b.status}</span>
                          </div>
                          <span className="font-bold text-xs text-emerald-600">{money(b.total_amount || 0)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-xs">🔧</span>
                          <span className={`text-xs font-semibold ${isActive ? 'text-amber-700' : 'text-blue-700'}`}>{bkgService(b)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-gray-400 truncate flex-1">📍 {shortAddress(b)}</span>
                          <span className="text-[11px] text-gray-400 ml-2 shrink-0">{b.scheduled_date ? fmtDateShort(b.scheduled_date) : '—'}</span>
                        </div>
                        {isActive && (
                          <p className="mt-1.5 text-[10px] text-amber-700 bg-amber-100 rounded px-2 py-0.5 inline-block">
                            ⚠ Same category + same address = duplicate (will be blocked)
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* No address — quick-add */}
            {addresses.length === 0 && !showAddAddr && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800">
                <p className="mb-2">⚠ This customer has <b>no saved addresses</b>. Please add one to continue.</p>
                <Button variant="primary" onClick={() => setShowAddAddr(true)} className="text-xs py-1">+ Add Address Now</Button>
              </div>
            )}
            {addresses.length === 0 && showAddAddr && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                <p className="text-sm font-bold text-gray-700">Add Address for {customer.name}</p>
                {addrErr && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{addrErr}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 1 *</label>
                    <Input value={addrForm.address_line1} onChange={e => setAddrForm(f => ({ ...f, address_line1: e.target.value }))} placeholder="Street / area" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 2</label>
                    <Input value={addrForm.address_line2} onChange={e => setAddrForm(f => ({ ...f, address_line2: e.target.value }))} placeholder="Landmark (optional)" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">City *</label>
                    {cities.length > 0 ? (
                      <select className="w-full border rounded px-3 py-2 text-sm"
                        value={addrForm.city}
                        onChange={e => {
                          const city = cities.find((c: any) => c.name === e.target.value);
                          setAddrForm(f => ({
                            ...f,
                            city: e.target.value,
                            state: city?.state ?? f.state,
                          }));
                        }}>
                        <option value="">Select city</option>
                        {cities.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    ) : (
                      <Input value={addrForm.city} onChange={e => setAddrForm(f => ({ ...f, city: e.target.value }))} />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">State *</label>
                    <Input value={addrForm.state} onChange={e => setAddrForm(f => ({ ...f, state: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Pincode *</label>
                    <Input value={addrForm.pincode} maxLength={6} onChange={e => setAddrForm(f => ({ ...f, pincode: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Label</label>
                    <Input value={addrForm.label} onChange={e => setAddrForm(f => ({ ...f, label: e.target.value }))} placeholder="Home / Office" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button loading={addrSaving} onClick={saveQuickAddress}>Save Address</Button>
                  <Button variant="secondary" onClick={() => { setShowAddAddr(false); setAddrErr(''); }}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                variant="primary"
                disabled={addresses.length === 0}
                onClick={() => setStep('service')}
                className="flex-1"
              >
                {activeBkgCount > 0 ? 'Continue — Create New Booking →' : 'Continue to Book Service →'}
              </Button>
              <Button variant="secondary" onClick={() => { setCustomer(null); setStep('customer'); }}>
                ← Change Customer
              </Button>
            </div>
          </div>
        )}

        {/* Customer bar when on service/schedule steps */}
        {customer && (step === 'service' || step === 'schedule') && (
          <div className="bg-blue-50 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-blue-800">{customer.name}</p>
              <p className="text-xs text-blue-500">{customer.mobile} · {customer.customer_code}</p>
            </div>
            <div className="flex items-center gap-2">
              {activeBkgCount > 0 && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">🟡 {activeBkgCount} active</span>
              )}
              {!prefillCustomer && (
                <button onClick={() => setStep('preview')} className="text-xs text-gray-400 hover:text-blue-600">← History</button>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 3 — Service form
        ══════════════════════════════════════════════════════════════════ */}
        {step === 'service' && customer && (
          <div className="space-y-4">
            {prefillServiceId && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-xs text-violet-800">
                🔁 <b>Repeat booking</b> — service pre-selected from previous booking. You can change it below.
              </div>
            )}

            {/* Service Address */}
            {addresses.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Service Address *</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                >
                  <option value="">Select address…</option>
                  {addresses.map(a => (
                    <option key={a.id} value={a.id}>{a.label} — {a.address_line1}, {(a as any).city}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Domain */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Service Category *</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                value={domainId}
                onChange={(e) => handleDomainChange(e.target.value)}
              >
                <option value="">Select category…</option>
                {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            {/* Searchable service */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Service *
                {allSvcs.length > 0 && <span className="font-normal text-gray-400 ml-1.5">({allSvcs.length} available)</span>}
              </label>
              {!domainId ? (
                <div className="px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-400">Select a category first</div>
              ) : loadSvc ? (
                <div className="px-3 py-2 text-xs text-gray-400 animate-pulse">Loading services…</div>
              ) : (
                <div className="relative">
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                    placeholder={selSvc ? selSvc.name : `Search ${allSvcs.length} services…`}
                    value={svcSearch}
                    onChange={(e) => {
                      setSvcSearch(e.target.value);
                      setSvcDropOpen(true);
                      if (!e.target.value) { setSelSvc(null); }
                    }}
                    onFocus={() => setSvcDropOpen(true)}
                    onBlur={() => setTimeout(() => setSvcDropOpen(false), 150)}
                  />
                  {/* Dropdown */}
                  {svcDropOpen && filteredSvcs.length > 0 && !selSvc && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                      {filteredSvcs.map(s => (
                        <div
                          key={s.id}
                          onMouseDown={() => pickService(s)}
                          className="px-4 py-2.5 cursor-pointer hover:bg-blue-50 border-b border-gray-50 last:border-0"
                        >
                          <p className="font-semibold text-sm text-gray-900">{s.name}</p>
                          <p className="text-[11px] text-gray-400">
                            {s.category_name && <span>{s.category_name} · </span>}
                            {s.base_price ? `₹${s.base_price}` : 'Price varies'}
                            {s.gst_percent ? ` + ${s.gst_percent}% GST` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {svcSearch && !selSvc && filteredSvcs.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1.5">No services match "{svcSearch}"</p>
                  )}
                  {selSvc && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-semibold">✓ {selSvc.name}</span>
                      <button onClick={() => { setSelSvc(null); setSvcSearch(''); }} className="text-xs text-gray-400 hover:text-red-500">✕ clear</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Price panel */}
            {selSvc && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Price Details</p>
                {loadPrice ? (
                  <p className="text-xs text-gray-400 animate-pulse">Loading price…</p>
                ) : (
                  <div className="flex gap-5 flex-wrap items-end">
                    <div>
                      <p className="text-[10px] text-gray-400 mb-0.5">Base Price</p>
                      <p className="font-bold text-base text-gray-900">{money(basePrice)}</p>
                    </div>
                    {selAddr && (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5">City Price ({(selAddr as any).city})</p>
                        {cityPrice
                          ? <p className="font-bold text-base text-blue-700">{money(cityPrice.price)}</p>
                          : <p className="text-xs text-amber-600">Using base price</p>}
                      </div>
                    )}
                    {gstPct > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-400 mb-0.5">GST ({gstPct}%)</p>
                        <p className="font-bold text-base text-gray-500">+{money(gstAmt)}</p>
                      </div>
                    )}
                    <div className="border-l-2 border-gray-200 pl-5">
                      <p className="text-[10px] text-gray-400 mb-0.5">Total Estimate</p>
                      <p className="font-extrabold text-lg text-emerald-600">{money(totalPrice)}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Appliance selector */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Appliance <span className="font-normal text-gray-400">(optional)</span>
                </label>
                {appliances.length > 0 ? (() => {
                  // Filter appliances by selected service category
                  const svcCatId = (selSvc as any)?.appliance_category_id || (selSvc as any)?.category_id || ''
                  const catFiltered = svcCatId
                    ? appliances.filter(a => !((a as any).appliance_category_id) || (a as any).appliance_category_id === svcCatId)
                    : appliances
                  const displayAppl = catFiltered.length > 0 ? catFiltered : appliances
                  return (
                    <>
                      {catFiltered.length < appliances.length && selSvc && (
                        <div className="text-[10px] text-blue-700 bg-blue-50 rounded px-2 py-1 mb-1.5">
                          🔧 {catFiltered.length} {(selSvc as any).category_name || 'category'}-related · {appliances.length - catFiltered.length} other{appliances.length - catFiltered.length !== 1 ? 's' : ''} hidden
                        </div>
                      )}
                      <select
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                        value={applianceId}
                        onChange={e => setApplianceId(e.target.value)}
                      >
                        <option value="">Skip / Technician fills later</option>
                        {displayAppl.map(a => (
                          <option key={a.id} value={a.id}>
                            {a.category || a.category_name || 'Appliance'}{a.brand_name ? ` — ${a.brand_name}` : ''}{a.model ? ` (${a.model})` : ''}
                          </option>
                        ))}
                      </select>
                    </>
                  )
                })() : (
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    No appliances registered. Technician will fill during service.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Priority</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                >
                  {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* Manual brand/model if no appliance chosen */}
            {!applianceId && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Appliance Brand</label>
                  <Input placeholder="e.g. Samsung" value={brand} onChange={e => setBrand(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Model</label>
                  <Input placeholder="e.g. WW70J5" value={model} onChange={e => setModel(e.target.value)} />
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes / Problem Description</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
                rows={2}
                placeholder="Describe the customer's issue…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              {!prefillCustomer && (
                <Button variant="secondary" onClick={() => setStep('preview')}>← Back</Button>
              )}
              <Button disabled={!selSvc || !addressId} onClick={() => setStep('schedule')}>
                Next: Schedule →
              </Button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            STEP 4 — Slot availability
        ══════════════════════════════════════════════════════════════════ */}
        {step === 'schedule' && customer && (
          <div className="space-y-4">
            {/* Service summary */}
            {selSvc && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-800">
                🔧 <b>{selSvc.name}</b> · {money(totalPrice)} total
                {selAddr && <span className="ml-2 text-blue-600">📍 {(selAddr as any).city}</span>}
              </div>
            )}

            {/* Date picker */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Scheduled Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                min={today}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] focus:border-transparent transition"
                value={scheduledDate}
                onChange={(e) => {
                  setScheduledDate(e.target.value);
                  setSlot('');
                  setSlotCounts({});
                }}
              />
              {scheduledDate && (
                <p className="text-xs text-gray-400 mt-1">
                  {fmtDate(scheduledDate)}
                  {loadingSlots ? ' · Loading availability…' : totalOnDate > 0 ? ` · ${totalOnDate} booking${totalOnDate !== 1 ? 's' : ''} on this day` : ' · No bookings yet on this day'}
                </p>
              )}
            </div>

            {/* Slot grid */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600">
                  Time Slot <span className="text-red-500">*</span>
                </label>
                {scheduledDate && !loadingSlots && (
                  <span className="text-[10px] text-gray-400">Capacity: {HARD_CAP} bookings/slot · Busy ≥{SOFT_CAP}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SLOTS.map(s => (
                  <SlotButton
                    key={s.value}
                    slot={s}
                    count={slotCounts[s.value] || 0}
                    isSelected={slot === s.value}
                    dateSelected={!!scheduledDate}
                    loadingSlots={loadingSlots}
                    onClick={() => setSlot(s.value)}
                  />
                ))}
              </div>
              {!scheduledDate && (
                <p className="text-xs text-gray-400 mt-2 text-center">Select a date above to see slot availability</p>
              )}
            </div>

            {/* Selected slot summary */}
            {slot && scheduledDate && !loadingSlots && (
              <div className={`rounded-xl px-4 py-3 text-sm border ${
                selectedSlotCount >= HARD_CAP ? 'bg-red-50 border-red-200' :
                selectedSlotCount >= SOFT_CAP ? 'bg-amber-50 border-amber-200' :
                'bg-emerald-50 border-emerald-200'
              }`}>
                <p className={`font-semibold ${selectedSlotCount >= HARD_CAP ? 'text-red-700' : selectedSlotCount >= SOFT_CAP ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {selectedSlotCount >= HARD_CAP
                    ? `⛔ Slot full — ${selectedSlotCount}/${HARD_CAP} bookings`
                    : selectedSlotCount >= SOFT_CAP
                    ? `⚠️ Slot busy — ${selectedSlotCount}/${HARD_CAP} bookings`
                    : `✅ Slot available — ${selectedSlotCount}/${HARD_CAP} bookings`}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {SLOTS.find(s => s.value === slot)?.label} · {fmtDate(scheduledDate)}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('service')}>← Back</Button>
              <Button
                loading={loading}
                disabled={!scheduledDate || !slot || (slotCounts[slot] || 0) >= HARD_CAP}
                onClick={handleSubmit}
              >
                {created.length > 0 ? 'Add Another Booking' : 'Create Booking'}
              </Button>
            </div>

            {/* Done button if already created */}
            {created.length > 0 && (
              <div className="flex justify-end">
                <Button variant="secondary" onClick={handleClose}>Done — Close</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
