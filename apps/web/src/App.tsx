import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/Login';
import IncidentBoard from './pages/IncidentBoard';
import IncidentDetail from './pages/IncidentDetail';
import AdminPanel from './pages/AdminPanel';
import { MonitoringDashboard } from './pages/MonitoringDashboard';
import { StatusPage } from './pages/StatusPage';

function Nav() {
  const { role, userId, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  if (!userId) return null;

  return (
    <nav>
      <span className="brand">OnCallX</span>
      <NavLink to="/incidents" className={({ isActive }) => isActive ? 'active' : ''}>Incidents</NavLink>
      <NavLink to="/monitoring" className={({ isActive }) => isActive ? 'active' : ''}>Monitoring</NavLink>
      {role === 'ADMIN' && (
        <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>Admin</NavLink>
      )}
      <span className="spacer" />
      <span className="user-info">Logged in as {role}</span>
      <button onClick={handleLogout}>Logout</button>
    </nav>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  return accessToken ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/status/:teamSlug" element={<StatusPage />} />
          <Route path="/incidents" element={<PrivateRoute><IncidentBoard /></PrivateRoute>} />
          <Route path="/incidents/:id" element={<PrivateRoute><IncidentDetail /></PrivateRoute>} />
          <Route path="/monitoring" element={<PrivateRoute><MonitoringDashboard /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute><AdminPanel /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/incidents" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

