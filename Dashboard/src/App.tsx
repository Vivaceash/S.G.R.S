import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { SignalRoute } from './components/SignalRoute';
import { MetricCards } from './components/MetricCards';
import { DeviceTable } from './components/DeviceTable';
import { ActivityFeed } from './components/ActivityFeed';
import { DhcpSaturationCard } from './components/DhcpSaturationCard';
import { NetworkDistributionCard } from './components/NetworkDistributionCard';
import { DeviceDetailModal } from './components/DeviceDetailModal';
import { ConfigModal } from './components/ConfigModal';
import { ApiService } from './services/api';
import {
  MOCK_DEVICES,
  MOCK_FORTI_STATUS,
  MOCK_RESOURCES,
  MOCK_OMNI_STATS,
  MOCK_NOTIFICATIONS,
  MOCK_DHCP_LEASES,
  MOCK_DHCP_POOLS,
} from './services/mockData';
import type {
  UnifiedDevice,
  FortiSystemStatus,
  FortiSystemResourceUsage,
  OmniInfrastructureStats,
  OmniNotification,
  FortiDhcpLease,
  DhcpPoolSummary,
} from './types';
import { AlertCircle, Sparkles } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState('resumen');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Estados de datos de telemetría
  const [devices, setDevices] = useState<UnifiedDevice[]>([]);
  const [fortiStatus, setFortiStatus] = useState<FortiSystemStatus | null>(null);
  const [fortiResources, setFortiResources] = useState<FortiSystemResourceUsage | null>(null);
  const [omniStats, setOmniStats] = useState<OmniInfrastructureStats | null>(null);
  const [notifications, setNotifications] = useState<OmniNotification[]>([]);
  const [dhcpLeases, setDhcpLeases] = useState<FortiDhcpLease[]>([]);
  const [dhcpPools, setDhcpPools] = useState<DhcpPoolSummary | null>(null);
  const [isFortiOnline, setIsFortiOnline] = useState(false);
  const [isOmniOnline, setIsOmniOnline] = useState(false);
  const [hardwareOfflineNotice, setHardwareOfflineNotice] = useState(false);

  // Modales y mensajes
  const [selectedDevice, setSelectedDevice] = useState<UnifiedDevice | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const applyDemoData = () => {
    setIsDemoMode(true);
    setDevices(MOCK_DEVICES);
    setFortiStatus(MOCK_FORTI_STATUS);
    setFortiResources(MOCK_RESOURCES);
    setOmniStats(MOCK_OMNI_STATS);
    setNotifications(MOCK_NOTIFICATIONS);
    setDhcpLeases(MOCK_DHCP_LEASES);
    setDhcpPools(MOCK_DHCP_POOLS);
    setIsFortiOnline(true);
    setIsOmniOnline(true);
    setHardwareOfflineNotice(false);
    showToast('Modo Demostración activado.', 'info');
  };

  // Carga unificada de datos desde las APIs de Fortinet y OmniVista
  const loadDashboardData = useCallback(async (isSilent = false) => {
    if (isDemoMode) {
      setLastUpdated(new Date());
      return;
    }

    if (!isSilent) setIsLoading(true);
    let hardwareResponded = false;

    try {
      // 1. Probar conectividad con ambos microservicios
      const health = await ApiService.checkHealth();
      setIsFortiOnline(health.forti);
      setIsOmniOnline(health.omni);

      const unifiedList: UnifiedDevice[] = [];

      // 2. Cargar datos de Fortinet FortiGate (Puerto 8001)
      if (health.forti) {
        const [devicesRes, statusRes, resRes, dhcpRes, poolsRes] = await Promise.allSettled([
          ApiService.getFortiDevices(),
          ApiService.getFortiStatus(),
          ApiService.getFortiResources(),
          ApiService.getFortiDhcpLeases(),
          ApiService.getFortiDhcpPools(),
        ]);

        if (devicesRes.status === 'fulfilled' && devicesRes.value?.devices) {
          hardwareResponded = true;
          devicesRes.value.devices.forEach((dev, idx) => {
            unifiedList.push({
              id: `forti-${dev.mac || idx}`,
              name: dev.hostname || dev.ip || `Dispositivo-${idx + 1}`,
              ip: dev.ip || '',
              mac: dev.mac || '00:00:00:00:00:00',
              type: dev.device_type || dev.hardware_family || 'Host',
              vendor: dev.hardware_vendor || 'Desconocido',
              location: dev.interface || 'LAN',
              status: dev.is_online ? 'online' : 'offline',
              source: 'fortigate',
              lastSeen: dev.last_seen ? String(dev.last_seen) : 'Ahora',
            });
          });
        }

        if (statusRes.status === 'fulfilled') {
          hardwareResponded = true;
          setFortiStatus(statusRes.value);
        }
        if (resRes.status === 'fulfilled') setFortiResources(resRes.value);
        if (dhcpRes.status === 'fulfilled') setDhcpLeases(dhcpRes.value);
        if (poolsRes.status === 'fulfilled' && poolsRes.value) setDhcpPools(poolsRes.value);
      }

      // 3. Cargar datos de Alcatel OmniVista 2500 (Puerto 8000)
      if (health.omni) {
        const [statsRes, omniDevsRes, notifRes] = await Promise.allSettled([
          ApiService.getOmniStats(),
          ApiService.getOmniDevices(),
          ApiService.getOmniNotifications(),
        ]);

        if (statsRes.status === 'fulfilled') {
          hardwareResponded = true;
          setOmniStats(statsRes.value);
        }
        if (notifRes.status === 'fulfilled') setNotifications(notifRes.value);

        if (omniDevsRes.status === 'fulfilled' && Array.isArray(omniDevsRes.value)) {
          hardwareResponded = true;
          omniDevsRes.value.forEach((dev, idx) => {
            unifiedList.push({
              id: `omni-${dev.ip || idx}`,
              name: dev.device_name || dev.name || `Switch-Omni-${idx + 1}`,
              ip: dev.ip || '',
              mac: dev.mac || '—',
              type: dev.type || dev.chassis_type || 'Switch L2/L3',
              vendor: 'Alcatel-Lucent Enterprise',
              location: dev.location || 'Site MDF',
              status: dev.status?.toLowerCase() === 'online' ? 'online' : 'online',
              source: 'omnivista',
              lastSeen: 'Ahora',
            });
          });
        }
      }

      // Si se obtuvieron dispositivos reales, actualizamos la lista
      if (unifiedList.length > 0) {
        setDevices(unifiedList);
        setHardwareOfflineNotice(false);
      } else {
        setHardwareOfflineNotice(!hardwareResponded);
      }

      setLastUpdated(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al consultar APIs';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [isDemoMode]);

  // Carga inicial y temporizador de actualización automática (30s)
  useEffect(() => {
    loadDashboardData();

    let timer: ReturnType<typeof setInterval> | null = null;
    if (autoRefresh) {
      timer = setInterval(() => {
        loadDashboardData(true);
      }, 30000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoRefresh, loadDashboardData]);

  const fortiDevices = devices.filter(d => d.source === 'fortigate');
  const omniDevices = devices.filter(d => d.source === 'omnivista');
  const fortiOnlineCount = fortiDevices.filter(d => d.status === 'online').length;
  const fortiOfflineCount = fortiDevices.length - fortiOnlineCount;
  const omniCount = omniStats?.total_network_devices || omniDevices.length || 141;

  return (
    <div className="min-h-screen bg-[#071018] text-[#edf7fb] flex">
      {/* Sidebar persistente y responsivo */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        deviceCount={fortiOnlineCount || devices.length}
        alertCount={notifications.length}
        onOpenConfig={() => setIsConfigOpen(true)}
      />

      {/* Área de contenido principal */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        <Topbar
          onOpenMobileNav={() => setIsSidebarOpen(true)}
          onRefresh={() => {
            loadDashboardData(false);
            showToast('Actualizando telemetría de red...', 'info');
          }}
          isLoading={isLoading}
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          onOpenConfig={() => setIsConfigOpen(true)}
          lastUpdated={lastUpdated}
        />

        <main className="flex-1 p-4 lg:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* Banner de aviso ante hardware inalcanzable */}
          {hardwareOfflineNotice && !isDemoMode && (
            <div className="p-4 rounded-xl bg-[#f0b35a]/10 border border-[#f0b35a]/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs animate-in fade-in duration-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#f0b35a] shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-[#f0b35a]">Appliances de red inalcanzables desde esta red local</p>
                  <p className="text-[#829aaa] mt-0.5">
                    Las APIs están en línea (puertos 8000 y 8001), pero los equipos de red físicos (192.168.10.254 / 192.168.10.201) no responden porque tu máquina no está conectada a la VPN corporativa. Puedes activar los datos de prueba para explorar el Dashboard completo.
                  </p>
                </div>
              </div>
              <button
                onClick={applyDemoData}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f0b35a] text-[#071018] font-bold hover:bg-[#f0b35a]/90 transition-colors cursor-pointer shadow-xs"
              >
                <Sparkles className="w-4 h-4" />
                <span>Cargar datos de prueba</span>
              </button>
            </div>
          )}

          {/* Banner indicador de modo demostración activo */}
          {isDemoMode && (
            <div className="p-3 rounded-xl bg-[#34d5e7]/10 border border-[#34d5e7]/30 flex items-center justify-between text-xs animate-in fade-in duration-200">
              <div className="flex items-center gap-2 text-[#34d5e7]">
                <Sparkles className="w-4 h-4" />
                <span className="font-semibold">Modo Demostración activo (telemetría de ejemplo cargada).</span>
              </div>
              <button
                onClick={() => {
                  setIsDemoMode(false);
                  loadDashboardData(false);
                  showToast('Reconectando con hardware en vivo...', 'info');
                }}
                className="text-xs text-[#829aaa] hover:text-[#edf7fb] underline cursor-pointer"
              >
                Reintentar conexión en vivo
              </button>
            </div>
          )}

          {/* 1. Ruta de señal interactiva */}
          <SignalRoute
            fortiStatus={fortiStatus}
            omniStats={omniStats}
            isFortiOnline={isFortiOnline}
            isOmniOnline={isOmniOnline}
          />

          {/* 2. Tarjetas de métricas e indicadores clave */}
          <MetricCards
            totalDevices={devices.length}
            onlineDevices={fortiOnlineCount}
            fortiTotalInventory={fortiDevices.length}
            fortiOnlineDevices={fortiOnlineCount}
            fortiOfflineDevices={fortiOfflineCount}
            omniDeviceCount={omniCount}
            dhcpCount={dhcpLeases.length}
            resources={fortiResources}
            notifications={notifications}
          />

          {/* 3. Retícula de dos columnas: Tabla de inventario y Paneles laterales */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Columna amplia (2 columnas): Tabla de dispositivos */}
            <div className="xl:col-span-2 space-y-6">
              <DeviceTable
                devices={devices}
                isLoading={isLoading}
                onSelectDevice={dev => setSelectedDevice(dev)}
              />
            </div>

            {/* Columna derecha: Saturación de Pools, Distribución de Clientes y Actividad */}
            <div className="space-y-6">
              <DhcpSaturationCard dhcpPools={dhcpPools} isLoading={isLoading} />
              <NetworkDistributionCard dhcpPools={dhcpPools} isLoading={isLoading} />
              <ActivityFeed notifications={notifications} />
            </div>
          </div>
        </main>
      </div>

      {/* Modal de detalle de dispositivo */}
      <DeviceDetailModal
        device={selectedDevice}
        onClose={() => setSelectedDevice(null)}
      />

      {/* Modal de configuración de APIs */}
      <ConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onSaved={() => {
          showToast('Configuración de APIs guardada.', 'success');
          loadDashboardData(false);
        }}
      />

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div
            className={`px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xl border flex items-center gap-2 ${
              toast.type === 'error'
                ? 'bg-[#1a1215] text-[#ef6b62] border-[#ef6b62]/40'
                : toast.type === 'success'
                ? 'bg-[#0f1f1a] text-[#54d39a] border-[#54d39a]/40'
                : 'bg-[#0e1c28] text-[#34d5e7] border-[#34d5e7]/40'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                toast.type === 'error' ? 'bg-[#ef6b62]' : toast.type === 'success' ? 'bg-[#54d39a]' : 'bg-[#34d5e7]'
              }`}
            />
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
