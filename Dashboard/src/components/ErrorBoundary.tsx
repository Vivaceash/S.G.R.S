import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary capturó un fallo no manejado:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#071018] text-[#edf7fb] flex items-center justify-center p-6">
          <div className="max-w-md w-full p-6 rounded-2xl bg-[#0e1c28] border border-[#ef6b62]/40 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-[#ef6b62]/10 border border-[#ef6b62]/30 text-[#ef6b62] flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#edf7fb]">Incidencia en la vista del Dashboard</h2>
              <p className="text-xs text-[#829aaa] mt-1 leading-relaxed">
                Se detectó una discrepancia al procesar la telemetría recibida.
              </p>
              {this.state.error && (
                <pre className="text-[10px] text-[#ef6b62] bg-[#071018] p-2.5 rounded-lg font-mono mt-3 overflow-x-auto text-left">
                  {this.state.error.message}
                </pre>
              )}
            </div>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#34d5e7] text-[#071018] text-xs font-bold hover:bg-[#34d5e7]/90 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Recargar Dashboard</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
