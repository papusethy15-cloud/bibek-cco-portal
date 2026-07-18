import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { authService } from '../services/auth.service';

// ── Idle → Logout config ─────────────────────────────────────────────────────
const IDLE_MS       = 15 * 60 * 1000;  // 15 min no activity → start countdown
const COUNTDOWN_SEC = 60;               // 60s countdown before auto-logout

// ── Shared idle countdown state (consumed by MainLayout banner) ──────────────
export interface IdleCountdownState {
  active:      boolean;
  secondsLeft: number;
}

let _listener: ((s: IdleCountdownState) => void) | null = null;

/** Called by MainLayout to subscribe to countdown state changes. */
export function setIdleCountdownListener(fn: ((s: IdleCountdownState) => void) | null) {
  _listener = fn;
}

function _emit(state: IdleCountdownState) {
  _listener?.(state);
}

// ── Hard 24h session expiry (unchanged) ─────────────────────────────────────
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

export function useIdleLock() {
  const { token, mpinSet, isLocked, lock, updateActivity, logout } = useAuthStore();

  // Refs so timeout closures always read the latest values
  const idleTimerRef     = useRef<ReturnType<typeof setTimeout>>();
  const countdownRef     = useRef<ReturnType<typeof setInterval>>();
  const secondsLeftRef   = useRef(COUNTDOWN_SEC);
  const countdownActive  = useRef(false);
  const sessionTimerRef  = useRef<ReturnType<typeof setTimeout>>();

  // ── Perform idle logout ────────────────────────────────────────────────────
  const doIdleLogout = async () => {
    clearInterval(countdownRef.current);
    countdownActive.current = false;
    _emit({ active: false, secondsLeft: 0 });
    await authService.checkOut();
    authService.logout();
    logout();
    window.location.href = '/login';
  };

  // ── Start the 60s countdown ───────────────────────────────────────────────
  const startCountdown = () => {
    if (countdownActive.current) return;   // already counting down
    countdownActive.current = true;
    secondsLeftRef.current  = COUNTDOWN_SEC;
    _emit({ active: true, secondsLeft: COUNTDOWN_SEC });

    countdownRef.current = setInterval(() => {
      secondsLeftRef.current -= 1;
      _emit({ active: true, secondsLeft: secondsLeftRef.current });
      if (secondsLeftRef.current <= 0) {
        clearInterval(countdownRef.current);
        doIdleLogout();
      }
    }, 1_000);
  };

  // ── Cancel countdown (user clicked "Stay Active") ─────────────────────────
  const cancelCountdown = () => {
    if (!countdownActive.current) return;
    clearInterval(countdownRef.current);
    countdownActive.current = false;
    _emit({ active: false, secondsLeft: 0 });
  };

  // ── Reset the 15-min idle timer on any activity ───────────────────────────
  const resetIdleTimer = () => {
    updateActivity();

    // If countdown is already running, cancel it (user is back)
    cancelCountdown();

    clearTimeout(idleTimerRef.current);
    if (token && mpinSet && !isLocked) {
      idleTimerRef.current = setTimeout(() => {
        // CCO has been idle 15 min — start the 60s countdown
        startCountdown();
      }, IDLE_MS);
    }
  };

  // ── Attach DOM activity listeners ─────────────────────────────────────────
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, resetIdleTimer));
    resetIdleTimer();
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetIdleTimer));
      clearTimeout(idleTimerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [token, mpinSet, isLocked]);

  // ── Hard 24h session expiry ───────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    const ms = authService.msUntilSessionExpiry();
    if (ms <= 0) {
      authService.logout();
      logout();
      window.location.href = '/login';
      return;
    }

    sessionTimerRef.current = setTimeout(async () => {
      await authService.checkOut();
      authService.logout();
      logout();
      window.location.href = '/login';
    }, ms);

    return () => clearTimeout(sessionTimerRef.current);
  }, [token]);
}
