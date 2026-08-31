import React from 'react';
import { Server, Network, Cpu, AlertTriangle } from 'lucide-react';
import type { FortiSystemResourceUsage, OmniNotification } from '../types';

interface MetricCardsProps {
  totalDevices: number;
  onlineDevices: number;
  fortiTotalInventory?: number;
  fortiOnlineDevices?: number;
  fortiOfflineDevices?: number;
  omniDeviceCount?: number;
  dhcpCount: number;
  resources: FortiSystemResourceUsage | null;
  notifications: OmniNotification[];
}

export const MetricCards: React.FC<MetricCardsProps> = ({
  totalDevices,
  onlineDevices,
  fortiTotalInventory,
  fortiOnlineDevices,
  fortiOfflineDevices,
  omniDeviceCount,
  dhcpCount,
  resources,
  notifications = [],
}) => {
  const notifList = Array.isArray(notifications) ? notifications : [];
  
  // Métricas específicas de FortiGate (Terminales de usuario)
  const activeCount = fortiOnlineDevices ?? onlineDevices;
  const inventoryTotal = fortiTotalInventory ?? totalDevices;
  const offlineCount = fortiOfflineDevices ?? Math.max(0, inventoryTotal - activeCount);
  const onlinePercent = inventoryTotal > 0 ? Math.round((activeCount / inventoryTotal) * 100) : 0;
  
  const infraCount = omniDeviceCount ?? 141;
  const cpuPercent = resources?.cpu_percent ?? 0;
  const ramPercent = resources?.memory_percent ?? 0;
  const sessionCount = resources?.session_count ?? 0;

  // Calculo estimado de capacidad IP (con base en leases activos)
  const totalIpCapacity = 2048;
  const freeIps = Math.max(0, totalIpCapacity - dhcpCount);
  const ipCapacityPercent = Math.round((dhcpCount / totalIpCapacity) * 100);

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Metric 1: Terminales y Dispositivos Activos (FortiGate) */}
      <article className="p-4 rounded-xl bg-[#0e1c28] border border-[#172b38] flex flex-col justify-between space-y-3">
        <div className="flex items-center justify-between text-[#829aaa]">
          <span className="text-xs font-semibold">Terminales en línea (FortiGate)</span>
          <div className="w-7 h-7 rounded-md bg-[#122432] border border-[#203746] flex items-center justify-center text-[#34d5e7]">
            <Server className="w-3.5 h-3.5" />
          </div>
        </div>

        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-[#edf7fb]">{activeCount.toLocaleString('es-MX')}</span>
            <span className="text-xs text-[#829aaa]" title="Total histórico en caché de FortiOS">
              / {inventoryTotal.toLocaleString('es-MX')} hist.
            </span>
          </div>

          <div className="w-full h-1.5 bg-[#122432] rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-[#34d5e7] transition-all duration-500 rounded-full"
              style={{ width: `${onlinePercent}%` }}
            />
          </div>
        </div>

        <p className="text-[11px] text-[#829aaa] flex items-center justify-between">
          <span className="text-[#54d39a] font-medium">{onlinePercent}% activos</span>
          <span>{offlineCount.toLocaleString('es-MX')} en caché</span>
        </p>
      </article>

      {/* Metric 2: Equipos de Red Administrados (OmniVista) */}
      <article className="p-4 rounded-xl bg-[#0e1c28] border border-[#172b38] flex flex-col justify-between space-y-3">
        <div className="flex items-center justify-between text-[#829aaa]">
          <span className="text-xs font-semibold">Equipos de Red (OmniVista)</span>
          <div className="w-7 h-7 rounded-md bg-[#122432] border border-[#203746] flex items-center justify-center text-[#54d39a]">
            <Network className="w-3.5 h-3.5" />
          </div>
        </div>

        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-[#edf7fb]">{infraCount.toLocaleString('es-MX')}</span>
            <span className="text-xs text-[#829aaa]">switches & APs</span>
          </div>

          <div className="w-full h-1.5 bg-[#122432] rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-[#54d39a] transition-all duration-500 rounded-full"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <p className="text-[11px] text-[#829aaa] flex items-center justify-between">
          <span className="text-[#54d39a]">120 APs activos</span>
          <span>NMS 2500</span>
        </p>
      </article>

      {/* Metric 2: Direcciones IP asignadas */}
      <article className="p-4 rounded-xl bg-[#0e1c28] border border-[#172b38] flex flex-col justify-between space-y-3">
        <div className="flex items-center justify-between text-[#829aaa]">
          <span className="text-xs font-semibold">Direcciones IP (DHCP)</span>
          <div className="w-7 h-7 rounded-md bg-[#122432] border border-[#203746] flex items-center justify-center text-[#54d39a]">
            <Network className="w-3.5 h-3.5" />
          </div>
        </div>

        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-[#edf7fb]">{dhcpCount.toLocaleString('es-MX')}</span>
            <span className="text-xs text-[#829aaa]">concesiones</span>
          </div>

          <div className="w-full h-1.5 bg-[#122432] rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-[#54d39a] transition-all duration-500 rounded-full"
              style={{ width: `${ipCapacityPercent}%` }}
            />
          </div>
        </div>

        <p className="text-[11px] text-[#829aaa] flex items-center justify-between">
          <span>{freeIps.toLocaleString('es-MX')} libres</span>
          <span className="text-[#edf7fb] font-mono">{ipCapacityPercent}% uso</span>
        </p>
      </article>

      {/* Metric 3: Consumo de recursos de hardware */}
      <article className="p-4 rounded-xl bg-[#0e1c28] border border-[#172b38] flex flex-col justify-between space-y-3">
        <div className="flex items-center justify-between text-[#829aaa]">
          <span className="text-xs font-semibold">Carga del Firewall</span>
          <div className="w-7 h-7 rounded-md bg-[#122432] border border-[#203746] flex items-center justify-center text-[#f0b35a]">
            <Cpu className="w-3.5 h-3.5" />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold font-mono text-[#edf7fb]">{cpuPercent}%</span>
              <span className="text-xs text-[#829aaa]">CPU</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold font-mono text-[#829aaa]">{ramPercent}%</span>
              <span className="text-xs text-[#829aaa]">RAM</span>
            </div>
          </div>

          <div className="w-full h-1.5 bg-[#122432] rounded-full overflow-hidden mt-2">
            <div
              className="h-full bg-[#f0b35a] transition-all duration-500 rounded-full"
              style={{ width: `${Math.max(cpuPercent, ramPercent)}%` }}
            />
          </div>
        </div>

        <p className="text-[11px] text-[#829aaa] flex items-center justify-between">
          <span>{sessionCount.toLocaleString('es-MX')} sesiones</span>
          <span className="text-[#54d39a]">Normal</span>
        </p>
      </article>

      {/* Metric 4: Alertas activas */}
      <article className="p-4 rounded-xl bg-[#0e1c28] border border-[#172b38] flex flex-col justify-between space-y-3">
        <div className="flex items-center justify-between text-[#829aaa]">
          <span className="text-xs font-semibold">Alertas activas</span>
          <div className="w-7 h-7 rounded-md bg-[#122432] border border-[#203746] flex items-center justify-center text-[#ef6b62]">
            <AlertTriangle className="w-3.5 h-3.5" />
          </div>
        </div>

        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-[#edf7fb]">{notifList.length}</span>
            <span className="text-xs text-[#829aaa]">notificaciones</span>
          </div>

          <div className="flex items-center gap-3 mt-2 text-[11px] text-[#829aaa]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ef6b62]"></span>
              {notifList.filter(n => n && (n.severity?.toLowerCase() === 'high' || n.severity?.toLowerCase() === 'critical')).length} críticas
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f0b35a]"></span>
              {notifList.filter(n => n && n.severity?.toLowerCase() !== 'high' && n.severity?.toLowerCase() !== 'critical').length} medias
            </span>
          </div>
        </div>

        <p className="text-[11px] text-[#34d5e7] hover:underline cursor-pointer flex items-center justify-between">
          <span>NMS OmniVista</span>
          <span>Revisar →</span>
        </p>
      </article>
    </section>
  );
};
