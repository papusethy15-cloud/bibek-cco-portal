import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useIdleLock } from './hooks/useIdleLock';
import { authService } from './services/auth.service';

// Layout
import { MainLayout } from './components/layout/MainLayout';
import { MPINLockScreen } from './components/MPINLockScreen';

// Auth pages
import { LoginPage }     from './pages/LoginPage';
import { MPINSetupPage } from './pages/MPINSetupPage';

// Main pages
import { DashboardPage }        from './pages/DashboardPage';
import { CustomersPage }        from './pages/CustomersPage';
import { BookingsPage }         from './pages/BookingsPage';
import { TechniciansPage }      from './pages/TechniciansPage';
import { PaymentsPage }         from './pages/PaymentsPage';
import { EscalationsPage }      from './pages/EscalationsPage';
import { SchedulerPage }        from './pages/SchedulerPage';
import { CallLogPage }          from './pages/CallLogPage';
import { CallbackRequestsPage } from './pages/CallbackRequestsPage';
import { ProfilePage }          from './pages/ProfilePage';
import { SalarySlipsPage }     from './pages/SalarySlipsPage';

// ─── Boot gate ────────────────────────────────────────────────────────────────
// Shown while we validate the stored token/session before rendering anything.
// This prevents the 401 cascade: pages mount, fire API calls, all get 401
// before the redirect to /login happens.
function BootGate({ children }: { children: React.ReactNode }) {
  const { token, bootChecked, logout, setBootChecked } = useAuthStore();

  useEffect(() => {
    // Already confirmed OK or no token — nothing to check
    if (bootChecked || !token) { setBootChecked(); return; }

    // Session expired (checked synchronously in authStore init, but double-check)
    if (authService.isSessionExpired()) {
      logout();
      setBootChecked();
      return;
    }

    // Token exists and session is valid — mark boot done
    setBootChecked();
  }, []); // run once on mount

  // Show a minimal spinner while we confirm the session
  if (!bootChecked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1B4FD8] to-[#1e3a8a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          <p className="text-white/70 text-sm">Loading CCO Portal…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// ─── Protected route wrapper ──────────────────────────────────────────────────
function ProtectedRoute() {
  const { token, mpinSet, mpinVerified, isLocked } = useAuthStore();
  useIdleLock();

  if (!token) return <Navigate to="/login" replace />;
  if (!mpinSet) return <Navigate to="/mpin-setup" replace />;

  // Show lock screen — but render ONLY the lock screen, not the child page.
  // This is what previously caused the 401 cascade: the child page mounted
  // behind the lock screen and fired API calls with an expired/missing token.
  if (isLocked || !mpinVerified) {
    return <MPINLockScreen />;
  }

  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  );
}

// ─── Public route wrapper ─────────────────────────────────────────────────────
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { token, mpinSet, mpinVerified } = useAuthStore();
  if (token && mpinSet && mpinVerified) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <BootGate>
        <Routes>
          {/* Public */}
          <Route path="/login"      element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/mpin-setup" element={<MPINSetupPage />} />

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard"         element={<DashboardPage />} />
            <Route path="/customers"         element={<CustomersPage />} />
            <Route path="/bookings"          element={<BookingsPage />} />
            <Route path="/technicians"       element={<TechniciansPage />} />
            <Route path="/payments"          element={<PaymentsPage />} />
            <Route path="/escalations"       element={<EscalationsPage />} />
            <Route path="/scheduler"         element={<SchedulerPage />} />
            <Route path="/call-log"          element={<CallLogPage />} />
            <Route path="/callback-requests" element={<CallbackRequestsPage />} />
            <Route path="/profile"           element={<ProfilePage />} />
            <Route path="/salary-slips"     element={<SalarySlipsPage />} />
          </Route>

          {/* Default */}
          <Route path="/"  element={<Navigate to="/dashboard" replace />} />
          <Route path="*"  element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BootGate>
    </BrowserRouter>
  );
}
