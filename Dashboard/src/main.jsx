import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { SessionProvider } from './session.jsx';
import { MobileReport } from './mobile-report.jsx';
import './styles.css';

const isMobileReport = /^#reporte\?/.test(location.hash);
createRoot(document.getElementById('root')).render(<React.StrictMode>{isMobileReport ? <MobileReport /> : <SessionProvider><App /></SessionProvider>}</React.StrictMode>);
