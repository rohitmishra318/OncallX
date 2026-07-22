import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  Key, AlertCircle, Copy, Check, X, Plus, Pause, Play,
  Trash2, Activity, Clock, ShieldAlert, ChevronDown, BarChart2
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TargetStatus {
  targetId: string;
  status: 'up' | 'down' | 'unknown';
  latencyMs: number | null;
  lastCheckedAt: string | null;
  uptime: { h24: number | null; d7: number | null; d30: number | null; d90: number | null };
  uptimeStrip: { date: string; uptimePercent: number | null }[];
}

interface TargetHistory {
  range: string;
  resolution: 'raw' | 'hourly';
  data: any[];
}

interface UserTarget {
  id: string;
  name: string;
  url: string;
  serviceId: string;
  expectedStatus: number;
  timeoutMs: number;
  intervalMs: number;
  failureThreshold: number;
  successThreshold: number;
  degradedLatencyMs: number;
  isActive: boolean;
  createdAt: string;
}

interface Service {
  id: string;
  name: string;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function Heartbeat({ status, size = 'md' }: { status: 'up' | 'down' | 'unknown'; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 20 : 28;
  const color = status === 'up' ? '#10B981' : status === 'down' ? '#E11D48' : '#64748B';
  const path =
    status === 'up'
      ? 'M0 14 H10 L14 4 L18 24 L22 14 H32 L36 8 L40 20 L44 14 H60'
      : status === 'down'
        ? 'M0 14 H60'
        : 'M0 14 H14 L18 10 L22 18 L26 14 H60';

  return (
    <svg width={h * 2.15} height={h} viewBox="0 0 60 28" fill="none" className="overflow-visible shrink-0">
      <path
        d={path}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          status === 'up'
            ? { filter: `drop-shadow(0 0 3px ${color})`, animation: 'hb-pulse 2.2s ease-in-out infinite' }
            : status === 'down'
              ? { opacity: 0.85 }
              : { opacity: 0.5 }
        }
      />
    </svg>
  );
}

const STATUS_META = {
  up: { label: 'OPERATIONAL', text: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/20' },
  down: { label: 'DOWN', text: 'text-rose-400', bg: 'bg-rose-500/10', ring: 'ring-rose-500/20' },
  unknown: { label: 'UNKNOWN', text: 'text-slate-400', bg: 'bg-slate-500/10', ring: 'ring-slate-500/20' },
} as const;

function uptimeColor(val: number | null) {
  if (val === null) return 'text-slate-500';
  if (val >= 99.9) return 'text-emerald-400';
  if (val >= 95) return 'text-amber-400';
  return 'text-rose-400';
}

function stripColor(val: number | null) {
  if (val === null) return 'bg-slate-800';
  if (val >= 99.9) return 'bg-emerald-500';
  if (val >= 95) return 'bg-amber-500';
  return 'bg-rose-500';
}

function relativeTime(iso: string | null) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ─── API Key Reveal Modal ─────────────────────────────────────────────────────

function ApiKeyRevealModal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
            <Key size={20} />
          </div>
          <h2 className="text-lg font-semibold text-white">Save Your API Key</h2>
        </div>

        <div className="flex items-start gap-3 mt-4 mb-6 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-rose-400 text-sm leading-relaxed">
            This key will <strong>NOT</strong> be shown again. Copy it now and store it securely.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
          <code className="flex-1 font-mono text-sm bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-blue-400 break-all select-all">
            {apiKey}
          </code>
          <button
            onClick={copy}
            className={`shrink-0 flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-medium transition-all ${copied
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-blue-600 text-white hover:bg-blue-700 border border-transparent'
              }`}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-6 leading-relaxed">
          This key lets external tools (e.g. UptimeRobot, DigitalOcean) POST alerts to OnCallX on behalf of this target's service. The built-in monitor authenticates internally.
        </p>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg text-sm font-medium border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
        >
          I've saved it, close window
        </button>
      </div>
    </div>
  );
}

