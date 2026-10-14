import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const COOLDOWN = 15000;

export function RefreshControl({ loading, onRefresh }) {
  const deadline = useRef(0);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!remaining) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(seconds);
    };
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [remaining]);

  const label = loading ? 'Actualizando información' : remaining ? `Espera ${remaining} segundos para volver a actualizar` : 'Actualizar información';
  return <button type="button" className="icon-button header-refresh refresh-control"
    aria-label={label} title={label} aria-busy={loading} disabled={loading || remaining > 0} data-remaining={remaining}
    onClick={() => {
      if (loading || Date.now() < deadline.current) return;
      deadline.current = Date.now() + COOLDOWN;
      setRemaining(15);
      onRefresh();
    }}>
    <span className="refresh-control-icon" aria-hidden="true">
      {remaining ? <span className="refresh-cooldown">{remaining}s</span> : <RefreshCw size={18} aria-hidden="true" />}
    </span>
  </button>;
}
