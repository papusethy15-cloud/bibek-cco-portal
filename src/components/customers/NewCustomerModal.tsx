import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { AlertBanner } from '../ui/AlertBanner';
import { customerService } from '../../services/customer.service';
import { Customer } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  prefillMobile: string;
  onCreated: (customer: Customer) => void;
}

export const NewCustomerModal: React.FC<Props> = ({ open, onClose, prefillMobile, onCreated }) => {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState(prefillMobile);
  const [email, setEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (open) {
      setMobile(prefillMobile);
      setName(''); setEmail(''); setAddressLine1(''); setCity(''); setState(''); setPincode('');
      setError('');
    }
  }, [open, prefillMobile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    if (!name.trim()) { setError('Customer name is required.'); return; }
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      setError('Enter a valid 10-digit Indian mobile number (starts with 6-9).');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const customer = await customerService.create({ name: name.trim(), mobile: cleanMobile, email: email.trim() || undefined });

      // Add default address if provided — CCO can also skip and add it later
      if (addressLine1.trim() && city.trim() && state.trim() && pincode.trim()) {
        await customerService.addAddress(customer.id, {
          label: 'Home',
          address_line1: addressLine1.trim(),
          city: city.trim(),
          state: state.trim(),
          pincode: pincode.trim(),
          is_default: true,
        });
      }

      onCreated(customer);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Could not register customer. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Register new customer" size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        <div className="grid grid-cols-2 gap-4">
          <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Customer full name" />
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Mobile number <span className="text-red-500">*</span></label>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 focus-within:ring-2 focus-within:ring-blue-500 transition">
              <span className="px-3 flex items-center bg-gray-50 text-gray-500 text-sm border-r border-gray-200 select-none font-medium">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="9XXXXXXXXX"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="flex-1 px-3 py-2.5 text-sm outline-none"
                required
              />
            </div>
          </div>
        </div>
        <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-3">Default address (optional — can add later)</p>
          <div className="flex flex-col gap-3">
            <Input label="Address line" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} placeholder="House no, street, area" />
            <div className="grid grid-cols-3 gap-3">
              <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
              <Input label="State" value={state} onChange={(e) => setState(e.target.value)} />
              <Input label="Pincode" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Register customer</Button>
        </div>
      </form>
    </Modal>
  );
};
