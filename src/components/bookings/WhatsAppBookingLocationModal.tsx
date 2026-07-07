/**
 * WhatsAppBookingLocationModal.tsx
 *
 * Used inside BookingDetailPanel — CCO pastes a WhatsApp / Google Maps
 * share URL to update the GPS coordinates on the booking's address.
 * This ensures the technician's EN_ROUTE navigation shows the correct pin.
 */
import React, { useState, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { AlertBanner } from '../ui/AlertBanner';
import { Spinner } from '../ui/Spinner';
import { bookingService } from '../../services/booking.service';
import { Booking } from '../../types';

function extractLatLng(url: string): { lat: number; lng: number } | null {
  const patterns = [
    /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /\/@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /loc:(-?\d+\.?\d*),(-?\d+\.?\d*)/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
  }
  return null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  booking: Booking;
  onSaved: (lat: number, lng: number) => void;
}

export function WhatsAppBookingLocationModal({ open, onClose, booking, onSaved }: Props) {
  const [url, setUrl] = useState('');
  const [parsed, setParsed] = useState<{ lat: number; lng: number } | null>(null);
  const [parseErr, setParseErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const handleUrlChange = useCallback((val: string) => {
    setUrl(val);
    setParseErr('');
    setSaveErr('');
    if (!val.trim()) { setParsed(null); return; }
    const result = extractLatLng(val.trim());
    if (result) {
      setParsed(result);
    } else if (val.includes('goo.gl') || val.includes('maps.app.goo.gl')) {
      setParsed(null);
      setParseErr('Short link detected — will be sent to server for processing.');
    } else if (val.includes('maps') || val.includes('google')) {
      setParsed(null);
      setParseErr('Could not read coordinates. Use a full Google Maps link (not a short link).');
    } else {
      setParsed(null);
    }
  }, []);

  const handleSave = async () => {
    if (!url.trim()) return;
    setSaving(true);
    setSaveErr('');
    try {
      const payload = parsed
        ? { latitude: parsed.lat, longitude: parsed.lng, location_source: 'whatsapp' }
        : { whatsapp_url: url.trim(), location_source: 'whatsapp' };
      const res = await bookingService.patchBookingAddressGeo(booking.id, payload);
      onSaved(res.latitude, res.longitude);
      handleClose();
    } catch (ex: any) {
      setSaveErr(ex?.response?.data?.detail || 'Failed to save location.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setUrl(''); setParsed(null); setParseErr(''); setSaveErr('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Paste WhatsApp Location for Booking" size="md">
      <div className="space-y-4">

        {/* Instruction */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex gap-3">
          <span className="text-2xl flex-shrink-0">💬</span>
          <div className="text-xs text-green-800 leading-relaxed">
            <p className="font-semibold mb-0.5">How to get the link from WhatsApp</p>
            <p>Customer shares location in WhatsApp → long-press → Copy Link. Paste below.</p>
            <p className="mt-1 text-green-600">Technician's navigation will use this pin when going EN_ROUTE.</p>
          </div>
        </div>

        {/* Booking info */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Updating location for</p>
          <p className="text-sm font-semibold text-gray-900">{booking.booking_number}</p>
          <p className="text-xs text-gray-500">{booking.address_line}{booking.city ? `, ${booking.city}` : ''}</p>
          {(booking as any).address_latitude && (booking as any).address_longitude ? (
            <p className="text-xs text-emerald-600 mt-1 font-medium">
              ✓ Current GPS: {(booking as any).address_latitude?.toFixed(5)}, {(booking as any).address_longitude?.toFixed(5)}
            </p>
          ) : (
            <p className="text-xs text-amber-600 mt-1 font-medium">⚠️ No GPS saved yet</p>
          )}
        </div>

        {/* URL input */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            WhatsApp / Google Maps location link
          </label>
          <textarea
            rows={3}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]/30 focus:border-[#1B4FD8] placeholder-gray-300"
            placeholder="https://maps.google.com/?q=20.2961,85.8245"
            value={url}
            onChange={e => handleUrlChange(e.target.value)}
          />
          {parseErr && <p className="text-xs text-amber-600 mt-1">⚠️ {parseErr}</p>}
        </div>

        {/* Parsed preview */}
        {parsed && (
          <div className="rounded-xl border border-[#1B4FD8]/20 bg-blue-50 p-3 flex items-center gap-3">
            <span className="text-xl">📍</span>
            <div>
              <p className="text-xs font-semibold text-[#1B4FD8]">Location parsed</p>
              <p className="text-[11px] text-blue-600 font-mono">{parsed.lat.toFixed(6)}, {parsed.lng.toFixed(6)}</p>
            </div>
            <a
              href={`https://www.google.com/maps?q=${parsed.lat},${parsed.lng}`}
              target="_blank" rel="noreferrer"
              className="ml-auto text-[11px] text-[#1B4FD8] underline"
            >
              Verify ↗
            </a>
          </div>
        )}

        {saveErr && <AlertBanner type="error" message={saveErr} onClose={() => setSaveErr('')} />}

        <div className="flex gap-2 pt-1">
          <button onClick={handleClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!url.trim() || saving}
            className="flex-1 py-2.5 rounded-xl bg-[#1B4FD8] text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {saving ? <><Spinner />Saving…</> : '📍 Save Location'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
