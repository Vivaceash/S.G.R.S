import React from 'react';
import {
  Activity,
  AlertTriangle,
  FileText,
  Layers,
  Network,
  Radio,
  Server,
  Shield,
  Sliders,
  User,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  onClose: () => void;
  deviceCount: number;
  alertCount: number;
  onOpenConfig: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpen,
  onClose,
  deviceCount,
  alertCount,
  onOpenConfig,
}) => {
  const navItems = [
    { id: 'resumen', label: 'Resumen', icon: Activity, group: 'OPERACIÓN' },
    { id: 'dispositivos', label: 'Dispositivos', icon: Server, badge: deviceCount, group: 'OPERACIÓN' },
    { id: 'direcciones', label: 'Direcciones IP', icon: Network, group: 'OPERACIÓN' },
    { id: 'actividad', label: 'Actividad y Logs', icon: Layers, group: 'OPERACIÓN' },
    { id: 'alertas', label: 'Alertas', icon: AlertTriangle, dangerBadge: alertCount, group: 'SEGURIDAD' },
    { id: 'topologia', label: 'Topología', icon: Radio, group: 'SEGURIDAD' },
    { id: 'reportes', label: 'Reportes', icon: FileText, group: 'SEGURIDAD' },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#09141e] border-r border-[#172b38] flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-[#172b38]">
          <div className="w-8 h-8 rounded-lg bg-[#0e1c28] border border-[#203746] flex items-center justify-center text-[#34d5e7] shadow-sm">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold tracking-wider text-sm text-[#edf7fb]">S.G.R.S.</span>
            <p className="text-[11px] text-[#829aaa] font-medium leading-none">Redes + Seguridad</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          <div>
            <p className="px-3 text-[10px] font-bold tracking-widest text-[#829aaa]/70 mb-2">OPERACIÓN</p>
            <div className="space-y-1">
              {navItems
                .filter(i => i.group === 'OPERACIÓN')
                .map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        onClose();
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-[#0e1c28] text-[#34d5e7] border border-[#203746]'
                          : 'text-[#829aaa] hover:text-[#edf7fb] hover:bg-[#0e1c28]/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </div>
                      {item.badge !== undefined && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-[#122432] text-[#829aaa] border border-[#203746]">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>

          <div>
            <p className="px-3 text-[10px] font-bold tracking-widest text-[#829aaa]/70 mb-2">SEGURIDAD</p>
            <div className="space-y-1">
              {navItems
                .filter(i => i.group === 'SEGURIDAD')
                .map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        onClose();
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-[#0e1c28] text-[#34d5e7] border border-[#203746]'
                          : 'text-[#829aaa] hover:text-[#edf7fb] hover:bg-[#0e1c28]/50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </div>
                      {item.dangerBadge !== undefined && item.dangerBadge > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-[#ef6b62]/20 text-[#ef6b62] border border-[#ef6b62]/40 font-bold">
                          {item.dangerBadge}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[#172b38] space-y-2 bg-[#08121a]">
          <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[#829aaa]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#54d39a] animate-pulse"></span>
              <span>NOC Operativo</span>
            </div>
            <button
              onClick={onOpenConfig}
              className="p-1 hover:text-[#34d5e7] rounded hover:bg-[#122432] transition-colors"
              title="Configuración de APIs"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[#0e1c28] border border-[#172b38]">
            <div className="w-7 h-7 rounded-full bg-[#122432] border border-[#203746] flex items-center justify-center text-xs text-[#34d5e7] font-bold">
              IR
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#edf7fb] truncate">Israel R.</p>
              <p className="text-[10px] text-[#829aaa] truncate">Administrador</p>
            </div>
            <User className="w-3.5 h-3.5 text-[#829aaa]" />
          </div>
        </div>
      </aside>
    </>
  );
};
