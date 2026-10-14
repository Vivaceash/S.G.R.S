import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const PERIOD = 60000;

export function RefreshControl({ loading, onRefresh, demo = false }) {
  const deadline = useRef(Date.now() + PERIOD);
  const [remaining, setRemaining] = useState(60);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    // Start a full cycle after the initial load or any manual refresh finishes.
    if (!loading) {
      deadline.current = Date.now() + PERIOD;
      setRemaining(60);
    }
  }, [loading]);

  useEffect(() => {
    const tick = () => {
      if (loading || document.hidden) return;
      const seconds = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        deadline.current = Date.now() + PERIOD;
        setRemaining(60);
        if (!demo) refreshRef.current();
      }
    };
    const timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [loading, demo]);

  const label = loading ? 'Actualizando información' : `Actualizar información. Próxima actualización en ${remaining} segundos`;
  return <button type="button" className={`icon-button header-refresh refresh-countdown ${loading ? 'refreshing' : ''}`}
    aria-label={label} title={label} aria-busy={loading} disabled={loading} data-remaining={remaining}
    onClick={() => { deadline.current = Date.now() + PERIOD; setRemaining(60); onRefresh(); }}>
    <span className="refresh-countdown-icon" aria-hidden="true">
    <svg className="refresh-countdown-ring" viewBox="0 0 48 48">
      <circle className="refresh-ring-track" cx="24" cy="24" r="20" />
      <circle className="refresh-ring-progress" cx="24" cy="24" r="20" pathLength="60"
        strokeDasharray="60" strokeDashoffset={remaining - 60} transform="rotate(-90 24 24)" />
    </svg>
    <RefreshCw size={18} aria-hidden="true" />
    </span>
  </button>;
}
