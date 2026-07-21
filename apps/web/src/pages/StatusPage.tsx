import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface StatusData {
  teamName: string;
  targets: {
    name: string;
    status: 'Operational' | 'Degraded' | 'Down' | 'Under Maintenance';
    uptimeBar: { date: string; uptimePercent: number | null }[];
  }[];
}

export function StatusPage() {
  const { teamSlug } = useParams<{ teamSlug: string }>();
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/status/${teamSlug}`);
        if (!response.ok) {
          throw new Error('Status page not found');
        }
        const json = await response.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load status');
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [teamSlug]);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading status...</div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded shadow text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Page Not Found</h1>
          <p className="text-gray-500">{error || 'This status page does not exist.'}</p>
        </div>
      </div>
    );
  }

  // Determine overall status
  const isAnyDown = data.targets.some((t) => t.status === 'Down');
  const isAnyDegraded = data.targets.some((t) => t.status === 'Degraded');
  const isAnyMaintenance = data.targets.some((t) => t.status === 'Under Maintenance');

  let overallStatus = 'All Systems Operational';
  let bannerColor = 'bg-green-600';

  if (isAnyDown) {
    overallStatus = 'Some Systems Are Down';
    bannerColor = 'bg-red-600';
  } else if (isAnyDegraded) {
    overallStatus = 'Degraded System Performance';
    bannerColor = 'bg-yellow-500';
  } else if (isAnyMaintenance) {
    overallStatus = 'Active Maintenance';
    bannerColor = 'bg-blue-600';
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <header className="bg-white shadow-sm py-6">
        <div className="max-w-4xl mx-auto px-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-800">{data.teamName} Status</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 mt-8 space-y-8">
        {/* Overall Status Banner */}
        <div className={`${bannerColor} text-white p-6 rounded-lg shadow-md`}>
          <h2 className="text-2xl font-semibold">{overallStatus}</h2>
          <p className="opacity-90 mt-1">As of {new Date().toLocaleString()}</p>
        </div>

        {/* Components List */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          {data.targets.map((target, idx) => {
            let statusColor = 'text-gray-500';
            if (target.status === 'Operational') statusColor = 'text-green-600';
            if (target.status === 'Degraded') statusColor = 'text-yellow-600';
            if (target.status === 'Down') statusColor = 'text-red-600';
            if (target.status === 'Under Maintenance') statusColor = 'text-blue-600';

            return (
              <div
                key={target.name}
                className={`p-6 ${idx !== data.targets.length - 1 ? 'border-b' : ''}`}
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">{target.name}</h3>
                  <span className={`font-semibold ${statusColor}`}>{target.status}</span>
                </div>

                {/* 90-day Uptime Bar */}
                <div className="flex gap-1 h-8">
                  {target.uptimeBar.map((day, i) => {
                    let bgColor = 'bg-gray-200'; // empty/maintenance
                    if (day.uptimePercent !== null) {
                      if (day.uptimePercent >= 99.9) bgColor = 'bg-green-500';
                      else if (day.uptimePercent >= 95) bgColor = 'bg-yellow-400';
                      else bgColor = 'bg-red-500';
                    }
                    return (
                      <div
                        key={i}
                        className={`flex-1 ${bgColor} rounded-sm`}
                        title={
                          day.uptimePercent !== null
                            ? `${day.date}: ${day.uptimePercent.toFixed(2)}%`
                            : `${day.date}: No Data`
                        }
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                  <span>90 days ago</span>
                  <span>Today</span>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