// ─── Add Target Modal ─────────────────────────────────────────────────────────

function AddTargetModal({ services, onCreated, onClose }: { services: Service[]; onCreated: (apiKey: string) => void; onClose: () => void; }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [expectedStatus, setExpectedStatus] = useState('200');
  const [intervalMs, setIntervalMs] = useState('60000');
  const [timeoutMs, setTimeoutMs] = useState('5000');
  const [failureThreshold, setFailureThreshold] = useState('3');
  const [successThreshold, setSuccessThreshold] = useState('2');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/monitoring/user-targets', {
        name,
        url,
        serviceId,
        expectedStatus: parseInt(expectedStatus, 10),
        intervalMs: parseInt(intervalMs, 10),
        timeoutMs: parseInt(timeoutMs, 10),
        failureThreshold: parseInt(failureThreshold, 10),
        successThreshold: parseInt(successThreshold, 10),
        degradedLatencyMs: 2000,
      });
      onCreated(data.apiKey);
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to create target';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = 'w-full bg-slate-950 border border-slate-800 text-slate-200 text-sm rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 placeholder-slate-600 transition-all';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Add Monitori Target</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        {services.length === 0 && (
          <div className="flex items-start gap-3 mb-6 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-500">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>You have no Services yet. Go to the Admin Panel to create one with an escalation policy first.</p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Target Name</label>
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Production API" required />
            </div>
            <div>
              <label className={labelCls}>URL to monitor</label>
              <input className={inputCls} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/health" required />
              <p className="text-xs text-slate-500 mt-1.5">Must be public HTTPS. Private IPs and metadata endpoints are blocked.</p>
            </div>
            <div>
              <label className={labelCls}>Service Routing</label>
              <select className={inputCls} value={serviceId} onChange={e => setServiceId(e.target.value)} required>
                <option value="" disabled>— Select a service —</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800">
            <h3 className="text-sm font-medium text-white mb-4">Advanced Configuration</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Expected Status</label>
                <input className={inputCls} type="number" value={expectedStatus} onChange={e => setExpectedStatus(e.target.value)} min={100} max={599} required />
              </div>
              <div>
                <label className={labelCls}>Interval (ms)</label>
                <input className={inputCls} type="number" value={intervalMs} onChange={e => setIntervalMs(e.target.value)} min={30000} required />
              </div>
              <div>
                <label className={labelCls}>Timeout (ms)</label>
                <input className={inputCls} type="number" value={timeoutMs} onChange={e => setTimeoutMs(e.target.value)} min={1000} max={10000} required />
              </div>
              <div>
                <label className={labelCls}>Failure Threshold</label>
                <input className={inputCls} type="number" value={failureThreshold} onChange={e => setFailureThreshold(e.target.value)} min={1} max={20} required />
              </div>
              <div>
                <label className={labelCls}>Success Threshold</label>
                <input className={inputCls} type="number" value={successThreshold} onChange={e => setSuccessThreshold(e.target.value)} min={1} max={20} required />
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-rose-500/10 border border-rose-500/20 rounded-lg text-sm text-rose-400">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div className="pt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || services.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? 'Creating...' : 'Create Target'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── My Targets Panel ─────────────────────────────────────────────────────────

