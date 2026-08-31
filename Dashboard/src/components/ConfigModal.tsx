import React, { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, AlertCircle, Save, Wifi, Eye, EyeOff } from 'lucide-react';
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
  const [configError, setConfigError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    firstInputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setConfigError('');
    try {
      const res = await ApiService.checkHealth(fortiUrl, omniUrl);
      setTestResult(res);
    } catch (error) {
      setTestResult({ forti: false, omni: false });
      setConfigError(error instanceof Error ? error.message : 'No fue posible validar la configuración.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConfigError('');
    try {
      ApiService.updateConfig(fortiUrl, omniUrl, apiKey);
      onSaved();
      onClose();
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'No fue posible guardar la configuración.');
      firstInputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-dialog-title"
        className="w-full max-w-md rounded-xl bg-[#0e1c28] border border-[#203746] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="p-4 bg-[#09141e] border-b border-[#172b38] flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">PARÁMETROS DE INTEGRACIÓN</p>
            <h3 id="config-dialog-title" className="text-sm font-bold text-[#edf7fb]">Configuración de APIs de red</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar configuración" className="p-1 rounded text-[#829aaa] hover:text-[#edf7fb] cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form noValidate onSubmit={handleSave}>
        {/* Form Body */}
        <div className="p-5 space-y-4 text-xs">
          <div>
            <label htmlFor="forti-api-url" className="block text-[#829aaa] mb-1 font-semibold">URL API Fortinet FortiGate</label>
            <input
              ref={firstInputRef}
              id="forti-api-url"
              type="text"
              value={fortiUrl}
              onChange={e => setFortiUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#09141e] border border-[#203746] text-[#edf7fb] font-mono focus:outline-none focus:border-[#34d5e7]"
              placeholder="http://localhost:8001/api/v1"
            />
          </div>

          <div>
            <label htmlFor="omni-api-url" className="block text-[#829aaa] mb-1 font-semibold">URL API Alcatel OmniVista 2500</label>
            <input
              id="omni-api-url"
              type="text"
              value={omniUrl}
              onChange={e => setOmniUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#09141e] border border-[#203746] text-[#edf7fb] font-mono focus:outline-none focus:border-[#34d5e7]"
              placeholder="http://localhost:8000/api/v1"
            />
          </div>

          <div>
            <label htmlFor="api-key" className="block text-[#829aaa] mb-1 font-semibold">Clave de seguridad (X-API-Key)</label>
            <div className="relative">
              <input
                id="api-key"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoComplete="off"
                aria-describedby={configError ? 'config-error' : undefined}
                className="w-full px-3 py-2 pr-10 rounded-lg bg-[#09141e] border border-[#203746] text-[#edf7fb] font-mono focus:outline-none focus:border-[#34d5e7]"
                placeholder={import.meta.env.DEV ? 'admin' : 'Ingrese una clave temporal'}
              />
              <button
                type="button"
                aria-label={showApiKey ? 'Ocultar clave de seguridad' : 'Mostrar clave de seguridad'}
                aria-pressed={showApiKey}
                onClick={() => setShowApiKey(value => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#829aaa] hover:text-[#edf7fb] cursor-pointer"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {configError && (
            <div id="config-error" role="alert" className="p-3 rounded-lg border border-[#ef6b62]/40 bg-[#ef6b62]/10 text-[#efb0ab]">
              {configError}
            </div>
          )}

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
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#122432] border border-[#203746] text-xs font-semibold text-[#829aaa] hover:text-[#edf7fb] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>{testing ? 'Comprobando...' : 'Probar enlaces'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#829aaa] hover:text-[#edf7fb] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#34d5e7] text-[#071018] text-xs font-bold hover:bg-[#34d5e7]/90 transition-colors shadow-xs cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Guardar</span>
            </button>
          </div>
        </div>
        </form>
      </div>
    </div>
  );
};
