import React from 'react';
import { Menu, RefreshCw, Settings, Wifi } from 'lucide-react';

interface TopbarProps {
  onOpenMobileNav: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (val: boolean) => void;
  onOpenConfig: () => void;
  lastUpdated: Date | null;
}

export const Topbar: React.FC<TopbarProps> = ({
  onOpenMobileNav,
  onRefresh,
  isLoading,
  autoRefresh,
  setAutoRefresh,
  onOpenConfig,
  lastUpdated,
}) => {
  return (
    <header className="h-16 px-4 lg:px-8 border-b border-[#172b38] bg-[#071018]/90 backdrop-blur-md flex items-center justify-between sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileNav}
          className="lg:hidden p-2 rounded-lg bg-[#0e1c28] border border-[#203746] text-[#829aaa] hover:text-[#edf7fb]"
          aria-label="Abrir menú de navegación"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">CENTRO DE MONITOREO</p>
          <h1 className="text-base lg:text-lg font-bold text-[#edf7fb] leading-tight">Estado general de la red</h1>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Live indicator */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#0e1c28] border border-[#172b38] text-[11px] text-[#829aaa]">
          <span className="w-2 h-2 rounded-full bg-[#34d5e7] animate-pulse"></span>
          <span className="font-medium text-[#edf7fb]">En vivo</span>
          {lastUpdated && (
            <span className="text-[10px] text-[#829aaa] hidden md:inline">
              · {lastUpdated.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>

        {/* Auto refresh toggle */}
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${
            autoRefresh
              ? 'bg-[#122432] text-[#34d5e7] border-[#203746]'
              : 'bg-[#0e1c28] text-[#829aaa] border-[#172b38] hover:text-[#edf7fb]'
          }`}
          title={autoRefresh ? 'Actualización cada 30s activa' : 'Actualización pausada'}
        >
          <Wifi className="w-3.5 h-3.5" />
          <span className="text-[11px]">{autoRefresh ? '30s' : 'Pausado'}</span>
        </button>

        {/* Manual refresh button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-2 rounded-lg bg-[#0e1c28] border border-[#203746] text-[#829aaa] hover:text-[#34d5e7] hover:border-[#34d5e7]/50 disabled:opacity-50 transition-colors"
          title="Actualizar datos ahora"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#34d5e7]' : ''}`} />
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenConfig}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0e1c28] border border-[#203746] text-xs font-medium text-[#edf7fb] hover:bg-[#122432] hover:border-[#34d5e7]/50 transition-colors"
        >
          <Settings className="w-3.5 h-3.5 text-[#34d5e7]" />
          <span className="hidden sm:inline">Configuración</span>
        </button>
      </div>
    </header>
  );
};
