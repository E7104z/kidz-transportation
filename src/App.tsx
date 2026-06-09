import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Apply from './pages/public/Apply';
import SignContract from './pages/public/SignContract';
import DriverSignContract from './pages/public/DriverSignContract';
import HealthPage from './pages/public/Health';
import Login from './pages/auth/Login';
import AuthAction from './pages/auth/AuthAction';
import Dashboard from './pages/admin/Dashboard';
import PipelineKanban from './pages/admin/PipelineKanban';
import Clients from './pages/admin/Clients';
import Drivers from './pages/admin/Drivers';
import Payroll from './pages/admin/Payroll';
import Import from './pages/admin/Import';
import Dispatch from './pages/admin/Dispatch';
import AdminBilling from './pages/admin/AdminBilling';
import DriverDashboard from './pages/driver/DriverDashboard';
import DriverSetup from './pages/driver/DriverSetup';
import AcceptDriverInvite from './pages/driver/AcceptDriverInvite';
import DriverOnboarding from './pages/driver/DriverOnboarding';
import DriverProfile from './pages/driver/DriverProfile';
import DriverHistory from './pages/driver/DriverHistory';
import ParentSetup from './pages/parent/ParentSetup';
import ParentDashboard from './pages/parent/ParentDashboard';
import MyChildren from './pages/parent/MyChildren';
import MyServices from './pages/parent/MyServices';
import LiveTracking from './pages/parent/LiveTracking';
import ParentProfile from './pages/parent/ParentProfile';
import Billing from './pages/parent/Billing';
import AdminGuard from './guards/AdminGuard';
import DriverGuard from './guards/DriverGuard';
import ParentGuard from './guards/ParentGuard';
import AdminLayout from './components/AdminLayout';
import ParentLayout from './components/ParentLayout';
import DriverLayout from './components/DriverLayout';
import { ParentDataProvider } from './context/ParentDataContext';
import { ImpersonationProvider } from './context/ImpersonationContext';
import ImpersonationBanner from './components/ImpersonationBanner';


function App() {
  return (
    <ImpersonationProvider>
      <ImpersonationBanner />
      <>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/action" element={<AuthAction />} />
          <Route path="/driver/setup" element={<DriverSetup />} />
          <Route path="/driver/accept-invite" element={<AcceptDriverInvite />} />
          <Route
            path="/driver/onboarding"
            element={
              <DriverGuard>
                <DriverOnboarding />
              </DriverGuard>
            }
          />
          <Route path="/parent/setup" element={<ParentSetup />} />
          <Route
            path="/admin/*"
            element={
              <AdminGuard>
                <AdminLayout>
                  <Routes>
                    <Route path="" element={<Navigate to="dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="dispatch" element={<Dispatch />} />
                    <Route path="pipeline" element={<PipelineKanban />} />
                    <Route path="clients" element={<Clients />} />
                    <Route path="drivers" element={<Drivers />} />
                    <Route path="payroll"   element={<Payroll />} />
                    <Route path="billing"   element={<AdminBilling />} />
                    <Route path="import"    element={<Import />} />
                  </Routes>
                </AdminLayout>
              </AdminGuard>
            }
          />
          <Route
            path="/driver"
            element={
              <DriverGuard>
                <DriverLayout />
              </DriverGuard>
            }
          >
            <Route index             element={<Navigate to="today" replace />} />
            <Route path="today"   element={<DriverDashboard />} />
            <Route path="history" element={<DriverHistory />} />
            <Route path="profile" element={<DriverProfile />} />
            <Route path="*"       element={<Navigate to="today" replace />} />
          </Route>
          <Route
            path="/parent/*"
            element={
              <ParentGuard>
                <ParentDataProvider>
                  <ParentLayout>
                    <Routes>
                      <Route path="" element={<Navigate to="dashboard" replace />} />
                      <Route path="dashboard" element={<ParentDashboard />} />
                      <Route path="children" element={<MyChildren />} />
                      <Route path="services" element={<MyServices />} />
                      <Route path="tracking" element={<LiveTracking />} />
                      <Route path="billing" element={<Billing />} />
                      <Route path="profile" element={<ParentProfile />} />
                    </Routes>
                  </ParentLayout>
                </ParentDataProvider>
              </ParentGuard>
            }
          />
          <Route path="/apply" element={<Apply />} />
          <Route path="/sign/:contractId" element={<SignContract />} />
          <Route path="/driver-sign/:contractId" element={<DriverSignContract />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
      </>
    </ImpersonationProvider>
  );
}

export default App;
