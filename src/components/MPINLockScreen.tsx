import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../store/authStore';
import { Button } from './ui/Button';

export function MPINLockScreen() {
  const navigate = useNavigate();
  const { user, unlock, logout } = useAuthStore();
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [shaking, setShaking] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (idx: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...pin];
    next[idx] = val;
    setPin(next);
    setError('');
    if (val && idx < 3) {
      inputRefs.current[idx + 1]?.focus();
    }
    // Auto-verify when last digit entered
    if (val && idx === 3) {
      const fullPin = [...next.slice(0, 3), val].join('');
      void verifyPin(fullPin);
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      const next = [...pin];
      if (!next[idx] && idx > 0) {
        next[idx - 1] = '';
        setPin(next);
        inputRefs.current[idx - 1]?.focus();
      } else {
        next[idx] = '';
        setPin(next);
      }
    }
  };

  const verifyPin = async (fullPin?: string) => {
    const entered = fullPin ?? pin.join('');
    if (entered.length < 4) { setError('Enter all 4 digits.'); return; }

    const ok = await authService.verifyMpin(entered);
    if (ok) {
      setError('');
      unlock();
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setPin(['', '', '', '']);
      inputRefs.current[0]?.focus();
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      if (newAttempts >= 5) {
        setError('Too many failed attempts. Please log in again.');
        setTimeout(() => {
          authService.logout();
          logout();
          navigate('/login');
        }, 2000);
      } else {
        setError(`Incorrect MPIN. ${5 - newAttempts} attempt${5 - newAttempts !== 1 ? 's' : ''} remaining.`);
      }
    }
  };

  const handleLogout = () => {
    authService.logout();
    logout();
    navigate('/login');
  };

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-[#1B4FD8] via-[#1e40af] to-[#1e3a8a] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-white/5 rounded-full" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          {/* User avatar */}
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-3 ring-4 ring-white/30">
            {user?.profile_image ? (
              <img src={user.profile_image} alt="" className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-white">
                {user?.name?.charAt(0)?.toUpperCase() || 'C'}
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-white">{user?.name || 'CCO Agent'}</h2>
          <p className="text-blue-200 text-sm mt-0.5">Session locked due to inactivity</p>
        </div>

        <div className={`bg-white rounded-2xl shadow-2xl p-8 ${shaking ? 'animate-[shake_0.5s_ease-in-out]' : ''}`}>
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 rounded-xl mb-3">
              <svg className="w-6 h-6 text-[#1B4FD8]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900">Enter your MPIN</h3>
            <p className="text-sm text-gray-500 mt-1">Enter your 4-digit PIN to continue</p>
          </div>

          {/* PIN dots */}
          <div className="flex gap-3 justify-center mb-2">
            {[0, 1, 2, 3].map((idx) => (
              <input
                key={idx}
                ref={(el) => { inputRefs.current[idx] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={pin[idx]}
                autoFocus={idx === 0}
                onChange={(e) => handleChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                className={`w-14 h-14 text-center text-2xl font-bold border-2 rounded-xl
                  outline-none transition bg-gray-50 focus:bg-white
                  ${error
                    ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                    : 'border-gray-200 focus:border-[#1B4FD8] focus:ring-2 focus:ring-[#1B4FD8]/20'
                  }`}
              />
            ))}
          </div>

          {error && (
            <p className="text-xs text-red-600 text-center mt-2">{error}</p>
          )}

          {/* Verify button (also triggered automatically on last digit) */}
          <Button
            variant="primary"
            size="lg"
            onClick={() => verifyPin()}
            disabled={pin.some((d) => !d)}
            className="w-full mt-6"
          >
            Unlock
          </Button>

          <button
            onClick={handleLogout}
            className="w-full mt-3 text-sm text-gray-500 hover:text-gray-700 transition py-2"
          >
            Sign out and login as different user
          </button>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
