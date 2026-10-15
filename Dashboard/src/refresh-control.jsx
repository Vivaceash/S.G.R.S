import React from 'react';
import { RefreshCw } from 'lucide-react';

export function RefreshControl({ loading, onRefresh }) {
  const label = loading ? 'Actualizando información' : 'Actualizar información';
  return <button type="button" className="icon-button header-refresh refresh-control"
    aria-label={label} title={label} aria-busy={loading} disabled={loading}
    onClick={onRefresh}>
    <span className="refresh-control-icon" aria-hidden="true">
      <RefreshCw size={18} aria-hidden="true" />
    </span>
  </button>;
}
