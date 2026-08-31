import React from 'react';
import { Users, Wifi, Network } from 'lucide-react';
import type { DhcpPoolSummary } from '../types';

interface NetworkDistributionCardProps {
  dhcpPools: DhcpPoolSummary | null;
  isLoading?: boolean;
}

export const NetworkDistributionCard: React.FC<NetworkDistributionCardProps> = ({
  dhcpPools,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] animate-pulse space-y-4">
        <div className="h-4 bg-[#172b38] rounded w-1/3"></div>
        <div className="space-y-2">
          <div className="h-10 bg-[#172b38] rounded"></div>
          <div className="h-10 bg-[#172b38] rounded"></div>
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

  const totalClients = summary.total_active_leases || 1;
  // Filtrar solo las redes que tienen al menos 1 cliente o capacidad configurada
  const activeNetworks = summary.pools.filter(p => p.active_leases > 0);

  // Paleta de colores para distribuir por red
  const colors = [
    'bg-[#34d5e7] text-[#34d5e7]',
    'bg-[#54d39a] text-[#54d39a]',
    'bg-[#f0b35a] text-[#f0b35a]',
    'bg-[#829aaa] text-[#829aaa]',
    'bg-[#bd8bfd] text-[#bd8bfd]',
    'bg-[#ff8fa3] text-[#ff8fa3]',
    'bg-[#38bdf8] text-[#38bdf8]',
  ];

  return (
    <section className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">DISTRIBUCIÓN DE CLIENTES</p>
          <h3 className="text-sm font-bold text-[#edf7fb]">Conectados por Red / VLAN</h3>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#34d5e7]/10 border border-[#34d5e7]/30 text-xs font-bold text-[#34d5e7]">
          <Users className="w-3.5 h-3.5" />
          <span>{summary.total_active_leases} clientes</span>
        </div>
      </div>

      {/* Visual Distribution Multi-bar */}
      {activeNetworks.length > 0 && (
        <div className="space-y-1.5">
          <div className="w-full h-3 bg-[#122432] rounded-full overflow-hidden flex">
            {activeNetworks.map((net, i) => {
              const sharePct = (net.active_leases / totalClients) * 100;
              const colorClass = colors[i % colors.length].split(' ')[0];
              return (
                <div
                  key={net.id}
                  className={`h-full ${colorClass} transition-all duration-500`}
                  style={{ width: `${sharePct}%` }}
                  title={`${net.interface}: ${net.active_leases} dispositivos (${sharePct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-[#829aaa]">
            <span>{activeNetworks.length} redes con tráfico activo</span>
            <span>Total: 100% de clientes asignados</span>
          </div>
        </div>
      )}

      {/* Detailed Networks List */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {activeNetworks.length === 0 ? (
          <p className="text-xs text-[#829aaa] text-center py-4">No hay clientes conectados en las redes actualmente.</p>
        ) : (
          activeNetworks.map((net, i) => {
            const sharePct = ((net.active_leases / totalClients) * 100).toFixed(1);
            const isWifi = net.interface.toLowerCase().includes('ssid') || net.interface.toLowerCase().includes('wireless');
            const colorClass = colors[i % colors.length].split(' ')[0];
            const textClass = colors[i % colors.length].split(' ')[1];

            return (
              <div
                key={net.id}
                className="p-2.5 rounded-lg bg-[#09141e] border border-[#172b38] hover:border-[#203746] transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-2 h-2 rounded-full ${colorClass} shrink-0`}></div>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      {isWifi ? <Wifi className="w-3 h-3 text-[#829aaa]" /> : <Network className="w-3 h-3 text-[#829aaa]" />}
                      <span className="text-xs font-semibold text-[#edf7fb]">{net.interface}</span>
                    </div>
                    <p className="text-[10px] font-mono text-[#829aaa]">
                      GW: {net.default_gateway || '15.40.x.254'}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-xs font-bold text-[#edf7fb] font-mono">
                      {net.active_leases}
                    </span>
                    <span className="text-[10px] text-[#829aaa]">disp.</span>
                  </div>
                  <span className={`text-[10px] font-mono font-semibold ${textClass}`}>
                    {sharePct}% del total
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
