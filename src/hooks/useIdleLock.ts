import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { authService } from '../services/auth.service';

// Lock screen after 10 minutes of no mouse/keyboard/touch activity
const IDLE_MS = 10 * 60 * 1000;

export function useIdleLock() {
  const { token, mpinSet, isLocked, lock, updateActivity, logout } = useAuthStore();
  const timerRef  = useRef<ReturnType<typeof setTimeout>>();
  const sessionRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Idle-lock timer — resets on every user interaction ────────────────────
  const resetTimer = () => {
    updateActivity();
    clearTimeout(timerRef.current);
    if (token && mpinSet && !isLocked) {
      timerRef.current = setTimeout(() => {
        lock();
      }, IDLE_MS);
    }
  };

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      clearTimeout(timerRef.current);
    };
  }, [token, mpinSet, isLocked]);

  // ── Hard 24-hour session expiry — timed from the login stamp ─────────────
  // Uses authService.msUntilSessionExpiry() so the timer fires exactly
  // when the 24-hour window closes, regardless of what time the CCO logged in.
  // A CCO who logs in at 14:00 gets logged out at 14:00 the next day,
  // not at midnight.
  useEffect(() => {
    if (!token) return;

    const ms = authService.msUntilSessionExpiry();
    if (ms <= 0) {
      // Session already expired (e.g. page reloaded after 24h)
      authService.logout();
      logout();
      window.location.href = '/login';
      return;
    }

    sessionRef.current = setTimeout(() => {
      authService.logout();
      logout();
      window.location.href = '/login';
    }, ms);

    return () => clearTimeout(sessionRef.current);
  }, [token]);
}
