import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { customerService } from '../../services/customer.service';
import { bookingService } from '../../services/booking.service';
import api from '../../services/api';
import { Customer, CustomerAddress } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (booking: any) => void;
  prefillCustomer?: Customer | null;
  /** For "Repeat booking" flow — pre-selects service, brand, model */
  prefillServiceId?: string;
  prefillBrand?: string;
  prefillModel?: string;
}

interface ServiceOption { id: string; name: string; base_price: number; }
interface DomainOption { id: string; name: string; }

const SLOTS = [
  { value: '08:00-10:00', label: '8:00 – 10:00 AM' },
  { value: '10:00-12:00', label: '10:00 AM – 12:00 PM' },
  { value: '12:00-14:00', label: '12:00 – 2:00 PM' },
  { value: '14:00-16:00', label: '2:00 – 4:00 PM' },
  { value: '16:00-18:00', label: '4:00 – 6:00 PM' },
  { value: '18:00-20:00', label: '6:00 – 8:00 PM' },
];

export function NewBookingModal({ open, onClose, onCreated, prefillCustomer, prefillServiceId, prefillBrand, prefillModel }: Props) {
  const [step, setStep] = useState<'customer' | 'service' | 'schedule'>('customer');
  const [mobile, setMobile] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(prefillCustomer || null);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addressId, setAddressId] = useState('');
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [domainId, setDomainId] = useState('');
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [slot, setSlot] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (prefillCustomer) {
      setCustomer(prefillCustomer);
      setStep('service');
      loadCustomerAddresses(prefillCustomer.id);
    }
    if (prefillBrand) setBrand(prefillBrand);
    if (prefillModel) setModel(prefillModel);
    loadDomains();
  }, [prefillCustomer, prefillServiceId, prefillBrand, prefillModel, open]);

  const loadDomains = async () => {
    try {
      const res = await api.get<any>('/domains?limit=50');
      const items = res.data?.data?.items || res.data?.data || [];
      setDomains(items);
    } catch {}
  };

  const loadCustomerAddresses = async (customerId: string) => {
    try {
      const addrs = await customerService.getAddresses(customerId);
      setAddresses(addrs);
      const def = addrs.find(a => a.is_default);
      if (def) setAddressId(def.id);
    } catch {}
  };

  const loadServices = async (dId: string) => {
    try {
      const res = await api.get<any>(`/services?domain_id=${dId}&limit=100`);
      const items = res.data?.data?.items || res.data?.data || [];
      setServices(items);
      return items as ServiceOption[];
    } catch { return [] as ServiceOption[]; }
  };

  // When repeating a booking — fetch service by ID to get its domain, then populate the list
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
          const items = await loadServices(dId);
          const match = items.find((s: ServiceOption) => s.id === prefillServiceId);
          if (match) setServiceId(prefillServiceId);
        }
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillServiceId, open]);

  const handleSearchCustomer = async () => {
    if (!mobile || mobile.length < 10) return;
    setSearching(true); setError('');
    try {
      const found = await customerService.searchByMobile(mobile);
      if (found) {
        setCustomer(found);
        await loadCustomerAddresses(found.id);
        setStep('service');
      } else {
        setError('Customer not found. Please register the customer first from the Customers page.');
      }
    } finally {
      setSearching(false);
    }
  };

  const handleDomainChange = (dId: string) => {
    setDomainId(dId);
    setServiceId('');
    setServices([]);
    if (dId) loadServices(dId);
  };

  const handleSubmit = async () => {
    if (!customer || !serviceId || !scheduledDate || !slot) {
      setError('Please fill all required fields.'); return;
    }
    setLoading(true); setError('');
    try {
      const booking = await bookingService.create({
        customer_id: customer.id,
        service_id: serviceId,
        address_id: addressId || undefined,
        appliance_brand: brand || undefined,
        appliance_model: model || undefined,
        scheduled_date: scheduledDate,
        scheduled_slot: slot,
        notes: notes || undefined,
        priority,
        source: 'CALL_CENTER',
      } as any);
      onCreated(booking);
      handleClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to create booking.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('customer'); setMobile(''); setCustomer(prefillCustomer || null);
    setDomainId(''); setServiceId(''); setBrand(''); setModel('');
    setScheduledDate(''); setSlot(''); setNotes(''); setError('');
    setAddresses([]); setAddressId('');
    onClose();
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <Modal open={open} onClose={handleClose} title="New Booking" size="lg">
      <div className="space-y-5">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm">
          {['customer', 'service', 'schedule'].map((s, i) => (
            <React.Fragment key={s}>
              <span className={`px-3 py-1 rounded-full font-medium capitalize ${
                step === s ? 'bg-[#1B4FD8] text-white' :
                ['customer', 'service', 'schedule'].indexOf(step) > i ? 'bg-emerald-100 text-emerald-700' :
                'bg-gray-100 text-gray-400'
              }`}>{i + 1}. {s}</span>
              {i < 2 && <span className="text-gray-300">→</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Customer */}
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
              />
              <Button onClick={handleSearchCustomer} loading={searching} disabled={mobile.length < 10}>
                Search
              </Button>
            </div>
          </div>
        )}

        {/* Customer confirmed */}
        {customer && step !== 'customer' && (
          <div className="bg-blue-50 rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">{customer.name}</p>
              <p className="text-xs text-gray-500">{customer.mobile} · {customer.customer_code}</p>
            </div>
            <button onClick={() => { setCustomer(null); setStep('customer'); }} className="text-xs text-gray-400 hover:text-red-500">Change</button>
          </div>
        )}

        {/* Step 2: Service */}
        {step === 'service' && (
          <div className="space-y-4">
            {addresses.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Service Address</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={addressId}
                  onChange={(e) => setAddressId(e.target.value)}
                >
                  <option value="">Select address</option>
                  {addresses.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.address_line1}, {a.city}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {prefillServiceId && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs text-violet-800">
                🔁 <b>Repeat booking</b> — same service pre-selected from previous booking. You can change the category/service below if needed.
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Service Category *</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                value={domainId}
                onChange={(e) => handleDomainChange(e.target.value)}
              >
                <option value="">Select category...</option>
                {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {services.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Service *</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  <option value="">Select service...</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name} — ₹{s.base_price}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Appliance Brand</label>
                <Input placeholder="e.g. Samsung" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Model</label>
                <Input placeholder="e.g. WW70J5" value={model} onChange={(e) => setModel(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                value={priority} onChange={(e) => setPriority(e.target.value)}
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('customer')}>Back</Button>
              <Button disabled={!serviceId} onClick={() => setStep('schedule')}>Next: Schedule</Button>
            </div>
          </div>
        )}

        {/* Step 3: Schedule */}
        {step === 'schedule' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date *</label>
                <input
                  type="date"
                  min={today}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Time Slot *</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
                  value={slot}
                  onChange={(e) => setSlot(e.target.value)}
                >
                  <option value="">Select slot...</option>
                  {SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes / Problem Description</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8] resize-none"
                rows={3}
                placeholder="Describe the customer's issue..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setStep('service')}>Back</Button>
              <Button loading={loading} disabled={!scheduledDate || !slot} onClick={handleSubmit}>
                Create Booking
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
