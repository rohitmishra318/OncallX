import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';

interface TeamUser { id: string; name: string; email: string; role: string; }
interface MaintenanceWindow { id: string; targetId: string; startsAt: string; endsAt: string; reason: string | null; }

export default function AdminPanel() {
  const { role, teamId } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState<TeamUser[]>([]);
  const [windows, setWindows] = useState<MaintenanceWindow[]>([]);

  // Create service form
  const [serviceName, setServiceName] = useState('');
  const [serviceMsg, setServiceMsg] = useState('');

  // Escalation policy form
  const [selectedService, setSelectedService] = useState('');
  const [primaryUser, setPrimaryUser] = useState('');
  const [fallbackUser, setFallbackUser] = useState('');
  const [escalateAfterMin, setEscalateAfterMin] = useState('5');
  const [policyMsg, setPolicyMsg] = useState('');

  // Slack webhook form
  const [slackUrl, setSlackUrl] = useState('');
  const [slackMsg, setSlackMsg] = useState('');

  // Maintenance window form
  const [mwTargetId, setMwTargetId] = useState('');
  const [mwStartsAt, setMwStartsAt] = useState('');
  const [mwEndsAt, setMwEndsAt] = useState('');
  const [mwReason, setMwReason] = useState('');
  const [mwMsg, setMwMsg] = useState('');

  useEffect(() => {
    if (role !== 'ADMIN') { navigate('/incidents'); return; }
    if (!teamId) return;

    api.get(`/teams/${teamId}/users`).then(({ data }) => setUsers(data));
    fetchWindows();
  }, [role, teamId, navigate]);

  const fetchWindows = () => {
    api.get('/monitoring/maintenance').then(({ data }) => setWindows(data.windows)).catch(console.error);
  };

  async function createService(e: React.FormEvent) {
    e.preventDefault();
    setServiceMsg('');
    try {
      const { data } = await api.post('/services', { name: serviceName, teamId });
      setServiceMsg(`✅ Service created! ID: ${data.id} | API Key: ${data.apiKey}`);
      setServiceName('');
    } catch {
      setServiceMsg('❌ Failed to create service');
    }
  }

  async function setEscalationPolicy(e: React.FormEvent) {
    e.preventDefault();
    setPolicyMsg('');
    try {
      await api.post(`/services/${selectedService}/escalation-policy`, {
        primaryUserId: primaryUser,
        fallbackUserId: fallbackUser,
        escalateAfterMin: parseInt(escalateAfterMin, 10),
      });
      setPolicyMsg('✅ Escalation policy saved');
    } catch {
      setPolicyMsg('❌ Failed to set escalation policy');
    }
  }

  async function setSlackWebhook(e: React.FormEvent) {
    e.preventDefault();
    setSlackMsg('');
    try {
      await api.put(`/teams/${teamId}/slack-webhook`, { slackWebhookUrl: slackUrl });
      setSlackMsg('✅ Slack webhook saved');
    } catch {
      setSlackMsg('❌ Failed to set Slack webhook');
    }
  }

  async function createMaintenanceWindow(e: React.FormEvent) {
    e.preventDefault();
    setMwMsg('');
    try {
      await api.post('/monitoring/maintenance', {
        targetId: mwTargetId,
        startsAt: new Date(mwStartsAt).toISOString(),
        endsAt: new Date(mwEndsAt).toISOString(),
        reason: mwReason || undefined,
      });
      setMwMsg('✅ Maintenance window scheduled');
      setMwTargetId('');
      setMwStartsAt('');
      setMwEndsAt('');
      setMwReason('');
      fetchWindows();
    } catch {
      setMwMsg('❌ Failed to schedule maintenance window');
    }
  }

  async function deleteWindow(id: string) {
    if (!confirm('Are you sure you want to cancel this window?')) return;
    try {
      await api.delete(`/monitoring/maintenance/${id}`);
      fetchWindows();
    } catch {
      alert('Failed to delete window');
    }
  }

  return (
    <div className="page">
      <h1>Admin Panel</h1>

      <div className="card">
        <h2>Create Service</h2>
        <form onSubmit={createService}>
          <div className="form-group">
            <label htmlFor="service-name">Service Name</label>
            <input id="service-name" value={serviceName} onChange={e => setServiceName(e.target.value)} required />
          </div>
          <button type="submit" className="primary">Create Service</button>
          {serviceMsg && <p style={{ marginTop: 8 }}>{serviceMsg}</p>}
        </form>
      </div>

      <div className="card">
        <h2>Set Escalation Policy</h2>
        <form onSubmit={setEscalationPolicy}>
          <div className="form-group">
            <label htmlFor="sel-service">Service ID</label>
            <input id="sel-service" placeholder="Service UUID" value={selectedService} onChange={e => setSelectedService(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="primary-user">Primary Responder</label>
            <select id="primary-user" value={primaryUser} onChange={e => setPrimaryUser(e.target.value)} required>
              <option value="">— Select user —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="fallback-user">Fallback Responder</label>
            <select id="fallback-user" value={fallbackUser} onChange={e => setFallbackUser(e.target.value)} required>
              <option value="">— Select user —</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="escalate-min">Escalate After (minutes)</label>
            <input id="escalate-min" type="number" min={1} value={escalateAfterMin} onChange={e => setEscalateAfterMin(e.target.value)} required style={{ width: 100 }} />
          </div>
          <button type="submit" className="primary">Save Policy</button>
          {policyMsg && <p style={{ marginTop: 8 }}>{policyMsg}</p>}
        </form>
      </div>

      <div className="card">
        <h2>Slack Incoming Webhook</h2>
        <form onSubmit={setSlackWebhook}>
          <div className="form-group">
            <label htmlFor="slack-url">Webhook URL</label>
            <input id="slack-url" type="url" placeholder="https://hooks.slack.com/services/..." value={slackUrl} onChange={e => setSlackUrl(e.target.value)} required />
          </div>
          <button type="submit" className="primary">Save Webhook</button>
          {slackMsg && <p style={{ marginTop: 8 }}>{slackMsg}</p>}
        </form>
      </div>

      <div className="card">
        <h2>Schedule Maintenance Window</h2>
        <form onSubmit={createMaintenanceWindow}>
          <div className="form-group">
            <label htmlFor="mw-target">Target Name (dedupKey)</label>
            <input id="mw-target" value={mwTargetId} onChange={e => setMwTargetId(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="mw-start">Starts At (Local Time)</label>
            <input id="mw-start" type="datetime-local" value={mwStartsAt} onChange={e => setMwStartsAt(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="mw-end">Ends At (Local Time)</label>
            <input id="mw-end" type="datetime-local" value={mwEndsAt} onChange={e => setMwEndsAt(e.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="mw-reason">Reason (optional)</label>
            <input id="mw-reason" value={mwReason} onChange={e => setMwReason(e.target.value)} />
          </div>
          <button type="submit" className="primary">Schedule Window</button>
          {mwMsg && <p style={{ marginTop: 8 }}>{mwMsg}</p>}
        </form>

        {windows.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <h3>Active & Upcoming Windows</h3>
            <table>
              <thead>
                <tr><th>Target</th><th>Starts</th><th>Ends</th><th>Reason</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {windows.map(w => (
                  <tr key={w.id}>
                    <td>{w.targetId}</td>
                    <td>{new Date(w.startsAt).toLocaleString()}</td>
                    <td>{new Date(w.endsAt).toLocaleString()}</td>
                    <td>{w.reason || '-'}</td>
                    <td><button onClick={() => deleteWindow(w.id)} style={{ padding: '4px 8px', fontSize: 12 }}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Team Members</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>ID</th></tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td><code style={{ fontSize: 11 }}>{u.id}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
