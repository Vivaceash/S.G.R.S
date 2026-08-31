import React from 'react';
import { X, Copy, Shield, Server, Check } from 'lucide-react';
import type { UnifiedDevice } from '../types';

interface DeviceDetailModalProps {
  device: UnifiedDevice | null;
  onClose: () => void;
}

export const DeviceDetailModal: React.FC<DeviceDetailModalProps> = ({ device, onClose }) => {
  const [copiedField, setCopiedField] = React.useState<string | null>(null);

  if (!device) return null;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-xl bg-[#0e1c28] border border-[#203746] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 bg-[#09141e] border-b border-[#172b38] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#122432] border border-[#203746] flex items-center justify-center text-[#34d5e7]">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">TELEMETRÍA TÉCNICA</p>
              <h3 className="text-sm font-bold text-[#edf7fb]">{device.name}</h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#829aaa] hover:text-[#edf7fb] hover:bg-[#122432] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs">
          {/* Status banner */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#071018] border border-[#172b38]">
            <span className="text-[#829aaa]">Estado Operacional:</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                device.status === 'online'
                  ? 'bg-[#54d39a]/15 text-[#54d39a] border border-[#54d39a]/40'
                  : 'bg-[#829aaa]/15 text-[#829aaa] border border-[#829aaa]/40'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${device.status === 'online' ? 'bg-[#54d39a]' : 'bg-[#829aaa]'}`} />
              {device.status === 'online' ? 'Activo en Red' : 'Desconectado'}
            </span>
          </div>

          {/* Key values grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-[#09141e] border border-[#172b38]">
              <p className="text-[10px] text-[#829aaa] mb-1">Dirección IPv4</p>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[#34d5e7] font-semibold text-sm">{device.ip || 'Sin asignar'}</span>
                {device.ip && (
                  <button
                    onClick={() => copyToClipboard(device.ip, 'ip')}
                    className="text-[#829aaa] hover:text-[#edf7fb]"
                    title="Copiar IP"
                  >
                    {copiedField === 'ip' ? <Check className="w-3.5 h-3.5 text-[#54d39a]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#09141e] border border-[#172b38]">
              <p className="text-[10px] text-[#829aaa] mb-1">Dirección MAC</p>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[#edf7fb] font-semibold text-xs">{device.mac}</span>
                <button
                  onClick={() => copyToClipboard(device.mac, 'mac')}
                  className="text-[#829aaa] hover:text-[#edf7fb]"
                  title="Copiar MAC"
                >
                  {copiedField === 'mac' ? <Check className="w-3.5 h-3.5 text-[#54d39a]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Details list */}
          <div className="space-y-2 rounded-lg bg-[#09141e] p-3 border border-[#172b38]">
            <div className="flex justify-between py-1 border-b border-[#172b38]/50">
              <span className="text-[#829aaa]">Fabricante Hardware:</span>
              <span className="font-semibold text-[#edf7fb]">{device.vendor || 'Desconocido'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#172b38]/50">
              <span className="text-[#829aaa]">Categoría de Equipo:</span>
              <span className="font-semibold text-[#edf7fb]">{device.type}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#172b38]/50">
              <span className="text-[#829aaa]">Interfaz de Conexión:</span>
              <span className="font-mono text-[#34d5e7]">{device.location}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#829aaa]">Origen de Detección:</span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#edf7fb]">
                <Shield className="w-3 h-3 text-[#34d5e7]" />
                {device.source === 'fortigate' ? 'Fortinet FortiGate REST' : 'OmniVista 2500 NMS'}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#09141e] border-t border-[#172b38] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#122432] border border-[#203746] text-xs font-semibold text-[#edf7fb] hover:bg-[#203746] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
