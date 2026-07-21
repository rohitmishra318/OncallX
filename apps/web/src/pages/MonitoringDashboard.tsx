import { useEffect, useState } from 'react';
import api from '../api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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

// ─── Signature element: a live heartbeat waveform used as the status indicator.
// "up" plays a looping cardiac-style blip; "down" renders a flat line. This is a
// literal read of "is this service alive" rather than a decorative pulse dot.
function Heartbeat({ status, size = 'md' }: { status: 'up' | 'down' | 'unknown'; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 20 : 28;
  const color = status === 'up' ? '#22D3A5' : status === 'down' ? '#FB4B4B' : '#7C8BA3';
  const path =
    status === 'up'
      ? 'M0 14 H10 L14 4 L18 24 L22 14 H32 L36 8 L40 20 L44 14 H60'
      : status === 'down'
        ? 'M0 14 H60'
        : 'M0 14 H14 L18 10 L22 18 L26 14 H60';

  return (
    <svg width={h * 2.15} height={h} viewBox="0 0 60 28" fill="none" className="overflow-visible">
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
  up: { label: 'OPERATIONAL', text: 'text-[#22D3A5]', bg: 'bg-[#22D3A5]/10', ring: 'ring-[#22D3A5]/30' },
  down: { label: 'DOWN', text: 'text-[#FB4B4B]', bg: 'bg-[#FB4B4B]/10', ring: 'ring-[#FB4B4B]/30' },
  unknown: { label: 'UNKNOWN', text: 'text-[#7C8BA3]', bg: 'bg-[#7C8BA3]/10', ring: 'ring-[#7C8BA3]/30' },
} as const;

function uptimeColor(val: number | null) {
  if (val === null) return 'text-[#7C8BA3]';
  if (val >= 99.9) return 'text-[#22D3A5]';
  if (val >= 95) return 'text-[#FBBF24]';
  return 'text-[#FB4B4B]';
}

function stripColor(val: number | null) {
  if (val === null) return 'bg-[#1E2938]';
  if (val >= 99.9) return 'bg-[#22D3A5]';
  if (val >= 95) return 'bg-[#FBBF24]';
  return 'bg-[#FB4B4B]';
}

function relativeTime(iso: string | null) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

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
      <div className="min-h-screen bg-[#080B11] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Heartbeat status="unknown" />
          <p className="text-[#7C8BA3] text-sm font-mono tracking-wide">reading signal…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080B11] text-[#EAF0FA]">
      <style>{`
        @keyframes hb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        @keyframes live-dot { 0%, 100% { box-shadow: 0 0 0 0 rgba(76,141,255,0.5); } 50% { box-shadow: 0 0 0 5px rgba(76,141,255,0); } }
      `}</style>

      <div className="max-w-7xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-10 gap-4 border-b border-[#1A2230] pb-6">
          <div>
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-[#4C8DFF] mb-2">
              Monitoring / System Overview
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[#F5F8FF]">Signal Board</h1>
            <p className="mt-2 text-sm text-[#7C8BA3] font-mono">
              {targets.length} services tracked · <span className="text-[#22D3A5]">{upCount} operational</span>
              {downCount > 0 && (
                <>
                  {' '}
                  · <span className="text-[#FB4B4B]">{downCount} down</span>
                </>
              )}
            </p>
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-full text-xs font-mono font-medium tracking-wide transition-all border ${autoRefresh
              ? 'bg-[#4C8DFF]/10 text-[#4C8DFF] border-[#4C8DFF]/30'
              : 'bg-transparent text-[#7C8BA3] border-[#1E2938] hover:border-[#2A3546]'
              }`}
          >
            <span
              className="w-2 h-2 rounded-full bg-[#4C8DFF]"
              style={autoRefresh ? { animation: 'live-dot 1.8s ease-in-out infinite' } : undefined}
            />
            {autoRefresh ? 'LIVE · 30s' : 'PAUSED'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Signal list */}
          <div className="space-y-3 lg:col-span-1">
            {targets.map((target) => {
              const isSelected = selectedTarget?.targetId === target.targetId;
              const meta = STATUS_META[target.status];
              return (
                <div
                  key={target.targetId}
                  onClick={() => setSelectedTarget(target)}
                  className={`p-4 rounded-lg cursor-pointer transition-all border ${isSelected
                    ? 'bg-[#0F1520] border-[#4C8DFF]/50 shadow-[0_0_0_1px_rgba(76,141,255,0.15)]'
                    : 'bg-[#0B0F17] border-[#1A2230] hover:border-[#2A3546]'
                    }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-[15px] text-[#EAF0FA] truncate pr-2">{target.targetId}</span>
                    <span
                      className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ring-1 ${meta.text} ${meta.bg} ${meta.ring}`}
                    >
                      {meta.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between mt-2 mb-3">
                    <Heartbeat status={target.status} size="sm" />
                    <div className="text-right font-mono text-xs text-[#7C8BA3]">
                      <div>{target.latencyMs !== null ? `${target.latencyMs}ms` : '—'}</div>
                      <div className="text-[10px] mt-0.5">{relativeTime(target.lastCheckedAt)}</div>
                    </div>
                  </div>

                  <div className="flex gap-[3px] h-6">
                    {target.uptimeStrip.map((day, idx) => (
                      <div
                        key={idx}
                        className={`flex-1 rounded-[2px] ${stripColor(day.uptimePercent)} opacity-80 hover:opacity-100 transition-opacity`}
                        title={`${day.date}: ${day.uptimePercent === null ? 'no data' : day.uptimePercent.toFixed(2) + '%'}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {targets.length === 0 && (
              <div className="p-8 text-center bg-[#0B0F17] rounded-lg border border-dashed border-[#1E2938]">
                <p className="text-[#EAF0FA] font-medium text-sm">No services connected yet</p>
                <p className="text-xs text-[#7C8BA3] mt-2 font-mono">
                  Add a target to targets.json and restart the monitor to start receiving signal.
                </p>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selectedTarget ? (
              <div className="bg-[#0B0F17] rounded-xl p-6 md:p-7 border border-[#1A2230]">
                <div className="flex items-center justify-between mb-7">
                  <div className="flex items-center gap-3">
                    <Heartbeat status={selectedTarget.status} />
                    <h2 className="text-xl font-bold text-[#F5F8FF]">{selectedTarget.targetId}</h2>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold tracking-wider ring-1 ${STATUS_META[selectedTarget.status].text
                      } ${STATUS_META[selectedTarget.status].bg} ${STATUS_META[selectedTarget.status].ring}`}
                  >
                    {STATUS_META[selectedTarget.status].label}
                  </span>
                </div>

                {/* KPI row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
                  {[
                    { label: '24h', value: selectedTarget.uptime.h24 },
                    { label: '7d', value: selectedTarget.uptime.d7 },
                    { label: '30d', value: selectedTarget.uptime.d30 },
                    { label: '90d', value: selectedTarget.uptime.d90 },
                  ].map((stat) => (
                    <div key={stat.label} className="p-4 bg-[#080B11] rounded-lg border border-[#1A2230]">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-[#7C8BA3] mb-2">
                        {stat.label} uptime
                      </div>
                      <div className={`text-2xl font-bold font-mono ${uptimeColor(stat.value)}`}>
                        {stat.value === null ? '—' : `${stat.value.toFixed(2)}%`}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Latency oscilloscope */}
                <div className="bg-[#080B11] p-5 rounded-lg border border-[#1A2230]">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-xs font-mono uppercase tracking-widest text-[#7C8BA3]">
                      Response Latency
                    </h3>
                    <select
                      value={historyRange}
                      onChange={(e) => setHistoryRange(e.target.value as any)}
                      className="bg-[#0B0F17] border border-[#1E2938] text-[#EAF0FA] text-xs font-mono rounded px-3 py-1.5 outline-none cursor-pointer hover:border-[#2A3546] focus:border-[#4C8DFF]/50"
                    >
                      <option value="24h">24 hours</option>
                      <option value="7d">7 days</option>
                      <option value="30d">30 days</option>
                      <option value="90d">90 days</option>
                    </select>
                  </div>

                  <div className="h-64 w-full">
                    {history?.data.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={history.data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                          <CartesianGrid stroke="#151C28" strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey={history.resolution === 'raw' ? 'timestamp' : 'hourBucket'}
                            tickFormatter={(val: any) =>
                              new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            }
                            minTickGap={40}
                            stroke="#3A4658"
                            fontSize={11}
                            fontFamily="ui-monospace, monospace"
                            tickLine={false}
                            axisLine={{ stroke: '#1A2230' }}
                          />
                          <YAxis
                            stroke="#3A4658"
                            fontSize={11}
                            fontFamily="ui-monospace, monospace"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => `${val}ms`}
                            width={54}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0B0F17',
                              border: '1px solid #1E2938',
                              borderRadius: '6px',
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: '12px',
                            }}
                            labelStyle={{ color: '#7C8BA3' }}
                            itemStyle={{ color: '#4C8DFF', fontWeight: 600 }}
                            labelFormatter={(val: any) =>
                              new Date(val).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            }
                            formatter={(val) => [`${val} ms`, 'latency']}
                          />
                          <Line
                            type="monotone"
                            dataKey={history.resolution === 'raw' ? 'latencyMs' : 'avgLatencyMs'}
                            stroke="#4C8DFF"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, fill: '#4C8DFF', stroke: '#080B11', strokeWidth: 2 }}
                            style={{ filter: 'drop-shadow(0 0 4px rgba(76,141,255,0.5))' }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-[#3A4658]">
                        <p className="font-mono text-sm">no data in this range</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center bg-[#0B0F17] rounded-xl border border-dashed border-[#1A2230]">
                <p className="text-[#7C8BA3] font-mono text-sm">select a service to view metrics</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}