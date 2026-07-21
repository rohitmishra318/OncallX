import { useEffect, useState } from 'react';
import api from '../api';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

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

export function MonitoringDashboard() {
  const [targets, setTargets] = useState<TargetStatus[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<TargetStatus | null>(null);
  const [history, setHistory] = useState<TargetHistory | null>(null);
  const [historyRange, setHistoryRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTargets();
  }, []);

  useEffect(() => {
    if (selectedTarget) {
      fetchHistory(selectedTarget.targetId, historyRange);
    }
  }, [selectedTarget?.targetId, historyRange]);

  const fetchTargets = async () => {
    try {
      const { data } = await api.get('/monitoring/targets');
      setTargets(data.targets);
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

  if (loading) {
    return <div className="p-8 text-gray-500">Loading monitoring data...</div>;
  }

  const formatUptime = (val: number | null) => (val === null ? '--' : `${val.toFixed(2)}%`);

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8">Internal Monitoring Dashboard</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Targets List */}
        <div className="space-y-4 lg:col-span-1">
          {targets.map((target) => (
            <div
              key={target.targetId}
              onClick={() => setSelectedTarget(target)}
              className={`p-4 border rounded cursor-pointer transition-colors ${selectedTarget?.targetId === target.targetId ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-lg">{target.targetId}</span>
                {target.status === 'up' && <span className="text-green-600 bg-green-100 px-2 py-1 rounded text-sm">UP</span>}
                {target.status === 'down' && <span className="text-red-600 bg-red-100 px-2 py-1 rounded text-sm">DOWN</span>}
                {target.status === 'unknown' && <span className="text-gray-600 bg-gray-100 px-2 py-1 rounded text-sm">UNKNOWN</span>}
              </div>
              <div className="text-sm text-gray-500 mb-4">
                Latency: {target.latencyMs !== null ? `${target.latencyMs}ms` : '--'}
              </div>

              {/* Uptime Strip */}
              <div className="flex gap-1">
                {target.uptimeStrip.map((day, idx) => {
                  let bgColor = 'bg-gray-200'; // unknown/maintenance
                  if (day.uptimePercent !== null) {
                    if (day.uptimePercent >= 99.9) bgColor = 'bg-green-500';
                    else if (day.uptimePercent >= 95) bgColor = 'bg-yellow-400';
                    else bgColor = 'bg-red-500';
                  }
                  return (
                    <div
                      key={idx}
                      className={`h-6 flex-1 ${bgColor} rounded-sm`}
                      title={`${day.date}: ${formatUptime(day.uptimePercent)}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          {targets.length === 0 && <p className="text-gray-500">No monitoring data available.</p>}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {selectedTarget ? (
            <div className="border rounded p-6 shadow-sm">
              <h2 className="text-2xl font-bold mb-6">{selectedTarget.targetId} Metrics</h2>

              <div className="grid grid-cols-4 gap-4 mb-8">
                <div className="p-4 bg-gray-50 rounded text-center">
                  <div className="text-sm text-gray-500 mb-1">24h Uptime</div>
                  <div className="text-xl font-semibold">{formatUptime(selectedTarget.uptime.h24)}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded text-center">
                  <div className="text-sm text-gray-500 mb-1">7d Uptime</div>
                  <div className="text-xl font-semibold">{formatUptime(selectedTarget.uptime.d7)}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded text-center">
                  <div className="text-sm text-gray-500 mb-1">30d Uptime</div>
                  <div className="text-xl font-semibold">{formatUptime(selectedTarget.uptime.d30)}</div>
                </div>
                <div className="p-4 bg-gray-50 rounded text-center">
                  <div className="text-sm text-gray-500 mb-1">90d Uptime</div>
                  <div className="text-xl font-semibold">{formatUptime(selectedTarget.uptime.d90)}</div>
                </div>
              </div>

              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Latency</h3>
                <select
                  value={historyRange}
                  onChange={(e) => setHistoryRange(e.target.value as any)}
                  className="border rounded p-1"
                >
                  <option value="24h">Last 24 Hours</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                  <option value="90d">Last 90 Days</option>
                </select>
              </div>

              <div className="h-64 w-full">
                {history?.data.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history.data}>
                      <XAxis
                        dataKey={history.resolution === 'raw' ? 'timestamp' : 'hourBucket'}
                        tickFormatter={(val) => new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        minTickGap={30}
                      />
                      <YAxis />
                      <Tooltip
                        labelFormatter={(val) => new Date(val).toLocaleString()}
                        formatter={(val) => [`${val}ms`, 'Latency']}
                      />
                      <Line
                        type="monotone"
                        dataKey={history.resolution === 'raw' ? 'latencyMs' : 'avgLatencyMs'}
                        stroke="#3b82f6"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-400">No latency data for this range</div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 border rounded border-dashed">
              Select a target to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
