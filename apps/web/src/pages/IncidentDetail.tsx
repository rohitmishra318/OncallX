import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';

interface IncidentEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface IncidentDetail {
  id: string;
  title: string;
  dedupKey: string;
  severity: string;
  status: string;
  serviceId: string;
  createdAt: string;
  ackedAt: string | null;
  resolvedAt: string | null;
  events: IncidentEvent[];
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get(`/incidents/${id}`)
      .then(({ data }) => setIncident(data))
      .catch(() => setError('Failed to load incident'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="page"><p>Loading...</p></div>;
  if (error) return <div className="page"><p className="error-msg">{error}</p></div>;
  if (!incident) return null;

  const eventLabels: Record<string, string> = {
    created: '🔴 Incident created',
    duplicate_alert: '⚠️ Duplicate alert received',
    acked: '✅ Incident acknowledged',
    escalated: '🔺 Escalated to fallback responder',
    resolved: '✔️ Incident resolved',
  };

  return (
    <div className="page">
      <p style={{ marginBottom: 12 }}><Link to="/incidents">← Back to Incidents</Link></p>
      <h1>{incident.title || incident.dedupKey}</h1>

      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <tbody>
            <tr><td><strong>ID</strong></td><td><code>{incident.id}</code></td></tr>
            <tr><td><strong>Severity</strong></td><td><span className={`sev-${incident.severity.toLowerCase()}`}>{incident.severity}</span></td></tr>
            <tr><td><strong>Status</strong></td><td><span className={`badge badge-${incident.status.toLowerCase()}`}>{incident.status}</span></td></tr>
            <tr><td><strong>Created</strong></td><td>{new Date(incident.createdAt).toLocaleString()}</td></tr>
            {incident.ackedAt && <tr><td><strong>Acknowledged</strong></td><td>{new Date(incident.ackedAt).toLocaleString()}</td></tr>}
            {incident.resolvedAt && <tr><td><strong>Resolved</strong></td><td>{new Date(incident.resolvedAt).toLocaleString()}</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Event Timeline</h2>
      <div className="card">
        {incident.events.length === 0 && <p style={{ color: '#9ca3af' }}>No events yet</p>}
        <ul className="timeline">
          {incident.events.map(ev => (
            <li key={ev.id}>
              <strong>{eventLabels[ev.eventType] ?? ev.eventType}</strong>
              <span className="time">{new Date(ev.createdAt).toLocaleString()}</span>
              {ev.actorId && <span style={{ marginLeft: 8, color: '#6b7280' }}>by {ev.actorId}</span>}
              {ev.metadata && (
                <pre style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  {JSON.stringify(ev.metadata, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
