import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useIdleLock } from './hooks/useIdleLock';

// Layout
import { MainLayout } from './components/layout/MainLayout';
import { MPINLockScreen } from './components/MPINLockScreen';

// Auth pages
import { LoginPage } from './pages/LoginPage';
import { MPINSetupPage } from './pages/MPINSetupPage';

// Main pages
import { DashboardPage } from './pages/DashboardPage';
import { CustomersPage } from './pages/CustomersPage';
import { BookingsPage } from './pages/BookingsPage';
import { TechniciansPage } from './pages/TechniciansPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { EscalationsPage } from './pages/EscalationsPage';
import { SchedulerPage } from './pages/SchedulerPage';
import { CallLogPage } from './pages/CallLogPage';
import { CallbackRequestsPage } from './pages/CallbackRequestsPage';
import { ProfilePage } from './pages/ProfilePage';

// ─── Protected route wrapper ──────────────────────────────────────────────────
function ProtectedRoute() {
  const { token, mpinSet, mpinVerified, isLocked } = useAuthStore();
  useIdleLock();

  if (!token) return <Navigate to="/login" replace />;
  if (!mpinSet) return <Navigate to="/mpin-setup" replace />;

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
      <Routes>
        {/* Public */}
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/mpin-setup" element={<MPINSetupPage />} />

        {/* Protected */}
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/technicians" element={<TechniciansPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/escalations" element={<EscalationsPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/call-log" element={<CallLogPage />} />
          <Route path="/callback-requests" element={<CallbackRequestsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>

        {/* Default */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