function MyTargetsPanel() {
  const [targets, setTargets] = useState<UserTarget[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const { teamId } = useAuth();

  const load = async () => {
    try {
      const [tRes] = await Promise.all([
        api.get('/monitoring/user-targets'),
        Promise.resolve(),
      ]);
      setTargets(tRes.data.targets);
      if (teamId) {
        const svcs = await api.get(`/teams/${teamId}/services`).catch(() => ({ data: [] }));
        setServices(Array.isArray(svcs.data) ? svcs.data : []);
      }
    } catch {
      // Handle error quietly
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (t: UserTarget) => {
    await api.patch(`/monitoring/user-targets/${t.id}`, { isActive: !t.isActive });
    load();
  };

  const remove = async (t: UserTarget) => {
    if (!confirm(`Delete target "${t.name}"? This cannot be undone.`)) return;
    await api.delete(`/monitoring/user-targets/${t.id}`);
    load();
  };

  return (
    <>
      <div className="mt-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Configured Monitor</h2>
            <p className="text-sm text-slate-400 mt-1">Manage external URLs your team is currently tracking.</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center shrink-0 gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Add Target
          </button>
        </div>

        {targets.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-900 rounded-xl border border-dashed border-slate-800">
            <Activity className="w-10 h-10 text-slate-600 mb-4" />
            <p className="text-slate-200 font-medium text-sm">No monitors configured</p>
            <p className="text-sm text-slate-400 mt-1">Click "Add Target" to start tracking endpoints.</p>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="divide-y divide-slate-800/60">
              {targets.map(t => (
                <div
                  key={t.id}
                  className={`flex flex-col md:flex-row md:items-center justify-between p-4 transition-all hover:bg-slate-800/30 ${!t.isActive ? 'opacity-75 bg-slate-900/50' : ''
                    }`}
                >
                  <div className="min-w-0 flex-1 mb-4 md:mb-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold text-sm text-white">{t.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-wider ring-1 ${t.isActive
                          ? 'text-emerald-400 bg-emerald-500/10 ring-emerald-500/20'
                          : 'text-slate-400 bg-slate-500/10 ring-slate-500/20'
                          }`}
                      >
                        {t.isActive ? 'ACTIVE' : 'PAUSED'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-mono text-slate-400 truncate mb-1">
                      {t.url}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> every {t.intervalMs / 1000}s
                      </span>
                      <span className="flex items-center gap-1">
                        <AlertCircle size={12} /> thres: {t.failureThreshold}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 md:ml-4 shrink-0">
                    <button
                      onClick={() => toggle(t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${t.isActive
                        ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                        }`}
                    >
                      {t.isActive ? <Pause size={14} /> : <Play size={14} />}
                      {t.isActive ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => remove(t)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border bg-transparent border-slate-700 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/10 transition-all"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <AddTargetModal
          services={services}
          onCreated={(key) => {
            setShowAdd(false);
            setRevealKey(key);
            load();
          }}
          onClose={() => setShowAdd(false)}
        />
      )}

      {revealKey && (
        <ApiKeyRevealModal apiKey={revealKey} onClose={() => setRevealKey(null)} />
      )}
    </>
  );
}

// ─── Main dashboard component ──────────────────────────────────────────────────

export function MonitoringDashboard() {
  const [targets, setTargets] = useState<TargetStatus[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<TargetStatus | null>(null);
  const [history, setHistory] = useState<TargetHistory | null>(null);
  const [historyRange, setHistoryRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchTargets = async () => {
    try {
      const { data } = await api.get('/monitoring/targets');
      setTargets(data.targets);
      setSelectedTarget((prev) => {
        if (!prev) return data.targets[0] ?? null;
        return data.targets.find((t: TargetStatus) => t.targetId === prev.targetId) ?? prev;
      });
    } catch (err) {
      console.error('Failed to fetch targets', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (targetId: string, range: string) => {
    try {
      const { data } = await api.get(`/monitoring/targets/${targetId}/history?range=${range}`);
      setHistory(data);
    } catch (err) {
      console.error('Failed to fetch history', err);
    }
  };

  useEffect(() => {
    fetchTargets();
    if (!autoRefresh) return;
    const interval = setInterval(fetchTargets, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  useEffect(() => {
    if (selectedTarget) {
      fetchHistory(selectedTarget.targetId, historyRange);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTarget?.targetId, historyRange]);

  const upCount = targets.filter((t) => t.status === 'up').length;
  const downCount = targets.filter((t) => t.status === 'down').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Heartbeat status="unknown" />
          <p className="text-slate-500 text-sm font-mono tracking-wide animate-pulse">Establishing connection...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      <style>{`
        @keyframes hb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
      `}</style>

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Signal Board</h1>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="font-medium text-slate-300">{targets.length} services</span>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400 font-medium">{upCount} operational</span>
              {downCount > 0 && (
                <>
                  <span className="text-slate-600">•</span>
                  <span className="text-rose-400 font-medium">{downCount} down</span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all border ${autoRefresh
              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20'
              : 'bg-transparent text-slate-400 border-slate-700 hover:text-slate-300 hover:border-slate-600'
              }`}
          >
            <span className="relative flex h-2 w-2">
              {autoRefresh && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${autoRefresh ? 'bg-blue-500' : 'bg-slate-500'}`}></span>
            </span>
            {autoRefresh ? 'LIVE (30s)' : 'PAUSED'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Signal list (Left Column) */}
          <div className="flex flex-col gap-3 lg:col-span-4 h-full lg:max-h-[800px] lg:overflow-y-auto pr-1 custom-scrollbar">
            {targets.map((target) => {
              const isSelected = selectedTarget?.targetId === target.targetId;
              const meta = STATUS_META[target.status];
              return (
                <div
                  key={target.targetId}
                  onClick={() => setSelectedTarget(target)}
                  className={`p-4 rounded-xl cursor-pointer transition-all border relative overflow-hidden ${isSelected
                    ? 'bg-slate-900 border-slate-700 shadow-sm'
                    : 'bg-slate-900/40 border-transparent hover:border-slate-800 hover:bg-slate-900/80'
                    }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-xl" />
                  )}

                  <div className="flex justify-between items-start mb-3 ml-1">
                    <span className="font-semibold text-sm text-white truncate pr-2">{target.targetId}</span>
                    <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-medium tracking-wider ring-1 ${meta.text} ${meta.bg} ${meta.ring}`}>
                      {meta.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mb-4 ml-1">
                    <Heartbeat status={target.status} size="sm" />
                    <div className="text-right flex flex-col items-end">
                      <span className="font-mono text-sm font-medium text-slate-300">
                        {target.latencyMs !== null ? `${target.latencyMs}ms` : '—'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">
                        {relativeTime(target.lastCheckedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Uptime Strip */}
                  <div className="flex gap-0.5 h-1.5 w-full rounded-sm overflow-hidden bg-slate-800/50 ml-1">
                    {target.uptimeStrip.map((day, idx) => (
                      <div
                        key={idx}
                        className={`flex-1 ${stripColor(day.uptimePercent)} opacity-80 hover:opacity-100 transition-opacity`}
                        title={`${day.date}: ${day.uptimePercent === null ? 'no data' : day.uptimePercent.toFixed(2) + '%'}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {targets.length === 0 && (
              <div className="p-8 text-center bg-slate-900 rounded-xl border border-dashed border-slate-800">
                <p className="text-white font-medium text-sm">No services connected</p>
                <p className="text-xs text-slate-400 mt-1">Add a target below to start receiving signals.</p>
              </div>
            )}
          </div>

          {/* Detail panel (Right Column) */}
          <div className="lg:col-span-8">
            {selectedTarget ? (
              <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-sm overflow-hidden">
                <div className="p-6 md:p-8">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-4">
                      <Heartbeat status={selectedTarget.status} />
                      <div>
                        <h2 className="text-xl md:text-2xl font-bold text-white truncate leading-none mb-2">
                          {selectedTarget.targetId}
                        </h2>
                        <div className="flex items-center gap-2">
                          <span className="flex h-2 w-2 relative">
                            {selectedTarget.status === 'up' && (
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            )}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${selectedTarget.status === 'up' ? 'bg-emerald-500' : selectedTarget.status === 'down' ? 'bg-rose-500' : 'bg-slate-500'
                              }`}></span>
                          </span>
                          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
                            {selectedTarget.status === 'up' ? 'Monitoring Active' : 'Service Outage'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* KPI Row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                      { label: '24h', value: selectedTarget.uptime.h24 },
                      { label: '7d', value: selectedTarget.uptime.d7 },
                      { label: '30d', value: selectedTarget.uptime.d30 },
                      { label: '90d', value: selectedTarget.uptime.d90 },
                    ].map((stat) => (
                      <div key={stat.label} className="p-5 bg-slate-950/50 rounded-xl border border-slate-800/60 flex flex-col justify-center">
                        <div className="text-xs font-medium text-slate-400 mb-1">
                          {stat.label} Uptime
                        </div>
                        <div className={`text-2xl font-semibold font-mono tracking-tight ${uptimeColor(stat.value)}`}>
                          {stat.value === null ? '—' : `${stat.value.toFixed(2)}%`}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Latency chart */}
                  <div className="bg-slate-950 rounded-xl border border-slate-800/60 p-1">
                    <div className="p-4 md:p-5 flex justify-between items-center border-b border-slate-800/60">
                      <div className="flex items-center gap-2 text-sm font-medium text-white">
                        <BarChart2 size={16} className="text-slate-400" />
                        Response Latency
                      </div>
                      <div className="relative">
                        <select
                          value={historyRange}
                          onChange={(e) => setHistoryRange(e.target.value as any)}
                          className="appearance-none bg-slate-900 border border-slate-700 text-slate-200 text-xs font-medium rounded-md pl-3 pr-8 py-1.5 outline-none cursor-pointer hover:border-slate-600 focus:ring-2 focus:ring-blue-500/50 transition-all"
                        >
                          <option value="24h">Last 24 hours</option>
                          <option value="7d">Last 7 days</option>
                          <option value="30d">Last 30 days</option>
                          <option value="90d">Last 90 days</option>
                        </select>
                        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    <div className="h-64 w-full p-4">
                      {history?.data.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={history.data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                            <CartesianGrid stroke="#1E293B" strokeDasharray="4 4" vertical={false} />
                            <XAxis
                              dataKey={history.resolution === 'raw' ? 'timestamp' : 'hourBucket'}
                              tickFormatter={(val: any) =>
                                new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              }
                              minTickGap={40}
                              stroke="#475569"
                              fontSize={11}
                              fontFamily="ui-monospace, monospace"
                              tickLine={false}
                              axisLine={false}
                              dy={10}
                            />
                            <YAxis
                              stroke="#475569"
                              fontSize={11}
                              fontFamily="ui-monospace, monospace"
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(val) => `${val}ms`}
                              width={60}
                              dx={-10}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#0F172A',
                                border: '1px solid #1E293B',
                                borderRadius: '8px',
                                fontFamily: 'ui-monospace, monospace',
                                fontSize: '12px',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                              }}
                              labelStyle={{ color: '#94A3B8', marginBottom: '6px', fontWeight: 500 }}
                              itemStyle={{ color: '#60A5FA', fontWeight: 600 }}
                              labelFormatter={(val: any) =>
                                new Date(val).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              }
                              formatter={(val) => [`${val} ms`, 'Latency']}
                            />
                            <Line
                              type="monotone"
                              dataKey={history.resolution === 'raw' ? 'latencyMs' : 'avgLatencyMs'}
                              stroke="#3B82F6"
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ r: 4, fill: '#3B82F6', stroke: '#0F172A', strokeWidth: 2 }}
                              style={{ filter: 'drop-shadow(0 0 6px rgba(59,130,246,0.2))' }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500">
                          <Activity className="w-8 h-8 mb-2 opacity-20" />
                          <p className="text-sm font-medium">No latency data available</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-slate-900 rounded-xl border border-slate-800">
                <Activity className="w-10 h-10 text-slate-700 mb-4" />
                <p className="text-slate-400 font-medium text-sm">Select a service to view details</p>
              </div>
            )}
          </div>
        </div>

        {/* My Targets management panel */}
        <MyTargetsPanel />
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}</style>
    </div>
  );
}