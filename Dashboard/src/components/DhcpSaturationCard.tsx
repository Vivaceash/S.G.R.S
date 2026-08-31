import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DhcpPoolSummary } from '../types';

interface DhcpSaturationCardProps {
  dhcpPools: DhcpPoolSummary | null;
  isLoading?: boolean;
}

export const DhcpSaturationCard: React.FC<DhcpSaturationCardProps> = ({
  dhcpPools,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] animate-pulse space-y-4">
        <div className="h-4 bg-[#172b38] rounded w-1/3"></div>
        <div className="h-20 bg-[#172b38] rounded"></div>
        <div className="space-y-2">
          <div className="h-3 bg-[#172b38] rounded"></div>
          <div className="h-3 bg-[#172b38] rounded"></div>
        </div>
      </div>
    );
  }

  const summary = dhcpPools || {
    total_pools: 0,
    total_capacity: 0,
    total_active_leases: 0,
    total_available_ips: 0,
    global_saturation_percent: 0,
    critical_pools_count: 0,
    warning_pools_count: 0,
    pools: [],
  };

  const globalPct = summary.global_saturation_percent;
  const activePools = summary.pools.filter(p => p.capacity > 0);

  // Determinar color de saturación global
  const getSaturationColor = (pct: number) => {
    if (pct >= 85) return 'text-[#ef6b62] border-[#ef6b62]/40 bg-[#ef6b62]/10';
    if (pct >= 75) return 'text-[#f0b35a] border-[#f0b35a]/40 bg-[#f0b35a]/10';
    return 'text-[#34d5e7] border-[#34d5e7]/40 bg-[#34d5e7]/10';
  };

  const getBarColor = (pct: number) => {
    if (pct >= 85) return 'bg-[#ef6b62]';
    if (pct >= 75) return 'bg-[#f0b35a]';
    if (pct >= 50) return 'bg-[#34d5e7]';
    return 'bg-[#54d39a]';
  };

  return (
    <section className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">CAPACIDAD Y SATURACIÓN DHCP</p>
          <h3 className="text-sm font-bold text-[#edf7fb]">Saturación de Pools IPv4</h3>
        </div>
        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-[#122432] border border-[#203746] text-[#edf7fb]">
          {summary.total_capacity.toLocaleString()} IPs totales
        </span>
      </div>

      {/* Global Saturation Header Card */}
      <div className="p-3.5 rounded-xl bg-[#071018] border border-[#172b38] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${getSaturationColor(globalPct)}`}>
              {globalPct.toFixed(1)}% Saturación
            </span>
            <span className="text-[11px] text-[#829aaa]">
              {summary.total_active_leases} ocupadas · {summary.total_available_ips.toLocaleString()} libres
            </span>
          </div>

          {summary.critical_pools_count > 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#ef6b62]">
              <AlertTriangle className="w-3.5 h-3.5" />
              {summary.critical_pools_count} pool crítico
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#54d39a]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Capacidad óptima
            </span>
          )}
        </div>

        {/* Global Progress Bar */}
        <div className="w-full h-2 bg-[#122432] rounded-full overflow-hidden">
          <div
            className={`h-full ${getBarColor(globalPct)} rounded-full transition-all duration-700`}
            style={{ width: `${Math.min(100, Math.max(2, globalPct))}%` }}
          />
        </div>
      </div>

      {/* Scopes / Pools Breakdown */}
      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {activePools.length === 0 ? (
          <p className="text-xs text-[#829aaa] text-center py-3">No hay pools dinámicos con capacidad asignada.</p>
        ) : (
          activePools.map(pool => {
            const pct = pool.utilization_percent;
            const isCritical = pool.status === 'critical';
            const isWarning = pool.status === 'warning';

            return (
              <div
                key={pool.id}
                className={`p-2.5 rounded-lg border transition-all ${
                  isCritical
                    ? 'bg-[#ef6b62]/10 border-[#ef6b62]/30'
                    : isWarning
                    ? 'bg-[#f0b35a]/10 border-[#f0b35a]/30'
                    : 'bg-[#09141e] border-[#172b38]'
                }`}
              >
                <div className="flex justify-between items-center text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#edf7fb]">{pool.interface}</span>
                    {isCritical && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#ef6b62] text-[#071018]">
                        AGOTÁNDOSE
                      </span>
                    )}
                    {isWarning && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#f0b35a] text-[#071018]">
                        ALERTA
                      </span>
                    )}
                  </div>
                  <div className="text-right font-mono text-[11px]">
                    <span className={`font-bold ${isCritical ? 'text-[#ef6b62]' : isWarning ? 'text-[#f0b35a]' : 'text-[#edf7fb]'}`}>
                      {pct.toFixed(1)}%
                    </span>
                    <span className="text-[#829aaa] ml-1.5">
                      ({pool.active_leases}/{pool.capacity} IPs)
                    </span>
                  </div>
                </div>

                {/* Progress bar per pool */}
                <div className="w-full h-1.5 bg-[#122432] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getBarColor(pct)} rounded-full transition-all duration-500`}
                    style={{ width: `${Math.min(100, Math.max(1, pct))}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#829aaa] mt-1.5 font-mono">
                  <span>GW: {pool.default_gateway || 'N/A'}</span>
                  <span>{pool.available_ips} IPs libres</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
