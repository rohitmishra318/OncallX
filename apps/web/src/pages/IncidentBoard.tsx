import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../api';
import { useAuth } from '../context/AuthContext';

interface Incident {
  id: string;
  serviceId: string;
  dedupKey: string;
  status: string;
  severity: string;
  title: string;
  createdAt: string;
  ackedAt: string | null;
  resolvedAt: string | null;
}

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:4000';

export default function IncidentBoard() {
  const { accessToken, teamId } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchIncidents = useCallback(async () => {
    try {
      const params = statusFilter ? { status: statusFilter } : {};
      const { data } = await api.get('/incidents', { params });
      setIncidents(data.incidents);
    } catch {
      setError('Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  // WebSocket — live updates
  useEffect(() => {
    if (!accessToken || !teamId) return;

    const socket: Socket = io(WS_URL, {
      path: '/ws',
      auth: { token: accessToken },
    });

    socket.on('incident:created', ({ incident }: { incident: Incident }) => {
      setIncidents(prev => {
        if (prev.find(i => i.id === incident.id)) return prev;
        return [incident, ...prev];
      });
    });

    socket.on('incident:updated', ({ incident }: { incident: Incident }) => {
      setIncidents(prev => prev.map(i => (i.id === incident.id ? { ...i, ...incident } : i)));
    });

    socket.on('incident:escalated', ({ incidentId }: { incidentId: string }) => {
      // Re-fetch the specific incident to get updated event list
      api.get(`/incidents/${incidentId}`).then(({ data }) => {
        setIncidents(prev => prev.map(i => (i.id === incidentId ? { ...i, ...data } : i)));
      });
    });

    return () => { socket.disconnect(); };
  }, [accessToken, teamId]);

  async function handleAck(id: string) {
    try {
      await api.post(`/incidents/${id}/ack`);
    } catch {
      alert('Failed to acknowledge incident');
    }
  }

  async function handleResolve(id: string) {
    try {
      await api.post(`/incidents/${id}/resolve`);
    } catch {
      alert('Failed to resolve incident');
    }
  }

  const filtered = statusFilter
    ? incidents.filter(i => i.status === statusFilter.toUpperCase())
    : incidents;

  return (
    <div className="page">
      <h1>Incident Board</h1>
      <div className="filter-bar">
        <label htmlFor="status-filter">Filter by status:</label>
        <select id="status-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="ACKED">Acked</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <button onClick={fetchIncidents}>Refresh</button>
      </div>
      {loading && <p>Loading...</p>}
      {error && <p className="error-msg">{error}</p>}
      {!loading && !error && (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: '#9ca3af' }}>No incidents</td></tr>
            )}
            {filtered.map(inc => (
              <tr key={inc.id}>
                <td>
                  <Link to={`/incidents/${inc.id}`}>{inc.title || inc.dedupKey}</Link>
                </td>
                <td><span className={`sev-${inc.severity.toLowerCase()}`}>{inc.severity}</span></td>
                <td><span className={`badge badge-${inc.status.toLowerCase()}`}>{inc.status}</span></td>
                <td>{new Date(inc.createdAt).toLocaleString()}</td>
                <td>
                  <div className="actions">
                    {inc.status === 'OPEN' && (
                      <button onClick={() => handleAck(inc.id)}>Ack</button>
                    )}
                    {inc.status !== 'RESOLVED' && (
                      <button className="danger" onClick={() => handleResolve(inc.id)}>Resolve</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
