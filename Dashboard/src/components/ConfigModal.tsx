import React, { useState } from 'react';
import { X, CheckCircle, AlertCircle, Save, Wifi } from 'lucide-react';
import { ApiService } from '../services/api';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [fortiUrl, setFortiUrl] = useState(ApiService.getFortiUrl());
  const [omniUrl, setOmniUrl] = useState(ApiService.getOmniUrl());
  const [apiKey, setApiKey] = useState(ApiService.getApiKey());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ forti: boolean; omni: boolean } | null>(null);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await ApiService.checkHealth();
      setTestResult(res);
    } catch {
      setTestResult({ forti: false, omni: false });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    ApiService.updateConfig(fortiUrl, omniUrl, apiKey);
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-xl bg-[#0e1c28] border border-[#203746] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 bg-[#09141e] border-b border-[#172b38] flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">PARÁMETROS DE INTEGRACIÓN</p>
            <h3 className="text-sm font-bold text-[#edf7fb]">Configuración de APIs de Red</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#829aaa] hover:text-[#edf7fb]">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 text-xs">
          <div>
            <label className="block text-[#829aaa] mb-1 font-semibold">URL API Fortinet FortiGate</label>
            <input
              type="text"
              value={fortiUrl}
              onChange={e => setFortiUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#09141e] border border-[#203746] text-[#edf7fb] font-mono focus:outline-none focus:border-[#34d5e7]"
              placeholder="http://localhost:8001/api/v1"
            />
          </div>

          <div>
            <label className="block text-[#829aaa] mb-1 font-semibold">URL API Alcatel OmniVista 2500</label>
            <input
              type="text"
              value={omniUrl}
              onChange={e => setOmniUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#09141e] border border-[#203746] text-[#edf7fb] font-mono focus:outline-none focus:border-[#34d5e7]"
              placeholder="http://localhost:8000/api/v1"
            />
          </div>

          <div>
            <label className="block text-[#829aaa] mb-1 font-semibold">Clave de Seguridad (X-API-Key)</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#09141e] border border-[#203746] text-[#edf7fb] font-mono focus:outline-none focus:border-[#34d5e7]"
              placeholder="admin"
            />
          </div>

          {/* Test connection status */}
          {testResult && (
            <div className="p-3 rounded-lg bg-[#071018] border border-[#172b38] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[#829aaa]">Fortinet (Puerto 8001):</span>
                <span className={`inline-flex items-center gap-1 font-bold ${testResult.forti ? 'text-[#54d39a]' : 'text-[#ef6b62]'}`}>
                  {testResult.forti ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  {testResult.forti ? 'Conectado' : 'Sin respuesta'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#829aaa]">OmniVista (Puerto 8000):</span>
                <span className={`inline-flex items-center gap-1 font-bold ${testResult.omni ? 'text-[#54d39a]' : 'text-[#ef6b62]'}`}>
                  {testResult.omni ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  {testResult.omni ? 'Conectado' : 'Sin respuesta'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#09141e] border-t border-[#172b38] flex items-center justify-between">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#122432] border border-[#203746] text-xs font-semibold text-[#829aaa] hover:text-[#edf7fb] disabled:opacity-50"
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>{testing ? 'Comprobando...' : 'Probar enlaces'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#829aaa] hover:text-[#edf7fb]"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#34d5e7] text-[#071018] text-xs font-bold hover:bg-[#34d5e7]/90 transition-colors shadow-xs"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Guardar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
