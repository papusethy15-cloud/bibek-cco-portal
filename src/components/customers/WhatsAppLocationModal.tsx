/**
 * WhatsAppLocationModal.tsx
 *
 * CCO pastes a WhatsApp / Google Maps location share URL here.
 * The component:
 *  1. Parses lat/lng from the URL client-side (instant preview)
 *  2. Calls PATCH /customers/{id}/addresses/{addr_id}/geo to save
 *  3. Shows a map preview thumbnail via static Maps embed
 *
 * Supported URL formats:
 *   https://maps.google.com/?q=20.2961,85.8245
 *   https://www.google.com/maps?q=20.2961,85.8245
 *   https://www.google.com/maps/@20.2961,85.8245,17z
 *   https://maps.google.com/maps?ll=20.2961,85.8245
 *
 * Short links (goo.gl / maps.app.goo.gl) cannot be resolved client-side
 * — they're sent raw to the backend which also does the same parse; if the
 * short link redirects we show a helpful message.
 */

import React, { useState, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { AlertBanner } from '../ui/AlertBanner';
import { Spinner } from '../ui/Spinner';
import { customerService } from '../../services/customer.service';
import { CustomerAddress } from '../../types';

// ── URL parser (mirrors backend logic) ───────────────────────────────────────
function extractLatLng(url: string): { lat: number; lng: number } | null {
  const patterns = [
    /[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /\/@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /loc:(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    // WhatsApp sometimes encodes as: https://maps.google.com/?q=lat,lng
    /maps\.google\.com\/\?q=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
  ];
  for (const pat of patterns) {
    const m = url.match(pat);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

function isShortLink(url: string) {
  return url.includes('goo.gl') || url.includes('maps.app.goo.gl');
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  open: boolean;
  onClose: () => void;
  customerId: string;
  address: CustomerAddress;
  onSaved: (lat: number, lng: number) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function WhatsAppLocationModal({ open, onClose, customerId, address, onSaved }: Props) {
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
    } else if (isShortLink(val.trim())) {
      setParsed(null);
      setParseErr('Short link detected. It will be sent to the server for processing.');
    } else if (val.includes('maps') || val.includes('google')) {
      setParsed(null);
      setParseErr('Could not read coordinates from this link. Make sure it is a full Google Maps link (not a short link).');
    } else {
      setParsed(null);
    }
  }, []);

  const handleSave = async () => {
    if (!url.trim()) return;
    setSaving(true);
    setSaveErr('');
    try {
      const res = await customerService.patchAddressGeo(customerId, address.id, {
        whatsapp_url: url.trim(),
        location_source: 'whatsapp',
      });
      const { latitude, longitude } = res;
      onSaved(latitude, longitude);
      handleClose();
    } catch (ex: any) {
      setSaveErr(ex?.response?.data?.detail || 'Failed to save location. Check the URL and try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleManualSave = async () => {
    if (!parsed) return;
    setSaving(true);
    setSaveErr('');
    try {
      await customerService.patchAddressGeo(customerId, address.id, {
        latitude: parsed.lat,
        longitude: parsed.lng,
        location_source: 'whatsapp',
      });
      onSaved(parsed.lat, parsed.lng);
      handleClose();
    } catch (ex: any) {
      setSaveErr(ex?.response?.data?.detail || 'Failed to save location.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setParsed(null);
    setParseErr('');
    setSaveErr('');
    onClose();
  };

  const canSave = url.trim().length > 0;

  return (
    <Modal open={open} onClose={handleClose} title="Paste WhatsApp Location" size="md">
      <div className="space-y-4">

        {/* Instruction banner */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex gap-3">
          <span className="text-2xl flex-shrink-0">💬</span>
          <div className="text-xs text-green-800 leading-relaxed">
            <p className="font-semibold mb-0.5">How to get the link from WhatsApp</p>
            <p>Ask the customer to share their location in WhatsApp → long-press → Copy Link. Then paste it below.</p>
            <p className="mt-1 text-green-600">Also works with any Google Maps link.</p>
          </div>
        </div>

        {/* Address being updated */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Updating location for</p>
          <p className="text-sm font-semibold text-gray-900">{address.label} — {address.address_line1}</p>
          <p className="text-xs text-gray-500">{address.city}{address.pincode ? ` - ${address.pincode}` : ''}</p>
          {address.latitude && address.longitude ? (
            <p className="text-xs text-emerald-600 mt-1 font-medium">
              ✓ Current GPS: {address.latitude.toFixed(5)}, {address.longitude.toFixed(5)}
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
          {parseErr && (
            <p className="text-xs text-amber-600 mt-1">⚠️ {parseErr}</p>
          )}
        </div>

        {/* Parsed preview */}
        {parsed && (
          <div className="rounded-xl overflow-hidden border border-[#1B4FD8]/20 bg-blue-50">
            <div className="px-3 py-2 border-b border-[#1B4FD8]/20 flex items-center gap-2">
              <span className="text-base">📍</span>
              <div>
                <p className="text-xs font-semibold text-[#1B4FD8]">Location parsed successfully</p>
                <p className="text-[11px] text-blue-600 font-mono">
                  {parsed.lat.toFixed(6)}, {parsed.lng.toFixed(6)}
                </p>
              </div>
              <a
                href={`https://www.google.com/maps?q=${parsed.lat},${parsed.lng}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-[11px] text-[#1B4FD8] underline flex-shrink-0"
              >
                Verify on Maps ↗
              </a>
            </div>
            {/* Static map thumbnail */}
            <div className="relative w-full h-32 bg-gray-100 flex items-center justify-center">
              <img
                src={`https://maps.googleapis.com/maps/api/staticmap?center=${parsed.lat},${parsed.lng}&zoom=15&size=600x200&markers=color:red%7C${parsed.lat},${parsed.lng}&key=AIzaSyD-PLACEHOLDER`}
                alt="map preview"
                className="w-full h-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {/* Fallback when API key not set */}
              <div className="absolute inset-0 flex items-center justify-center bg-blue-50">
                <div className="text-center">
                  <div className="text-3xl">🗺️</div>
                  <p className="text-xs text-blue-600 mt-1">
                    {parsed.lat.toFixed(5)}, {parsed.lng.toFixed(5)}
                  </p>
                  <a
                    href={`https://www.google.com/maps?q=${parsed.lat},${parsed.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-[#1B4FD8] underline mt-0.5 inline-block"
                  >
                    Open in Google Maps
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {saveErr && <AlertBanner type="error" message={saveErr} onClose={() => setSaveErr('')} />}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={parsed ? handleManualSave : handleSave}
            disabled={!canSave || saving}
            className="flex-1 py-2.5 rounded-xl bg-[#1B4FD8] text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {saving ? <><Spinner />Saving…</> : '📍 Save Location'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
