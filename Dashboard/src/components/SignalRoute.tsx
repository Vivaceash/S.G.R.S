import React from 'react';
import { Globe, Shield, Cpu, Network } from 'lucide-react';
import type { FortiSystemStatus, OmniInfrastructureStats } from '../types';

interface SignalRouteProps {
  fortiStatus: FortiSystemStatus | null;
  omniStats: OmniInfrastructureStats | null;
  isFortiOnline: boolean;
  isOmniOnline: boolean;
}

export const SignalRoute: React.FC<SignalRouteProps> = ({
  fortiStatus,
  omniStats,
  isFortiOnline,
  isOmniOnline,
}) => {
  const isHealthy = isFortiOnline && isOmniOnline;

  return (
    <section className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
      {/* Status description */}
      <div className="space-y-1.5 max-w-md">
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wider bg-[#54d39a]/10 text-[#54d39a] border border-[#54d39a]/30">
          <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-[#54d39a] animate-pulse' : 'bg-[#f0b35a]'}`} />
          {isHealthy ? 'OPERACIÓN ESTABLE' : 'OPERACIÓN PARCIAL / ALERTA'}
        </div>
        <h2 className="text-xl font-bold text-[#edf7fb] tracking-tight">
          La red está <span className={isHealthy ? 'text-[#54d39a]' : 'text-[#f0b35a]'}>{isHealthy ? 'saludable' : 'degradada'}</span>
        </h2>
        <p className="text-xs text-[#829aaa] leading-relaxed">
          {isHealthy
            ? `FortiGate (${fortiStatus?.hostname || 'Firewall'}) y OmniVista NMS conectados activamente.`
            : !isFortiOnline && !isOmniOnline
            ? 'Atención: Ambos controladores de red están inalcanzables en este momento.'
            : !isFortiOnline
            ? 'Alerta: Sin comunicación con el firewall perimetral FortiGate.'
            : 'Aviso: Sin comunicación con el gestor OmniVista 2500.'}
        </p>
      </div>

      {/* Signal Route Pipeline */}
      <div className="w-full xl:w-auto flex-1 max-w-2xl">
        <div className="relative flex items-center justify-between">
          {/* Connecting line */}
          <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[2px] bg-[#172b38] z-0">
            <div
              className="h-full bg-gradient-to-r from-[#34d5e7] via-[#54d39a] to-[#34d5e7] transition-all duration-500"
              style={{ width: isHealthy ? '100%' : '50%' }}
            />
          </div>

          {/* Node 1: Internet */}
          <div className="relative z-10 flex flex-col items-center gap-1.5 text-center">
            <div className="w-11 h-11 rounded-full bg-[#122432] border border-[#34d5e7]/60 flex items-center justify-center text-[#34d5e7] shadow-sm">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#edf7fb]">Internet</p>
              <p className="text-[10px] font-mono text-[#829aaa]">WAN Activa</p>
            </div>
          </div>

          {/* Node 2: Firewall FortiGate */}
          <div className="relative z-10 flex flex-col items-center gap-1.5 text-center">
            <div
              className={`w-11 h-11 rounded-full border flex items-center justify-center shadow-sm ${
                isFortiOnline
                  ? 'bg-[#122432] border-[#54d39a] text-[#54d39a]'
                  : 'bg-[#1a1215] border-[#ef6b62] text-[#ef6b62]'
              }`}
            >
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#edf7fb]">Firewall</p>
              <p className="text-[10px] font-mono text-[#829aaa]">
                {isFortiOnline ? (fortiStatus?.version ? `v${fortiStatus.version}` : 'FortiOS') : 'Offline'}
              </p>
            </div>
          </div>

          {/* Node 3: Core (Núcleo) */}
          <div className="relative z-10 flex flex-col items-center gap-1.5 text-center">
            <div
              className={`w-11 h-11 rounded-full border flex items-center justify-center shadow-sm ${
                isOmniOnline
                  ? 'bg-[#122432] border-[#34d5e7] text-[#34d5e7]'
                  : 'bg-[#1a1812] border-[#f0b35a] text-[#f0b35a]'
              }`}
            >
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#edf7fb]">Núcleo</p>
              <p className="text-[10px] font-mono text-[#829aaa]">
                {isOmniOnline ? 'OmniVista' : 'Alerta'}
              </p>
            </div>
          </div>

          {/* Node 4: Access (Switches y APs) */}
          <div className="relative z-10 flex flex-col items-center gap-1.5 text-center">
            <div className="w-11 h-11 rounded-full bg-[#122432] border border-[#203746] flex items-center justify-center text-[#829aaa] shadow-sm">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#edf7fb]">Acceso</p>
              <p className="text-[10px] font-mono text-[#829aaa]">
                {omniStats?.total_network_devices ? `${omniStats.total_network_devices} equipos` : 'Conectado'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
