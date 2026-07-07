import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';
import { AlertBanner } from '../components/ui/AlertBanner';

// Reusable PIN dot input row
function PinRow({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (idx: number, char: string) => {
    if (!/^\d?$/.test(char)) return;
    const arr = value.padEnd(4, ' ').split('');
    arr[idx] = char || ' ';
    const next = arr.join('').trimEnd();
    onChange(next);
    if (char && idx < 3) inputRefs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      const arr = value.padEnd(4, ' ').split('');
      if (!arr[idx].trim() && idx > 0) {
        arr[idx - 1] = ' ';
        onChange(arr.join('').trimEnd());
        inputRefs.current[idx - 1]?.focus();
      } else {
        arr[idx] = ' ';
        onChange(arr.join('').trimEnd());
      }
    }
  };

  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="flex gap-3 justify-center">
        {[0, 1, 2, 3].map((idx) => (
          <input
            key={idx}
            ref={(el) => { inputRefs.current[idx] = el; }}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={value[idx] || ''}
            autoFocus={autoFocus && idx === 0}
            onChange={(e) => handleChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            className="w-14 h-14 text-center text-2xl font-bold border-2 rounded-xl
              border-gray-200 focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20
              outline-none transition bg-gray-50 focus:bg-white"
          />
        ))}
      </div>
    </div>
  );
}

export function MPINSetupPage() {
  const navigate = useNavigate();
  const { token, setMpinSet, setMpinVerified } = useAuthStore();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // If not logged in, redirect
  useEffect(() => {
    if (!token) navigate('/login');
  }, [token]);

  const handleSetup = async () => {
    setError('');
    if (pin.length !== 4) { setError('Please enter a 4-digit MPIN.'); return; }
    if (confirmPin.length !== 4) { setError('Please confirm your MPIN.'); return; }
    if (pin !== confirmPin) { setError('PINs do not match. Please try again.'); setConfirmPin(''); return; }

    await authService.setupMpin(pin);
    setMpinSet(true);
    setMpinVerified(true);
    setSuccess(true);
    setTimeout(() => navigate('/dashboard'), 1200);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1B4FD8] via-[#1e40af] to-[#1e3a8a] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-white/5 rounded-full" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <svg className="w-9 h-9 text-[#1B4FD8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Set your MPIN</h1>
          <p className="text-blue-200 text-sm mt-1">Used for quick unlock after idle timeout</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {success ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-full mb-3">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">MPIN set successfully!</h3>
              <p className="text-sm text-gray-500 mt-1">Redirecting to dashboard…</p>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Create MPIN</h2>
              <p className="text-sm text-gray-500 mb-6">
                Choose a 4-digit PIN. You'll use this to unlock your session after 5 minutes of inactivity.
              </p>

              {error && (
                <div className="mb-4">
                  <AlertBanner type="error" message={error} onClose={() => setError('')} />
                </div>
              )}

              <div className="space-y-6">
                <PinRow label="Enter MPIN" value={pin} onChange={setPin} autoFocus />
                <PinRow label="Confirm MPIN" value={confirmPin} onChange={setConfirmPin} />
              </div>

              <Button
                variant="primary"
                size="lg"
                onClick={handleSetup}
                disabled={pin.length < 4 || confirmPin.length < 4}
                className="w-full mt-8"
              >
                Set MPIN & Continue
              </Button>

              <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-xs text-amber-700 flex gap-2">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Your MPIN is stored securely on this device. Keep it confidential.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
