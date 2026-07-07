/**
 * ProfilePage.tsx — Advanced CCO Profile
 *
 * Features:
 *  - Full profile card with avatar, editable name/email/city
 *  - Document viewer (ID proof, address proof)
 *  - Account stats (role badge, join date, verification status)
 *  - MPIN change flow (step wizard) using per-user /settings/cco/mpin/* endpoints
 *  - Session & security panel
 *  - Sign out
 */

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { Spinner } from '../components/ui/Spinner';
import { AlertBanner } from '../components/ui/AlertBanner';
import api from '../services/api';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    CCO:        { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Customer Care Officer' },
    ADMIN:      { bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Administrator' },
    SUPER_ADMIN:{ bg: 'bg-red-100',    text: 'text-red-700',    label: 'Super Admin' },
  };
  const c = map[role] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: role };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value || '—'}</span>
    </div>
  );
}

function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="flex gap-3 justify-center my-3">
      {Array.from({ length }).map((_, i) => (
        <div
          key={i}
          className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
            i < filled ? 'bg-[#1B4FD8] border-[#1B4FD8] scale-110' : 'bg-white border-gray-300'
          }`}
        />
      ))}
    </div>
  );
}

function NumPad({ onPress }: { onPress: (digit: string) => void }) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-2.5 max-w-[220px] mx-auto">
      {keys.map((k, i) =>
        k === '' ? <div key={i} /> : (
          <button
            key={i}
            onClick={() => onPress(k)}
            className={`h-12 rounded-xl text-lg font-semibold transition active:scale-95 select-none ${
              k === '⌫'
                ? 'bg-red-50 text-red-500 hover:bg-red-100 border border-red-200'
                : 'bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-200'
            }`}
          >
            {k}
          </button>
        )
      )}
    </div>
  );
}

// ── Document Card ─────────────────────────────────────────────────────────────

function DocCard({ label, type, url }: { label: string; type?: string; url?: string }) {
  if (!url) return null;
  const ext = url.split('.').pop()?.toLowerCase() ?? '';
  const isImage = ['jpg','jpeg','png','webp','gif'].includes(ext);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-[#1B4FD8] hover:bg-blue-50 transition group"
    >
      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-xl flex-shrink-0">
        {isImage ? '🖼️' : '📄'}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-700 group-hover:text-[#1B4FD8]">{label}</p>
        {type && <p className="text-[11px] text-gray-400">{type}</p>}
      </div>
      <svg className="ml-auto w-4 h-4 text-gray-400 group-hover:text-[#1B4FD8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div className={`flex items-center gap-3 p-3.5 rounded-xl border ${color}`}>
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-[11px] text-gray-500 font-medium">{label}</p>
        <p className="text-sm font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type MpinStep = 'idle' | 'verify_current' | 'set_new' | 'confirm_new' | 'done';

export function ProfilePage() {
  const { user, logout } = useAuthStore();

  // Profile state
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCity, setEditCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveErr, setSaveErr] = useState('');

  // MPIN state
  const [mpinStep, setMpinStep] = useState<MpinStep>('idle');
  const mpinSetFromStorage = useAuthStore.getState().mpinSet;
  const [mpinConfigured, setMpinConfigured] = useState(mpinSetFromStorage);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [mpinErr, setMpinErr] = useState('');
  const [mpinLoading, setMpinLoading] = useState(false);
  const [mpinOk, setMpinOk] = useState('');

  // ── Load profile + MPIN status ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [profRes, mpinRes] = await Promise.all([
          api.get('/auth/me'),
          api.get('/settings/cco/mpin/status').catch(() => null),
        ]);
        const prof = (profRes as any).data?.data || (profRes as any).data;
        setProfile(prof);
        setEditName(prof?.name || '');
        setEditEmail(prof?.email || '');
        setEditCity(prof?.city || '');
        if (mpinRes) {
          setMpinConfigured(!!(mpinRes as any).data?.data?.configured);
        }
      } catch {
        setLoadErr('Failed to load profile details. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Save profile ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setSaveErr('');
    setSaveMsg('');
    try {
      await api.put('/auth/me', { name: editName, email: editEmail, city: editCity });
      setProfile((p: any) => ({ ...p, name: editName, email: editEmail, city: editCity }));
      setEditing(false);
      setSaveMsg('Profile updated successfully.');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (ex: any) {
      setSaveErr(ex.response?.data?.detail || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  // ── MPIN handlers ─────────────────────────────────────────────────────────
  const handlePinPress = (digit: string) => {
    setMpinErr('');
    if (mpinStep === 'verify_current') {
      if (digit === '⌫') { setCurrentPin(p => p.slice(0, -1)); return; }
      if (currentPin.length >= 6) return;
      const next = currentPin + digit;
      setCurrentPin(next);
      if (next.length === 6) verifyCurrent(next);
    } else if (mpinStep === 'set_new') {
      if (digit === '⌫') { setNewPin(p => p.slice(0, -1)); return; }
      if (newPin.length >= 6) return;
      setNewPin(p => p + digit);
    } else if (mpinStep === 'confirm_new') {
      if (digit === '⌫') { setConfirmPin(p => p.slice(0, -1)); return; }
      if (confirmPin.length >= 6) return;
      const next = confirmPin + digit;
      setConfirmPin(next);
      if (next.length === 6) submitNewPin(next);
    }
  };

  const verifyCurrent = async (pin: string) => {
    setMpinLoading(true);
    try {
      const res = await api.post('/settings/cco/mpin/verify', { mpin: pin });
      const valid = (res as any).data?.data?.valid;
      if (valid) {
        setMpinStep('set_new');
      } else {
        setMpinErr('Incorrect MPIN. Try again.');
        setCurrentPin('');
      }
    } catch {
      setMpinErr('Verification failed. Try again.');
      setCurrentPin('');
    } finally {
      setMpinLoading(false);
    }
  };

  const submitNewPin = async (confirm: string) => {
    if (confirm !== newPin) {
      setMpinErr("PINs don't match. Try again.");
      setNewPin(''); setConfirmPin('');
      setMpinStep('set_new');
      return;
    }
    setMpinLoading(true);
    try {
      await api.post('/settings/cco/mpin/set', { mpin: newPin });
      setMpinOk('MPIN changed successfully!');
      setMpinStep('done');
      setMpinConfigured(true);
      useAuthStore.getState().setMpinSet(true);
    } catch (ex: any) {
      setMpinErr(ex.response?.data?.detail || 'Failed to set MPIN. Try again.');
      setNewPin(''); setConfirmPin('');
      setMpinStep('set_new');
    } finally {
      setMpinLoading(false);
    }
  };

  const resetMpinFlow = () => {
    setMpinStep('idle'); setCurrentPin(''); setNewPin(''); setConfirmPin('');
    setMpinErr(''); setMpinOk('');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const displayUser = profile || user;
  const stepLabel: Record<string, string> = {
    verify_current: mpinConfigured ? 'Enter your current MPIN' : 'Set a new 6-digit MPIN',
    set_new:        'Enter new 6-digit MPIN',
    confirm_new:    'Confirm new MPIN',
  };
  const activePin = mpinStep === 'verify_current' ? currentPin : mpinStep === 'set_new' ? newPin : confirmPin;

  // Effective steps (skip verify if not yet configured)
  const startMpin = () => {
    if (mpinConfigured) {
      setMpinStep('verify_current');
    } else {
      setMpinStep('set_new');
    }
  };

  const hasDocuments = displayUser?.id_proof_url || displayUser?.address_proof_url;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5 pb-12">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your CCO account details and security settings</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><Spinner /></div>
      ) : loadErr ? (
        <AlertBanner type="error" message={loadErr} onClose={() => setLoadErr('')} />
      ) : (
        <>
          {saveMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 rounded-xl flex items-center gap-2">
              <span>✅</span> {saveMsg}
            </div>
          )}

          {/* ── Profile hero card ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Banner */}
            <div className="bg-gradient-to-r from-[#1B4FD8] to-indigo-500 px-6 pt-8 pb-12 relative">
              <div className="flex items-start gap-5">
                {/* Avatar */}
                <div className="relative">
                  {displayUser?.profile_image ? (
                    <img
                      src={displayUser.profile_image}
                      alt="avatar"
                      className="w-20 h-20 rounded-2xl object-cover border-4 border-white/30 shadow-xl"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-white/20 border-4 border-white/30 flex items-center justify-center text-2xl font-bold text-white shadow-xl">
                      {initials(displayUser?.name || 'CCO')}
                    </div>
                  )}
                  {displayUser?.is_active && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-white" title="Active" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-bold text-white truncate">{displayUser?.name || '—'}</h2>
                  <p className="text-sm text-white/75 mt-0.5 truncate">{displayUser?.email || '—'}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white">
                      {displayUser?.role || 'CCO'}
                    </span>
                    {displayUser?.is_verified && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-400/30 text-emerald-100">
                        ✓ Verified
                      </span>
                    )}
                  </div>
                </div>

                {/* Edit toggle */}
                {!editing ? (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex-shrink-0 mt-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-lg transition"
                  >
                    ✏️ Edit
                  </button>
                ) : (
                  <button
                    onClick={() => { setEditing(false); setSaveErr(''); }}
                    className="flex-shrink-0 mt-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-lg transition"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Stats row — sits cleanly below the banner */}
            <div className="border-b border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
              {[
                { icon: '📅', label: 'Joined', val: formatDate(displayUser?.created_at) },
                { icon: '🏙️', label: 'City',   val: displayUser?.city || 'Not set' },
                { icon: '🔐', label: 'MPIN',    val: mpinConfigured ? 'Configured' : 'Not set' },
              ].map(s => (
                <div key={s.label} className="flex flex-col items-center py-3 px-2 bg-gray-50">
                  <span className="text-base">{s.icon}</span>
                  <p className="text-[10px] text-gray-400 mt-0.5 font-medium">{s.label}</p>
                  <p className="text-xs font-semibold text-gray-800 truncate text-center max-w-full px-1">{s.val}</p>
                </div>
              ))}
            </div>

            {/* Info / Edit fields */}
            <div className="px-6 py-5">
              {!editing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label="Full Name"     value={displayUser?.name} />
                  <InfoRow label="Email Address" value={displayUser?.email} />
                  <InfoRow label="Mobile"        value={displayUser?.mobile} />
                  <InfoRow label="City"          value={displayUser?.city} />
                  <InfoRow label="Role"          value={<RoleBadge role={displayUser?.role || 'CCO'} />} />
                  <InfoRow label="Account Status" value={
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                      displayUser?.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {displayUser?.is_active ? '● Active' : '● Inactive'}
                    </span>
                  } />
                </div>
              ) : (
                <div className="space-y-4">
                  {saveErr && <AlertBanner type="error" message={saveErr} onClose={() => setSaveErr('')} />}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: 'Full Name',  val: editName,  set: setEditName,  type: 'text'  },
                      { label: 'Email',      val: editEmail, set: setEditEmail, type: 'email' },
                      { label: 'City',       val: editCity,  set: setEditCity,  type: 'text'  },
                    ].map(f => (
                      <div key={f.label}>
                        <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                        <input
                          type={f.type}
                          value={f.val}
                          onChange={e => f.set(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1B4FD8]/30 focus:border-[#1B4FD8]"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Mobile (read-only)</label>
                      <input
                        value={displayUser?.mobile || '—'}
                        disabled
                        className="w-full px-3 py-2 text-sm border border-gray-100 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 bg-[#1B4FD8] text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Documents section */}
            {hasDocuments && (
              <div className="border-t border-gray-100 px-6 py-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Verification Documents</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <DocCard label="ID Proof"      type={displayUser?.id_proof_type}      url={displayUser?.id_proof_url} />
                  <DocCard label="Address Proof" type={displayUser?.address_proof_type} url={displayUser?.address_proof_url} />
                </div>
              </div>
            )}
          </div>

          {/* ── MPIN Security card ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">🔐 MPIN Security</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {mpinConfigured
                    ? 'Your 6-digit login PIN is active. Change it periodically.'
                    : 'No MPIN set yet. Set one to enable idle-lock protection.'}
                </p>
              </div>
              {mpinStep !== 'idle' && mpinStep !== 'done' && (
                <button onClick={resetMpinFlow} className="text-xs text-gray-400 hover:text-gray-600 transition">Cancel</button>
              )}
            </div>

            <div className="px-6 py-5">
              {mpinOk && mpinStep === 'done' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800 text-center mb-3">
                  ✅ {mpinOk}
                  <button onClick={resetMpinFlow} className="block mt-2 text-xs text-emerald-700 underline mx-auto">
                    Done
                  </button>
                </div>
              )}
              {mpinErr && <AlertBanner type="error" message={mpinErr} onClose={() => setMpinErr('')} />}

              {mpinStep === 'idle' && (
                <div className="flex flex-col items-center py-4 gap-3">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${
                    mpinConfigured ? 'bg-indigo-50' : 'bg-amber-50'
                  }`}>
                    {mpinConfigured ? '🔐' : '⚠️'}
                  </div>
                  <p className="text-sm text-gray-600 text-center max-w-xs">
                    {mpinConfigured
                      ? 'Your MPIN protects the CCO portal when the session is idle. Change it periodically.'
                      : 'Set an MPIN to enable automatic screen lock when you step away.'}
                  </p>
                  <button
                    onClick={startMpin}
                    className="px-5 py-2.5 bg-[#1B4FD8] text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition"
                  >
                    {mpinConfigured ? 'Change MPIN' : 'Set MPIN'}
                  </button>
                </div>
              )}

              {(['verify_current', 'set_new', 'confirm_new'] as MpinStep[]).includes(mpinStep) && (
                <div className="flex flex-col items-center py-2">
                  {/* Step dots */}
                  {mpinConfigured && (
                    <div className="flex items-center gap-2 mb-5">
                      {(['verify_current','set_new','confirm_new'] as MpinStep[]).map((s, i) => {
                        const steps: MpinStep[] = ['verify_current','set_new','confirm_new'];
                        const current = steps.indexOf(mpinStep as MpinStep);
                        return (
                          <React.Fragment key={s}>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition ${
                              mpinStep === s ? 'border-[#1B4FD8] bg-[#1B4FD8] text-white' :
                              current > i    ? 'border-emerald-500 bg-emerald-500 text-white' :
                                               'border-gray-300 text-gray-400'
                            }`}>{i + 1}</div>
                            {i < 2 && <div className="w-8 h-0.5 bg-gray-200" />}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-sm font-semibold text-gray-800 mb-1">{stepLabel[mpinStep]}</p>
                  {mpinStep === 'set_new' && (
                    <p className="text-xs text-gray-400 mb-1">Choose a 6-digit PIN you will remember</p>
                  )}
                  {mpinStep === 'confirm_new' && newPin.length < 6 && (
                    <button
                      onClick={() => { setMpinStep('set_new'); setConfirmPin(''); }}
                      className="text-xs text-blue-600 mb-1 underline"
                    >
                      Change new PIN
                    </button>
                  )}

                  {mpinLoading ? (
                    <div className="py-8"><Spinner /></div>
                  ) : (
                    <>
                      <PinDots length={6} filled={activePin.length} />
                      <NumPad onPress={handlePinPress} />
                      {mpinStep === 'set_new' && newPin.length === 6 && (
                        <button
                          onClick={() => setMpinStep('confirm_new')}
                          className="mt-4 px-6 py-2.5 bg-[#1B4FD8] text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition"
                        >
                          Continue
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Session & Security card ── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-900">Session & Security</h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StatCard icon="🕐" label="Session expires"      value="Today at 11:59 PM"          color="border-blue-100 bg-blue-50" />
                <StatCard icon="🔒" label="Auto-lock after"      value={mpinConfigured ? "5 min idle" : "Not enabled"} color="border-indigo-100 bg-indigo-50" />
                <StatCard icon="✅" label="Account status"       value={displayUser?.is_active ? "Active" : "Suspended"} color="border-emerald-100 bg-emerald-50" />
                <StatCard icon="📱" label="Logged in as"         value={displayUser?.mobile || '—'}   color="border-gray-100 bg-gray-50" />
              </div>

              <button
                onClick={logout}
                className="mt-2 w-full py-2.5 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 transition flex items-center justify-center gap-2"
              >
                🚪 Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
