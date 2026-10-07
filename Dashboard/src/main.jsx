import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { SessionProvider } from './session.jsx';
import { MobileReport } from './mobile-report.jsx';
import './styles.css';

function Root() {
  const [hash, setHash] = useState(() => location.hash);

  useEffect(() => {
    const handleHash = () => setHash(location.hash);
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const isMobileReport = /^#reporte(?:\?|$)/.test(hash)
    || new URLSearchParams(location.search).get('mobile') === '1';

  return isMobileReport ? (
    <MobileReport />
  ) : (
    <SessionProvider>
      <App />
    </SessionProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
