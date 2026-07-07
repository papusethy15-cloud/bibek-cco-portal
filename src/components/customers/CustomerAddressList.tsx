/**
 * CustomerAddressList.tsx
 * Full CRUD for customer addresses — add, edit, set-default, delete.
 * Used in CustomerProfileCard (addresses tab) and NewCustomerModal.
 */
import React, { useState } from 'react';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { AlertBanner } from '../ui/AlertBanner';
import { customerService } from '../../services/customer.service';
import { CustomerAddress } from '../../types';
import { WhatsAppLocationModal } from './WhatsAppLocationModal';

interface Props {
  customerId: string;
  addresses: CustomerAddress[];
  loading: boolean;
  onRefresh: () => void;
}

interface AddressForm {
  label: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  is_default: boolean;
}

const EMPTY_FORM: AddressForm = {
  label: 'Home',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  pincode: '',
  is_default: false,
};

const ADDRESS_LABELS = ['Home', 'Work', 'Other'];

function AddressFormModal({
  open,
  onClose,
  initialValues,
  onSave,
  title,
}: {
  open: boolean;
  onClose: () => void;
  initialValues?: AddressForm;
  onSave: (form: AddressForm) => Promise<void>;
  title: string;
}) {
  const [form, setForm] = useState<AddressForm>(initialValues || EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof AddressForm, v: string | boolean) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!form.address_line1.trim() || !form.city.trim() || !form.pincode.trim()) {
      setError('Address line 1, city, and pincode are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save address.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div className="space-y-3">
        {error && <AlertBanner type="error" message={error} onClose={() => setError('')} />}

        {/* Label */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Label</label>
          <div className="flex gap-2">
            {ADDRESS_LABELS.map((l) => (
              <button
                key={l}
                onClick={() => set('label', l)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  form.label === l
                    ? 'bg-[#1B4FD8] text-white border-[#1B4FD8]'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 1 *</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            placeholder="House / Flat / Building"
            value={form.address_line1}
            onChange={(e) => set('address_line1', e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Address Line 2</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            placeholder="Landmark / Area"
            value={form.address_line2}
            onChange={(e) => set('address_line2', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">City *</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
              placeholder="City"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">State</label>
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
              placeholder="State"
              value={form.state}
              onChange={(e) => set('state', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Pincode *</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]"
            placeholder="6-digit pincode"
            maxLength={6}
            value={form.pincode}
            onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))}
          />
        </div>

        {/* Set as default */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => set('is_default', e.target.checked)}
            className="w-4 h-4 rounded text-[#1B4FD8] focus:ring-[#1B4FD8]"
          />
          <span className="text-sm text-gray-700">Set as default address</span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>Save Address</Button>
        </div>
      </div>
    </Modal>
  );
}

export const CustomerAddressList: React.FC<Props> = ({
  customerId,
  addresses,
  loading,
  onRefresh,
}) => {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomerAddress | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [whatsappTarget, setWhatsappTarget] = useState<CustomerAddress | null>(null);
  const [localAddresses, setLocalAddresses] = useState<CustomerAddress[]>(addresses);

  // Keep local copy so we can update lat/lng without full refresh
  React.useEffect(() => { setLocalAddresses(addresses); }, [addresses]);

  const handleAdd = async (form: AddressForm) => {
    await customerService.addAddress(customerId, form);
    onRefresh();
  };

  const handleEdit = async (form: AddressForm) => {
    if (!editTarget) return;
    await customerService.updateAddress(customerId, editTarget.id, form);
    onRefresh();
  };

  const handleSetDefault = async (addr: CustomerAddress) => {
    setSettingDefaultId(addr.id);
    setActionError('');
    try {
      // Use PUT with is_default: true — backend clears other defaults automatically
      await customerService.updateAddress(customerId, addr.id, {
        ...addr,
        is_default: true,
      });
      onRefresh();
    } catch {
      setActionError('Failed to set default. Please try again.');
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleGeoSaved = (addressId: string, lat: number, lng: number) => {
    setLocalAddresses(prev => prev.map(a =>
      a.id === addressId ? { ...a, latitude: lat, longitude: lng } : a
    ));
    setWhatsappTarget(null);
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this address?')) return;
    setDeletingId(id);
    setActionError('');
    try {
      await customerService.deleteAddress(customerId, id);
      onRefresh();
    } catch {
      setActionError('Failed to delete address.');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div className="py-8"><Spinner /></div>;

  return (
    <div className="space-y-3">
      {actionError && (
        <AlertBanner type="error" message={actionError} onClose={() => setActionError('')} />
      )}

      {addresses.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400 mb-3">No saved addresses.</p>
          <Button onClick={() => setAddOpen(true)}>+ Add Address</Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {localAddresses.map((a) => (
              <div
                key={a.id}
                className={`border rounded-xl px-4 py-3 ${
                  a.is_default ? 'border-[#1B4FD8]/30 bg-blue-50/30' : 'border-gray-100'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900">{a.label}</span>
                    {a.is_default && <Badge label="Default" color="green" />}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!a.is_default && (
                      <button
                        onClick={() => handleSetDefault(a)}
                        disabled={settingDefaultId === a.id}
                        className="text-[10px] text-[#1B4FD8] hover:underline font-medium px-1.5 py-0.5 disabled:opacity-50"
                        title="Set as default"
                      >
                        {settingDefaultId === a.id ? '...' : 'Set default'}
                      </button>
                    )}
                    <button
                      onClick={() => setEditTarget(a)}
                      className="text-gray-400 hover:text-gray-700 p-1 rounded-lg transition"
                      title="Edit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(a.id)}
                      disabled={deletingId === a.id}
                      className="text-gray-400 hover:text-red-500 p-1 rounded-lg transition disabled:opacity-50"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600">
                  {a.address_line1}
                  {a.address_line2 ? `, ${a.address_line2}` : ''}
                </p>
                <p className="text-sm text-gray-500">
                  {a.city}
                  {a.state ? `, ${a.state}` : ''}
                  {a.pincode ? ` - ${a.pincode}` : ''}
                </p>
                {/* GPS status + WhatsApp paste button */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                  {a.latitude && a.longitude ? (
                    <a
                      href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
                      target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium hover:underline"
                    >
                      <span>📍</span>
                      {a.latitude.toFixed(4)}, {a.longitude.toFixed(4)}
                    </a>
                  ) : (
                    <span className="text-[11px] text-amber-500 font-medium">⚠️ No GPS</span>
                  )}
                  <button
                    onClick={() => setWhatsappTarget(a)}
                    className="flex items-center gap-1 text-[11px] text-[#1B4FD8] hover:text-blue-800 font-semibold px-2 py-1 rounded-lg hover:bg-blue-50 transition"
                    title="Paste WhatsApp location link"
                  >
                    💬 WhatsApp Location
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 text-sm text-[#1B4FD8] hover:underline font-medium"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add another address
          </button>
        </>
      )}

      {/* Add modal */}
      <AddressFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={handleAdd}
        title="Add New Address"
      />

      {/* WhatsApp Location Modal */}
      {whatsappTarget && (
        <WhatsAppLocationModal
          open={!!whatsappTarget}
          onClose={() => setWhatsappTarget(null)}
          customerId={customerId}
          address={whatsappTarget}
          onSaved={(lat, lng) => handleGeoSaved(whatsappTarget.id, lat, lng)}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <AddressFormModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          initialValues={{
            label: editTarget.label,
            address_line1: editTarget.address_line1,
            address_line2: editTarget.address_line2 || '',
            city: editTarget.city,
            state: editTarget.state || '',
            pincode: editTarget.pincode,
            is_default: editTarget.is_default,
          }}
          onSave={handleEdit}
          title={`Edit Address — ${editTarget.label}`}
        />
      )}
    </div>
  );
};
