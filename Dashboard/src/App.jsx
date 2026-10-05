import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Building2, ChevronDown, ChevronRight, CircleHelp, Clock, FileText, Home, Menu, RefreshCw, Server, ShieldCheck, Wifi, X, ArrowRight, Eye, CheckCircle2, Copy, Printer, Users, PlugZap, LogOut, Download, Monitor, Globe2, Radio, Camera, Headset } from 'lucide-react';
import { Badge, Button, Dialog, Empty, IconButton, Loading, Notice, SearchField } from './components.jsx';
import { Addresses, AuditLog, Devices, Overview, PageHeading, Requests, SupportDashboard } from './pages.jsx';
import { EditForm, EntryForm, ResolveReport } from './forms.jsx';
import { ApiError, roleLabel, dateTime, formatUptime, inventoryFromIdfs, reportsFromData, request, formatDeviceType, formatLocation, statusNames } from './domain.mjs';
import { createDemo } from './demo.mjs';
import { useSession } from './session.jsx';
import { UsersPage, ConnectionsPage, initialDemoUsers, initialDemoConnections } from './admin.jsx';
import { TelemetryNav, TelemetryPage, useTelemetryCatalog } from './telemetry.jsx';
import { generateSvg } from '../qrcode.js';
import { DocumentaryInventory } from './inventory.jsx';

const emptyData = () => ({ segments: [], ips: [], devices: [], resources: [], requests: [], idfs: [], reports: {}, health: null, updatedAt: null });
const navItems = [
  ['resumen', 'Dashboard', Home],
  ['soporte', 'Dashboard Soporte', Headset],
  ['dispositivos', 'Dispositivos', Monitor],
  ['disponibilidad', 'IPs', Globe2],
  ['bitacora', 'Bitácora', FileText],
  ['idf', 'Registro IDF', Building2],
  ['aps', 'Access Points', Radio],
  ['cctv', 'CCTV', Camera],
  ['altas', 'Gestión de altas', Wifi],
];
const adminItems = [['usuarios', 'Usuarios y privilegios', Users], ['conexiones', 'Conexiones API', PlugZap]];
const titles = {
  resumen: 'Dashboard Operativo',
  soporte: 'Dashboard de Soporte',
  altas: 'Gestión de Altas de Red',
  inventario: 'Recursos Disponibles',
  disponibilidad: 'Direcciones IP',
  dispositivos: 'Dispositivos de Red',
  idf: 'Registro IDF',
  entrada: 'Registro IDF',
  bitacora: 'Bitácora de Registros',
  usuarios: 'Usuarios y privilegios',
  conexiones: 'Conexiones con las APIs',
};
function readRoute() {
  let raw = location.hash.slice(1) || 'resumen';
  const [base, query = ''] = raw.split('?');
  const alias = { actividad: 'bitacora', reporte: 'entrada', qr: 'idf' };
  return { path: alias[base] || base, params: new URLSearchParams(query), raw };
}
function Nav({ route, navigate, administration = false, data, records = [], canViewPage = () => true, user, can = () => false }) {
  const active = route === 'entrada' ? 'idf' : route;
  const badge = path => {
    if (!data) return null;
    if (path === 'disponibilidad') return data.ips.filter(ip => ip.status === 'available').length || null;
    if (path === 'idf') {
      const activeReports = records.filter(r => r.status !== 'resolved').length;
      return activeReports || null;
    }
    if (path === 'dispositivos') return data.devices.filter(device => device.status === 'online').length || null;
    if (path === 'soporte') return data.devices.filter(device => device.status === 'online').length || null;
    return null;
  };
  const link = ([path, label, Icon]) => {
    const count = badge(path);
    const hasPendingReports = path === 'idf' && Boolean(count);
    return (
      <a
        key={path}
        className={hasPendingReports ? 'nav-alert' : undefined}
        href={`#${path}`}
        aria-current={active === path ? 'page' : undefined}
        onClick={e => {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            navigate(path);
          }
        }}
      >
        <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
        <span>{label}</span>
        {count && <b className="nav-badge">{count}</b>}
      </a>
    );
  };

  if (administration) {
    const adminVisible = adminItems.filter(([path]) => {
      if (path === 'conexiones' && user?.role !== 'super-admin' && (!can || !can('integrations.manage'))) return false;
      return canViewPage(path);
    });
    if (!adminVisible.length) return null;
    return <nav className="main-nav" aria-label="Administración">{adminVisible.map(link)}</nav>;
  }

  const group1 = navItems.slice(0, 5).filter(([path]) => canViewPage(path));
  const group2 = navItems.slice(5, 8).filter(([path]) => canViewPage(path));
  const group3 = navItems.slice(8).filter(([path]) => canViewPage(path));

  return (
    <nav className="main-nav" aria-label="Navegación principal">
      {group1.length > 0 && <div className="nav-group">{group1.map(link)}</div>}
      {group2.length > 0 && (
        <div className="nav-group nav-group-infrastructure">
          <p>Infraestructura NOC</p>
          {group2.map(link)}
        </div>
      )}
      {group3.length > 0 && <div className="nav-group nav-group-secondary">{group3.map(link)}</div>}
    </nav>
  );
}
function Brand() { return <div className="brand-image" role="img" aria-label="ISSSTE · Instituto de Seguridad y Servicios Sociales de los Trabajadores del Estado" />; }
function ServiceStatus({ health, demo }) {
  return <div className="service-list">{[['FortiGate', health?.forti], ['OmniVista', health?.omni]].map(([name, status]) => <div key={name}><span>{name}</span><Badge status={status === true ? 'normal' : status === false ? 'offline' : 'unknown'}>{demo ? 'Ejemplo' : status === true ? 'Servicio responde' : status === false ? 'Sin conexión' : 'Sin verificar'}</Badge></div>)}</div>;
}
function QrCard({ row, demo, toast, host, compact = false, size = 300 }) {
  const storedHost = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('sgrs_qr_host') : null;
  const base = host?.trim() || storedHost || location.host;
  const url = new URL(/^https?:\/\//i.test(base) ? base : `${location.protocol}//${base}`);
  url.hash = `reporte?idf=${encodeURIComponent(row.id)}${row.mobile_token ? `&token=${encodeURIComponent(row.mobile_token)}` : ''}`;
  if (demo) url.searchParams.set('demo', '1');
  const value = url.toString();
  const svg = generateSvg(value, { size, margin: 4, colorDark: '#222222', colorLight: '#ffffff' });
  return <div className={`qr-card ${compact ? 'qr-card-compact' : ''}`}>{!compact && <><p className="eyebrow">Registro de entrada</p><h3>{row.name}</h3><p>{row.zone}</p></>}<img width={size} height={size} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`Código QR para registrar una visita a ${row.name}`} /><div className="qr-url-row"><a className="qr-url" href={value}>{value}</a><Button icon={Copy} onClick={async () => { try { await navigator.clipboard.writeText(value); toast('Enlace copiado.'); } catch { toast('No se pudo copiar. Selecciona el enlace para copiarlo manualmente.'); } }}>Copiar</Button></div>{!compact && <><div className="flex justify-center gap-3"><Button icon={Printer} onClick={() => window.print()}>Imprimir</Button></div><p className="muted">El dispositivo que escanee debe poder acceder a esta dirección. Los enlaces localhost solo funcionan en este equipo.</p></>}</div>;
}
function DeviceDetail({ row, demo, canReadTraffic = false }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [traffic, setTraffic] = useState(null);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = async () => {
    if (!canReadTraffic || demo || !row?.ip || row.ip === '—') return;
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setLoading(true); setError('');
    const timer = setTimeout(() => current.abort(), 12000);
    try { const json = await request(`/api/traffic/ip/${encodeURIComponent(row.ip)}?limit=20&direction=all`, { signal: current.signal }); if (controller.current === current) setTraffic(json.data || json); }
    catch (e) { if (controller.current === current) setError(e.name === 'AbortError' ? 'La consulta tardó demasiado. Puedes volver a intentar.' : e.message); }
    finally { clearTimeout(timer); if (controller.current === current) setLoading(false); }
  };

  const ipDisplay = row?.ip_source === 'unconfirmed'
    ? 'Pendiente de confirmar'
    : (row?.ip || (row?.is_reserved && row?.reserved_ip ? `${row.reserved_ip} (reservada)` : 'No informada'));
  const macDisplay = row?.mac || 'No informada';
  const serialDisplay = row?.serial || row?.raw?.serial || row?.omnivista?.serial || row?.raw?.serial_number || 'No informado';
  const vendorDisplay = row?.vendor || row?.brand || 'No informado';
  const modelDisplay = row?.model || row?.raw?.model || row?.brandModel || row?.omnivista?.model || 'No informado';
  const osDisplay = row?.os || row?.omnivista?.os || row?.raw?.os_name || 'No informado';
  const locationDisplay = row?.omnivista?.location || formatLocation(row?.location, row?.vendor, row?.interface) || 'No informada';
  const typeDisplay = formatDeviceType(row?.type, osDisplay, row?.omnivista?.device_name || row?.name, vendorDisplay);
  const statusDisplay = statusNames[row?.status] || row?.status || 'No informado';
  const hostnameDisplay = row?.hostname || row?.detected_device || row?.omnivista?.device_name || row?.name || 'No informado';
  const userDisplay = row?.user || row?.omnivista?.account || 'No identificado';
  const fortigateDisplay = row?.fortigate || 'No informado';

  const techDetails = [
    ['Nombre de equipo / Hostname', hostnameDisplay],
    ['Usuario identificado', userDisplay],
    ['Dirección IP', ipDisplay],
    ['Dirección MAC', macDisplay],
    ['Número de serie (serial)', serialDisplay],
    ['Fabricante', vendorDisplay],
    ['Modelo', modelDisplay],
    ['Sistema operativo', osDisplay],
    ['Tipo de dispositivo', typeDisplay],
    ['Ubicación física', locationDisplay],
    ['Interfaz de red', row?.interface || row?.vlan || 'No informada'],
    ['FortiGate de procedencia', fortigateDisplay],
    ['Estado del equipo', statusDisplay],
    ['Última actividad', row?.activity || row?.last_seen || 'Reciente'],
  ];

  return (
    <>
      <dl className="detail-grid">
        {techDetails.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={label.includes('IP') || label.includes('MAC') || label.includes('serie') || label.includes('Hostname') ? 'font-mono' : undefined}>
              {value || 'No informado'}
            </dd>
          </div>
        ))}
      </dl>

      {row?.omnivista?.matched && (
        <div className="omni-detail-box">
          <div className="omni-detail-header">
            <CheckCircle2 size={18} className="text-success" aria-hidden="true" />
            <h4>Información cotejada en OmniVista 2500</h4>
          </div>
          <dl className="detail-grid">
            <div><dt>Nombre en OmniVista</dt><dd><strong>{row.omnivista.device_name || '—'}</strong></dd></div>
            <div><dt>Cuenta asignada</dt><dd>{row.omnivista.account || 'Sin cuenta individual'}</dd></div>
            <div><dt>Ubicación física (IDF / Puerto)</dt><dd><strong className="text-location">{row.omnivista.location || 'No informada'}</strong></dd></div>
            <div><dt>Punto de acceso (AP)</dt><dd>{row.omnivista.ap_name || 'No informado'}</dd></div>
            <div><dt>SSID reportado</dt><dd>{row.omnivista.ssid || row.interface || '—'}</dd></div>
            <div><dt>Perfil de acceso</dt><dd>{row.omnivista.profile || '—'}</dd></div>
            <div><dt>Categoría / Familia</dt><dd>{[row.omnivista.category, row.omnivista.family].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt>Sistema operativo OmniVista</dt><dd>{row.omnivista.os || '—'}</dd></div>
            <div><dt>Estado en OmniVista</dt><dd><Badge status={row.omnivista.status?.toLowerCase() === 'online' ? 'online' : 'offline'} /> {row.omnivista.status || '—'}</dd></div>
          </dl>
        </div>
      )}

      <div className="forti-detail-box">
        <div className="forti-detail-header">
          <ShieldCheck size={18} className="text-brand" aria-hidden="true" />
          <h4>Datos cotejados de la captura de FortiGate</h4>
        </div>
        <dl className="detail-grid">
          <div><dt>Usuario identificado</dt><dd><strong>{row?.user || 'No identificado'}</strong></dd></div>
          <div><dt>Interfaz</dt><dd className="font-mono">{row?.interface || row?.vlan || 'No informada'}</dd></div>
          <div><dt>FortiGate de procedencia</dt><dd><strong>{row?.fortigate || 'No informado'}</strong></dd></div>
          <div><dt>Hostname / Detected Device</dt><dd className="font-mono">{row?.hostname || row?.detected_device || 'No informado'}</dd></div>
          <div><dt>Número de serie (Service Tag)</dt><dd className="font-mono">{row?.serial || row?.raw?.serial || 'No informado'}</dd></div>
        </dl>
      </div>

      {(row?.uptime_seconds != null || row?.first_connected_at != null || row?.total_connected_seconds != null) && (
        <div className="uptime-detail-box">
          <div className="uptime-detail-header">
            <Clock size={18} className="text-brand" aria-hidden="true" />
            <h4>Histórico de Conexión y Permanencia</h4>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Tiempo continuo actual</dt>
              <dd>
                <strong>{row?.uptime_seconds != null ? formatUptime(row.uptime_seconds) : '—'}</strong>
              </dd>
            </div>
            <div>
              <dt>Conectado desde</dt>
              <dd>
                {row?.first_connected_at
                  ? dateTime(typeof row.first_connected_at === 'number' && row.first_connected_at < 1e12 ? row.first_connected_at * 1000 : row.first_connected_at)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Tiempo acumulado en base de datos</dt>
              <dd>
                <strong>{row?.total_connected_seconds != null ? formatUptime(row.total_connected_seconds) : '—'}</strong>
              </dd>
            </div>
          </dl>
        </div>
      )}

      {canReadTraffic && (
        <>
          <Button icon={RefreshCw} busy={loading} disabled={demo || !row.ip || row.ip === '—'} onClick={load}>Consultar telemetría de tráfico</Button>
          {demo && <p className="muted">La telemetría requiere una conexión real con FortiGate.</p>}
          {error && <Notice title="No se pudo consultar el tráfico" tone="danger">{error}</Notice>}
          {traffic && (
            <div className="traffic-summary">
              <h3>Telemetría consultada</h3>
              <dl className="detail-grid">
                <div><dt>Sesiones activas</dt><dd>{traffic.active_sessions_count ?? '—'}</dd></div>
                <div><dt>Bytes enviados</dt><dd>{traffic.total_sent_bytes ?? '—'}</dd></div>
                <div><dt>Bytes recibidos</dt><dd>{traffic.total_rcvd_bytes ?? '—'}</dd></div>
              </dl>
              <h3>Sesiones recientes</h3>
              {traffic.sessions?.length ? (
                <ul className="detail-list">
                  {traffic.sessions.slice(0, 20).map((s, i) => (
                    <li key={i}>
                      <span>{s.dst_ip || s.src_ip || 'Destino no informado'}</span>
                      <span>{s.application || s.protocol_name || 'Sin clasificar'}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Sin sesiones reportadas.</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
function IdfHub({ data, records, navigate, openEditor, canWrite, canEditInventory, notify, onResolve }) {
  const [selectedId, setSelectedId] = useState('');
  const [tab, setTab] = useState('inventory');
  const [host, setHost] = useState(() => (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('sgrs_qr_host')) || location.host);
  const [detectingHost, setDetectingHost] = useState(false);
  const selected = data.idfs.find(idf => idf.id === selectedId) || data.idfs[0];
  const selectedRecords = selected ? records.filter(record => record.idfId === selected.id) : [];
  const unresolved = idf => records.filter(record => record.idfId === idf.id && record.status !== 'resolved').length;
  const choose = id => { setSelectedId(id); setTab('inventory'); };
  const detectHost = async () => {
    setDetectingHost(true);
    try {
      const response = await fetch('/api/ip', { credentials: 'same-origin' });
      const result = await response.json();
      if (!response.ok || !result.ip || result.ip.startsWith('127.')) throw new Error('No se detectó una IP de red.');
      setHost(result.ip);
      try { sessionStorage.setItem('sgrs_qr_host', result.ip); } catch {}
      notify('IP de red detectada. El QR se actualizó para el teléfono.');
    } catch {
      notify('No se pudo detectar la IP de red. Configúrala manualmente antes de escanear.');
    } finally {
      setDetectingHost(false);
    }
  };
  useEffect(() => {
    if (!sessionStorage.getItem('sgrs_qr_host') || /^(localhost|127(?:\.\d{1,3}){3})(?::|$)/i.test(host)) {
      detectHost();
    }
  }, []);
  useEffect(() => {
    if (tab === 'qr' && /^(localhost|127(?:\.\d{1,3}){3})(?::|$)/i.test(host)) detectHost();
  }, [tab]);
  if (!selected) return <><PageHeading eyebrow="Distribución y gabinetes" title="Registro IDF" description="Consulta de inventario, incidencias y acceso móvil por código QR" updatedAt={data.updatedAt} /><Loading label="Cargando gabinetes IDF…" /></>;
  const devices = data.resources.filter(resource => resource.idfId === selected.id);
  return <><PageHeading eyebrow="Distribución y gabinetes" title="Registro IDF" description="Inventario físico, incidencias y reportes móviles por gabinete" updatedAt={data.updatedAt} />
    <section className="idf-console" aria-label="Centro de operación de IDF"><div className="idf-console-tabs" role="tablist" aria-label="Vista del IDF"><button role="tab" aria-selected={tab === 'inventory'} onClick={() => setTab('inventory')}>Inventario</button><button role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')}>Bitácora</button><button role="tab" aria-selected={tab === 'qr'} onClick={() => setTab('qr')}>Código QR</button></div><div className="idf-cards">{data.idfs.filter(idf => idf.id !== 'idf-13' && idf.name !== 'IDF 13').map(idf => { const alerts = unresolved(idf); const active = idf.id === selected.id; const statusText = alerts ? `${alerts} ${alerts === 1 ? 'pendiente' : 'pendientes'}` : 'Operativo'; return <button type="button" key={idf.id} aria-label={`${idf.name || idf.id}: ${statusText}`} className={`idf-card ${active ? 'is-active' : ''} ${alerts ? 'has-alert' : ''}`} onClick={() => choose(idf.id)}><strong>{idf.name || idf.id}</strong><span className="idf-card-status">{statusText}</span></button>; })}</div>
      {tab === 'inventory' && <section className="idf-panel"><div className="idf-panel-heading"><div><p>Inventario completo del gabinete</p><h2>{selected.name || selected.id}</h2><small>{devices.length} {devices.length === 1 ? 'elemento registrado' : 'elementos registrados'} · Lista completa sin paginación</small></div><Button onClick={() => navigate(`entrada?idf=${encodeURIComponent(selected.id)}`)} disabled={!canWrite}>+ Levantar reporte</Button></div>{devices.length ? <div className="idf-device-table"><table><thead><tr><th>Dispositivo</th><th>Categoría</th><th>Nivel</th><th>Marca y modelo</th><th>N.º serie</th><th>Dirección MAC</th><th>Puertos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{devices.map(device => <tr key={device.id} className={device.status === 'offline' ? 'device-row-offline' : ''}><td><strong>{device.name || device.desc || device.type || 'Equipo no descrito'}</strong></td><td>{device.category || device.type || '—'}</td><td>{device.ru || '—'}</td><td>{device.brand || device.brandModel || device.model || '—'}</td><td className="font-mono">{device.serial || '—'}</td><td className="font-mono">{device.mac || '—'}</td><td>{device.ports || '—'}</td><td><Badge status={device.status}>{device.status === 'offline' ? 'Fuera de línea' : undefined}</Badge></td><td>{canEditInventory ? <Button onClick={() => openEditor('resource', device)}>Actualizar</Button> : '—'}</td></tr>)}</tbody></table></div> : <Empty title="Sin equipos documentados">Este gabinete aún no tiene dispositivos registrados en el inventario.</Empty>}</section>}
      {tab === 'activity' && <section className="idf-panel"><div className="idf-panel-heading"><div><p>Reportes de incidencias y climatización</p><h2>{selected.name || selected.id}</h2></div><Button variant="primary" onClick={() => navigate(`entrada?idf=${encodeURIComponent(selected.id)}`)} disabled={!canWrite}>+ Levantar reporte</Button></div>{selectedRecords.length ? <div className="idf-activity-list">{selectedRecords.map(record => <article key={record.key || record.record_key || record.id}><span className={`idf-severity idf-severity-${record.severity || 'low'}`}>{record.severity === 'high' ? 'Alta' : record.severity === 'medium' ? 'Media' : 'Baja'}</span><div><h3>{record.title || 'Incidencia reportada'}</h3><p>{record.description || 'Sin descripción adicional.'}</p><small>Folio: {record.id || '—'} · Equipo: {record.device || 'No informado'} · {dateTime(record.date)}</small></div><Badge status={record.status}>{record.status === 'resolved' ? 'Resuelto' : 'Pendiente'}</Badge><div className="idf-activity-actions"><Button onClick={() => openEditor('report-detail', record)}>Ver</Button>{record.status !== 'resolved' && canWrite && <Button variant="primary" onClick={() => onResolve(record)}>Resolver</Button>}</div></article>)}</div> : <Empty title="Sin reportes para este IDF">No hay incidencias registradas para este gabinete.</Empty>}</section>}
      {tab === 'qr' && <section className="idf-panel idf-qr-panel">
        <div className="qr-showcase">
          <div className="qr-showcase-copy">
            <div className="qr-showcase-header">
              <p className="eyebrow">Acceso móvil por código QR</p>
              <h2>{selected.name || selected.id}</h2>
              <p className="qr-showcase-subtitle">Escanea con la cámara de tu celular para abrir directamente el formulario de bitácora y registro de visitas asignado a este gabinete.</p>
            </div>

            <div className="qr-host-bar">
              <label htmlFor="qr-host">Dirección del servidor</label>
              <div className="qr-host-controls">
                <input id="qr-host" value={host} onChange={e => { setHost(e.target.value); try { sessionStorage.setItem('sgrs_qr_host', e.target.value); } catch {} }} placeholder="192.168.1.25:3001" />
                <Button onClick={detectHost} busy={detectingHost}>Detectar IP</Button>
              </div>
              <small>Asegúrate de que el teléfono esté conectado a la misma red Wi‑Fi institucional.</small>
            </div>

            <ol className="qr-steps" aria-label="Pasos para registrar una visita">
              <li><b>1</b><div><strong>Configura</strong><span>Verifica la IP local de este equipo.</span></div></li>
              <li><b>2</b><div><strong>Escanea</strong><span>Usa la cámara del teléfono.</span></div></li>
              <li><b>3</b><div><strong>Reporta</strong><span>Completa el formulario y adjunta evidencia.</span></div></li>
            </ol>

            <div className="qr-showcase-actions">
              <Button icon={Printer} onClick={() => window.print()}>Imprimir planilla</Button>
              <Button variant="primary" onClick={() => navigate(`entrada?idf=${encodeURIComponent(selected.id)}`)} disabled={!canWrite}>+ Levantar reporte</Button>
            </div>
          </div>

          <div className="qr-card-frame">
            <QrCard row={selected} demo={false} toast={notify} host={host} compact size={240} />
          </div>
        </div>
      </section>}</section>
  </>;
}
export default function App() {
  const { demo, setDemo, user, can, signOut, roles: roleInfo, allowedPages, canViewPage, switchDemoRole } = useSession();
  const catalog = useTelemetryCatalog(!demo && can('traffic.read'));
  const [demoUsers, setDemoUsers] = useState(initialDemoUsers);
  const [demoConnections, setDemoConnections] = useState(initialDemoConnections);
  const [data, setData] = useState(() => demo ? createDemo() : emptyData());

  const homeRoute = canViewPage?.('resumen')
    ? 'resumen'
    : (allowedPages?.includes('soporte') ? 'soporte' : (allowedPages?.[0] || 'resumen'));

  const [route, setRoute] = useState(() => {
    const initial = readRoute();
    if (initial.raw === 'resumen' || !initial.raw) {
      if (allowedPages && !canViewPage?.('resumen') && allowedPages.includes('soporte')) {
        return { path: 'soporte', params: new URLSearchParams(''), raw: 'soporte' };
      }
    }
    return initial;
  });

  const [loading, setLoading] = useState(!demo);
  const [errors, setErrors] = useState({});
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [modalDirty, setModalDirty] = useState(false);
  const [discardModal, setDiscardModal] = useState(false);
  const [toast, setToast] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState('');
  const [releaseUncertain, setReleaseUncertain] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const generation = useRef(0);
  const loadController = useRef(null);
  const mutationLock = useRef(false);
  const reportSyncBusy = useRef(false);
  const toastTimer = useRef(null);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const notify = useCallback(text => { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), 5500); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const expired = () => { setModal(null); setMenu(false); setModalDirty(false); setDiscardModal(false); setPendingNavigation(null); };
    window.addEventListener('sgrs-session-expired', expired);
    return () => window.removeEventListener('sgrs-session-expired', expired);
  }, []);
  const refresh = useCallback(async () => {
    if (demo) { notify('La vista de demostración está actualizada.'); return; }
    loadController.current?.abort(); const controller = new AbortController(); loadController.current = controller;
    const version = ++generation.current;
    setLoading(true);
    const timer = setTimeout(() => controller.abort(), 12000);
    const endpoints = { idfs: '/api/idfs', ips: '/api/ips', devices: '/api/devices', reports: '/api/reports', health: '/api/health', segments: '/api/forti/network/dhcp-pools' };
    const results = await Promise.allSettled(Object.values(endpoints).map(path => request(path, { signal: controller.signal })));
    clearTimeout(timer);
    if (version !== generation.current) return;
    const next = {}, failures = {};
    Object.keys(endpoints).forEach((key, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        const value = key === 'segments' ? result.value.data?.pools : result.value;
        if (['idfs', 'ips', 'devices', 'segments'].includes(key) && !Array.isArray(value)) failures[key] = 'El servicio devolvió un formato no reconocido.';
        else next[key] = value;
      } else failures[key] = result.reason.name === 'AbortError' ? 'Se agotó el tiempo de consulta. Vuelve a intentar.' : result.reason.message;
    });
    setData(old => { const merged = { ...old, ...next, updatedAt: Object.keys(next).length ? new Date().toISOString() : old.updatedAt }; return { ...merged, resources: inventoryFromIdfs(merged.idfs) }; });
    setErrors(failures); setLoading(false);
  }, [demo, notify]);
  useEffect(() => { if (!demo) refresh(); return () => { generation.current++; loadController.current?.abort(); }; }, [demo, refresh]);
  useEffect(() => {
    if (demo) return undefined;
    let active = true;
    const syncReports = async () => {
      if (!active || document.hidden || reportSyncBusy.current) return;
      reportSyncBusy.current = true;
      try {
        const reports = await request('/api/reports');
        if (!active) return;
        setData(old => JSON.stringify(old.reports) === JSON.stringify(reports) ? old : { ...old, reports, updatedAt: new Date().toISOString() });
      } catch {
        // The full refresh owns visible errors; background synchronization stays silent.
      } finally { reportSyncBusy.current = false; }
    };
    const onVisible = () => { if (!document.hidden) syncReports(); };
    const timer = window.setInterval(syncReports, 4000);
    window.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('visibilitychange', onVisible); };
  }, [demo]);
  const go = path => { setMenu(false); setDirty(false); setPendingNavigation(null); location.hash = path; setRoute(readRoute()); };
  const navigate = path => { if (mutationLock.current) return; if (dirty) setPendingNavigation(() => () => go(path)); else go(path); };
  useEffect(() => {
    const changed = () => {
      const next = readRoute();
      if (next.raw === currentRoute.current.raw) return;
      if (dirty) { const url = new URL(location.href); url.hash = currentRoute.current.raw; history.replaceState(null, '', url); setPendingNavigation(() => () => go(next.raw)); }
      else { setRoute(next); setMenu(false); }
    };
    window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed);
  }, [dirty]);

  // Route protection based on allowedPages and role capabilities
  useEffect(() => {
    if (!allowedPages || !allowedPages.length) return;
    const currentPath = route.path;
    const effective = currentPath === 'entrada' ? 'idf' : currentPath.startsWith('consulta/') ? 'consulta' : currentPath;
    if (effective === 'consulta' && can('traffic.read')) return;
    const pathAllowed = effective === 'conexiones'
      ? (canViewPage?.('conexiones') && (user?.role === 'super-admin' || can('integrations.manage')))
      : canViewPage?.(effective);
    if (!pathAllowed) {
      const target = allowedPages.includes('soporte') ? 'soporte' : (allowedPages[0] || 'resumen');
      go(target);
    }
  }, [allowedPages, route.path, user?.role]);

  useEffect(() => {
    const title = route.path.startsWith('consulta/') ? can('traffic.read') ? catalog.modules.find(item => item.id === route.path.slice(9))?.title || 'Consultas de red' : 'Acceso restringido' : ({ catalogo: 'Inventario documental de IDF', aps: 'Inventario de access points', cctv: 'Inventario CCTV' })[route.path] || titles[route.path] || 'Página no encontrada';
    document.title = `${title} · Centro Operativo SGRS`;
    if (document.querySelector('dialog[open]')) return;
    [...document.querySelectorAll('.main-content h1')].find(node => node.offsetParent !== null)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route.raw, catalog.modules]);
  useEffect(() => {
    if (!dirty && !modalDirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, modalDirty]);
  const openEditor = (kind, row) => { if (['ip', 'release', 'resource', 'stock', 'request'].includes(kind) && !can('inventory.write')) { notify('Tu rol permite consultar, pero no modificar esta información.'); return; } setModalDirty(false); setDiscardModal(false); setReleaseError(''); setReleaseUncertain(false); setModal({ kind, row }); };
  const closeModal = () => { if (mutationLock.current) return; if (modalDirty) setDiscardModal(true); else setModal(null); };
  async function mutate(path, body) {
    if (mutationLock.current) throw new ApiError(409);
    loadController.current?.abort(); generation.current++; setLoading(false);
    mutationLock.current = true;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try { return await request(path, { body, signal: controller.signal }); }
    finally { clearTimeout(timer); mutationLock.current = false; }
  }
  async function saveEntry(values) {
    if (!can('idf.visits.write')) throw new ApiError(403);
    const now = new Date().toISOString();
    const id = values.reportId;
    let incident = { id, date: now, severity: 'medium', device: 'Gabinete', temp: Number(values.temp), title: 'Reporte de incidencia', description: values.description.trim(), status: 'open', tech: demo ? values.actor : user.name };
    let telemetry = { temp: Number(values.temp), date: now, status: Number(values.temp) >= 28 ? 'critical' : Number(values.temp) >= 24 ? 'warn' : 'normal' };
    if (!demo) { const saved = await mutate('/api/reports', { idf_id: values.idf, incident, telemetry, evidence: values.evidence }); incident = saved.incident; telemetry = saved.telemetry || telemetry; }
    else if (values.evidence) incident.evidenceDemo = `data:${values.evidence.type};base64,${values.evidence.data}`;
    setData(old => { const previous = old.reports[values.idf]; return { ...old, reports: { ...old.reports, [values.idf]: { incidents: [incident, ...(Array.isArray(previous) ? previous : previous?.incidents || [])], telemetry } } }; });
    setDirty(false); go('bitacora'); notify(demo ? 'Entrada de ejemplo registrada. No se envió al servidor.' : 'Entrada registrada en la bitácora.');
  }
  async function saveEditor(values) {
    const { kind, row } = modal;
    if (kind === 'ip') {
      if (!demo) await mutate('/api/ips/update', { ip: row.ip, ...values });
      setData(old => ({ ...old, ips: old.ips.map(ip => ip.ip === row.ip ? { ...ip, ...values } : ip) }));
    } else if (kind === 'resource') {
      const device = { ...(row || {}), desc: values.name, type: values.category, ru: values.ru, brandModel: values.brand, serial: values.serial, mac: values.mac, status: values.status };
      for (const key of ['id', 'idfId', 'index', 'name', 'category', 'idf', 'zone']) delete device[key];
      await mutate('/api/idfs/device', { idf_id: values.idfId, device, ...(row ? { index: row.index } : {}) });
      setData(old => { const idfs = old.idfs.map(idf => { if (idf.id !== values.idfId) return idf; const devices = [...(idf.devices || [])]; if (row) devices[row.index] = device; else devices.push(device); return { ...idf, devices }; }); return { ...old, idfs, resources: inventoryFromIdfs(idfs) }; });
    } else if (kind === 'stock' && demo) {
      const idf = data.idfs.find(i => i.id === values.idfId);
      const resource = { ...row, ...values, id: row?.id || crypto.randomUUID(), quantity: Number(values.quantity), available: Number(values.available), idf: idf?.name, zone: idf?.zone, status: Number(values.available) <= 1 ? 'critical' : Number(values.available) <= 3 ? 'low' : 'available' };
      setData(old => ({ ...old, resources: row ? old.resources.map(r => r.id === row.id ? resource : r) : [...old.resources, resource] }));
    } else if (kind === 'request' && demo) {
      setData(old => ({ ...old, requests: [{ ...values, id: `DEMO-${Date.now()}`, status: 'pending', date: new Date().toISOString() }, ...old.requests] }));
    } else throw new ApiError(403);
    setModalDirty(false); setModal(null); notify(demo ? 'Cambios de ejemplo guardados en esta sesión.' : 'Cambios guardados.');
  }
  async function releaseIp() {
    if (releaseBusy || releaseUncertain) return;
    setReleaseBusy(true); setReleaseError('');
    try { if (!demo) await mutate('/api/ips/update', { ip: modal.row.ip, action: 'release' }); setData(old => ({ ...old, ips: old.ips.map(ip => ip.ip === modal.row.ip ? { ...ip, status: 'available', hostname: '—' } : ip) })); setModal(null); notify(demo ? 'Dirección liberada en la demostración.' : 'Dirección liberada en el inventario local.'); }
    catch (e) { const uncertain = !e.status || e.status >= 500; setReleaseUncertain(uncertain); setReleaseError(uncertain ? 'No se pudo confirmar la liberación. Consulta el inventario antes de repetir la acción.' : e.message); }
    finally { setReleaseBusy(false); }
  }
  async function resolveReport(row = modal?.row) {
    if (!can('idf.visits.write')) throw new ApiError(403);
    if (!row) throw new ApiError(404);
    const incident = demo ? { ...row, status: 'resolved', resolved_at: new Date().toISOString() }
      : (await mutate('/api/reports/resolve', { idf_id: row.idfId, record_key: row.record_key })).incident;
    setData(old => {
      const group = old.reports[row.idfId] || {};
      const incidents = Array.isArray(group) ? group : group.incidents || [];
      return { ...old, reports: { ...old.reports, [row.idfId]: { ...(Array.isArray(group) ? {} : group), incidents: [...incidents.filter(i => (i.record_key !== row.record_key || !row.record_key) && (!row.id || i.id !== row.id)), incident] } } };
    });
    if (modal?.row === row) setModal(null); notify(demo ? 'Incidencia de ejemplo resuelta.' : 'Incidencia resuelta. El historial se conserva.');
  }
  const resolveDirect = async row => { try { await resolveReport(row); } catch (error) { notify(error.message || 'No se pudo resolver la incidencia.'); } };
  const records = reportsFromData(data.reports, data.idfs);
  const shared = { data, demo, navigate, openEditor, loading, errors, refresh, canWrite: can('inventory.write'), canExport: can('inventory.export'), onResolve: resolveDirect };

  const effectivePath = route.path === 'entrada' ? 'idf' : route.path;
  const isAllowed = (route.path === 'conexiones'
    ? (canViewPage?.('conexiones') && (user?.role === 'super-admin' || can('integrations.manage')))
    : canViewPage?.(effectivePath)) || (route.path.startsWith('consulta/') && can('traffic.read'));

  let page;
  if (!isAllowed) {
    page = (
      <>
        <PageHeading
          eyebrow="Acceso restringido · 403"
          title="No tienes permiso para esta sección"
          description="Usa la navegación para consultar las secciones disponibles en tu cuenta."
        />
        <Button onClick={() => navigate(homeRoute)}>Ir a mi página principal</Button>
      </>
    );
  } else if (route.path.startsWith('consulta/')) {
    page = can('traffic.read') ? (
      <TelemetryPage catalog={catalog} moduleId={route.path.slice(9)} resourceId={route.params.get('recurso')} navigate={navigate} />
    ) : (
      <PageHeading eyebrow="Acceso restringido · 403" title="No tienes permiso para esta sección" description="Usa la navegación para consultar las secciones disponibles en tu cuenta." />
    );
  } else if (route.path === 'soporte') {
    page = <SupportDashboard {...shared} openEditor={openEditor} />;
  } else if (route.path === 'resumen') {
    page = <Overview {...shared} userId={user.id} errors={Object.values(errors)} />;
  } else if (route.path === 'altas') {
    page = <Requests {...shared} />;
  } else if (route.path === 'inventario') {
    page = <IdfHub data={data} records={records} navigate={navigate} openEditor={openEditor} canWrite={can('idf.visits.write')} canEditInventory={can('inventory.write')} notify={notify} onResolve={resolveDirect} />;
  } else if (['catalogo', 'aps', 'cctv'].includes(route.path)) {
    page = <DocumentaryInventory key={`${route.path}-${demo}`} {...shared} route={route.path} mutate={mutate} notify={notify} onDirty={setDirty} />;
  } else if (route.path === 'disponibilidad') {
    page = <Addresses {...shared} />;
  } else if (route.path === 'dispositivos') {
    page = <Devices {...shared} selectedSegment={route.params.get('segmento')} />;
  } else if (route.path === 'idf') {
    page = <IdfHub data={data} records={records} navigate={navigate} openEditor={openEditor} canWrite={can('idf.visits.write')} canEditInventory={can('inventory.write')} notify={notify} onResolve={resolveDirect} />;
  } else if (route.path === 'entrada') {
    page = <EntryForm key={route.raw} {...shared} user={user} canRegister={can('idf.visits.write')} idfId={route.params.get('idf')} save={saveEntry} onDirty={setDirty} />;
  } else if (route.path === 'bitacora') {
    page = <AuditLog {...shared} records={records} canResolve={can('idf.visits.write')} />;
  } else if (route.path === 'usuarios') {
    page = !canViewPage?.('usuarios') ? (
      <>
        <PageHeading eyebrow="Acceso restringido · 403" title="No tienes permiso para esta sección" description="Usa la navegación para consultar las secciones disponibles en tu cuenta." />
        <Button onClick={() => navigate(homeRoute)}>Volver al dashboard</Button>
      </>
    ) : (
      <UsersPage demoUsers={demoUsers} setDemoUsers={setDemoUsers} notify={notify} />
    );
  } else if (route.path === 'conexiones') {
    const hasConnectionAccess = canViewPage?.('conexiones') && (user?.role === 'super-admin' || can('integrations.manage'));
    page = !hasConnectionAccess ? (
      <>
        <PageHeading eyebrow="Acceso restringido · 403" title="No tienes permiso para esta sección" description="Usa la navegación para consultar las secciones disponibles en tu cuenta." />
        <Button onClick={() => navigate(homeRoute)}>Volver al dashboard</Button>
      </>
    ) : (
      <ConnectionsPage demoConnections={demoConnections} setDemoConnections={setDemoConnections} onDirty={setDirty} notify={notify} />
    );
  } else {
    page = (
      <>
        <PageHeading eyebrow="Error 404" title="Página no encontrada" description="Esta sección no existe en el centro operativo." />
        <Empty action={<Button onClick={() => navigate(homeRoute)}>Ir al dashboard</Button>}>Usa la navegación para abrir una sección disponible.</Empty>
      </>
    );
  }

  const modalTitle = modal?.kind === 'ip' ? `Administrar ${modal.row.ip}` : modal?.kind === 'release' ? `Liberar ${modal.row.ip}` : modal?.kind === 'resource' || modal?.kind === 'stock' ? modal.row ? 'Actualizar recurso' : 'Agregar recurso' : modal?.kind === 'request' ? 'Nueva alta de red' : modal?.kind === 'qr' ? 'Código QR del gabinete' : modal?.kind === 'device-detail' ? (modal.row.hostname || modal.row.detected_device || modal.row.omnivista?.device_name || modal.row.name || 'Detalle del dispositivo') : modal?.kind === 'request-detail' ? 'Detalle del registro' : modal?.kind === 'report-detail' ? 'Detalle del registro' : modal?.kind === 'report-resolve' ? 'Resolver incidencia' : modal?.kind === 'services' ? 'Estado de los servicios' : 'Acceso y privilegios';
  const activeModuleTitle = route.path.startsWith('consulta/') ? (catalog.modules.find(m => m.id === route.path.slice(9))?.title || 'Consultas de red') : ({ catalogo: 'Inventario documental de IDF', aps: 'Inventario de access points', cctv: 'Inventario CCTV' })[route.path] || titles[route.path] || 'Página no encontrada';

  const canManageUsers = Boolean(canViewPage?.('usuarios'));
  const canManageConnections = Boolean(canViewPage?.('conexiones') && (user?.role === 'super-admin' || can('integrations.manage')));
  const hasAdminAccess = canManageUsers || canManageConnections;

  const searchableItems = [...navItems, ...adminItems].filter(([path]) => {
    if (path === 'conexiones' && user?.role !== 'super-admin' && !can('integrations.manage')) return false;
    return canViewPage?.(path);
  });

  return <>
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>Ir al contenido</a>
    <header className="institutional-header">
      <a href={`#${homeRoute}`} className="mobile-brand-link" onClick={e => { e.preventDefault(); navigate(homeRoute); }}><Brand /></a>
      <div className="header-title">
        <strong>{activeModuleTitle}</strong>
        <span>Centro Operativo · Redes e Infraestructura</span>
      </div>
      <div className="header-search">
        <SearchField value={globalQuery} onChange={setGlobalQuery} label="Buscar una sección" placeholder="Buscar una sección del centro operativo…" />
        {globalQuery && (
          <div className="global-results">
            {searchableItems
              .filter(([, label]) => label.toLocaleLowerCase('es-MX').includes(globalQuery.toLocaleLowerCase('es-MX')))
              .map(([path, label, Icon]) => (
                <button type="button" key={path} onClick={() => { setGlobalQuery(''); navigate(path); }}>
                  <Icon size={18} />
                  {label}
                  <ArrowRight size={16} />
                </button>
              ))}
            {!searchableItems.some(([, label]) => label.toLowerCase().includes(globalQuery.toLowerCase())) && (
              <p>Sin secciones coincidentes.</p>
            )}
          </div>
        )}
      </div>
      <IconButton icon={RefreshCw} label="Actualizar información" disabled={loading} className={`header-refresh ${loading ? 'refreshing' : ''}`} onClick={refresh} />
      <IconButton icon={Bell} label="Consultar estado de servicios" onClick={() => openEditor('services')} /><button className="account-button" type="button" onClick={() => openEditor('access')}><span className="avatar">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><span><strong>{user.name}</strong><small>{demo ? `Perfil de ejemplo (${roleLabel(user.role)})` : roleLabel(user.role)}</small></span><ChevronDown size={14} /></button><div className="mexico-wordmark">Servir a<br />México</div><IconButton icon={Menu} label="Abrir navegación" className="mobile-menu" aria-expanded={menu} onClick={() => setMenu(true)} /></header>
    <aside className="sidebar">
      <a href={`#${homeRoute}`} className="sidebar-brand" onClick={e => { e.preventDefault(); navigate(homeRoute); }} aria-label="Ir al inicio"><Brand /></a>
      <Nav route={route.path} navigate={navigate} data={data} records={records} canViewPage={canViewPage} user={user} can={can} />
      {can('traffic.read') && (
        <div className="sidebar-admin">
          <p>Consultas de red</p>
          <TelemetryNav modules={catalog.modules} route={route.path} navigate={navigate} />
          {catalog.error && <Button onClick={catalog.retry}>Reintentar navegación</Button>}
        </div>
      )}
      <div className="sidebar-bottom">
        <Building2 size={28} strokeWidth={1.5} />
        <p>Dirección de Tecnologías<br />de la Información</p>
        <small>ISSSTE<br />2026 · Centro Operativo SGRS</small>
      </div>
      {hasAdminAccess && (
        <div className="sidebar-admin">
          <p>Administración</p>
          <Nav administration route={route.path} navigate={navigate} canViewPage={canViewPage} user={user} can={can} />
        </div>
      )}
    </aside>
    <main className="main-content" id="main-content" tabIndex={-1}>{route.path === 'resumen' && <div className="mode-bar">
      <div className={`operation-status ${Object.keys(errors).length ? 'degraded' : ''}`}><span className="status-light" /><div><strong>{demo ? 'Escenario de demostración' : Object.keys(errors).length ? 'Información parcial' : loading ? 'Consultando servicios' : 'Consulta completada'}</strong><small>{demo ? 'Datos de ejemplo para revisar el diseño' : 'El estado físico requiere telemetría actualizada'}</small></div></div>
    </div>}
      {Object.keys(errors).length > 0 && <Notice title="No se pudo actualizar toda la información" tone="warning" action={<Button onClick={refresh} busy={loading}>Reintentar</Button>}>Los datos conservados pueden estar desactualizados. Consultas pendientes: {Object.keys(errors).map(k => ({ idfs: 'IDFs', ips: 'direcciones IP', devices: 'dispositivos', reports: 'bitácora', health: 'servicios', segments: 'segmentos DHCP' })[k]).join(', ')}.</Notice>}
      {!can('inventory.write') && user.role !== 'soporte' && <Notice title="Perfil viewer · Solo consulta">Puedes revisar la información operativa. El registro y la edición requieren un perfil administrador.</Notice>}{page}
    </main>
    <Dialog open={menu} onClose={() => setMenu(false)} title="Centro Operativo">
      <Nav route={route.path} navigate={navigate} data={data} records={records} canViewPage={canViewPage} user={user} can={can} />
      {can('traffic.read') && <TelemetryNav modules={catalog.modules} route={route.path} navigate={navigate} />}
      {hasAdminAccess && (
        <div className="mobile-admin">
          <Nav administration route={route.path} navigate={navigate} canViewPage={canViewPage} user={user} can={can} />
        </div>
      )}
    </Dialog>
    <Dialog open={Boolean(pendingNavigation)} onClose={() => setPendingNavigation(null)} title="Tienes cambios sin guardar" footer={<><Button autoFocus onClick={() => setPendingNavigation(null)}>Seguir editando</Button><Button variant="danger" onClick={() => pendingNavigation?.()}>Descartar cambios y continuar</Button></>}>Si continúas, se perderán los datos del formulario que aún no has guardado.</Dialog>
    <Dialog open={Boolean(modal)} onClose={closeModal} title={modalTitle} wide={['resource', 'stock', 'request', 'device-detail'].includes(modal?.kind)} busy={releaseBusy}>
      {discardModal && <Notice title="¿Descartar los cambios sin guardar?" tone="warning" action={<div className="flex gap-2"><Button autoFocus onClick={() => setDiscardModal(false)}>Seguir editando</Button><Button variant="danger" onClick={() => { setModalDirty(false); setModal(null); }}>Descartar</Button></div>}>La información guardada anteriormente se conservará.</Notice>}
      {modal && ['resource', 'stock', 'ip', 'request'].includes(modal.kind) && <><EditForm key={`${modal.kind}-${modal.row?.id || modal.row?.ip || 'new'}`} kind={modal.kind} row={modal.row} data={data} save={saveEditor} cancel={closeModal} onDirty={setModalDirty} />{modal.kind === 'ip' && modal.row.status !== 'available' && <div className="danger-zone"><Button variant="danger" disabled={modalDirty} onClick={() => setModal({ kind: 'release', row: modal.row })}>Liberar dirección IP</Button><small>Elimina la asignación del inventario local.</small></div>}</>}
      {modal?.kind === 'release' && <><p>Se quitará la asignación de <strong>{modal.row.hostname || 'este equipo'}</strong> y la dirección quedará disponible en el inventario local. Esto no desconecta al equipo ni cambia el firewall.</p>{releaseError && <Notice title="Liberación sin confirmar" tone="danger">{releaseError}</Notice>}<div className="form-actions"><Button autoFocus disabled={releaseBusy} onClick={() => setModal(null)}>Cancelar</Button><Button variant="danger" busy={releaseBusy} disabled={releaseUncertain} onClick={releaseIp}>Liberar dirección</Button></div></>}
      {modal?.kind === 'qr' && <QrCard row={modal.row} demo={demo} toast={notify} />}
      {modal?.kind === 'device-detail' && <DeviceDetail row={modal.row} demo={demo} canReadTraffic={can('traffic.read')} />}
      {modal && ['request-detail', 'report-detail'].includes(modal.kind) && <dl className="detail-grid">{Object.entries(modal.kind === 'request-detail' ? { Folio: modal.row.id, Usuario: modal.row.name, Área: modal.row.area, Red: modal.row.network, Responsable: modal.row.actor, Fecha: dateTime(modal.row.date) } : { Folio: modal.row.id, IDF: modal.row.idf, Responsable: modal.row.actor, Actividad: modal.row.title, Descripción: modal.row.description, Temperatura: modal.row.temp == null ? '—' : `${modal.row.temp} °C`, Fecha: dateTime(modal.row.date) }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
      {modal?.kind === 'services' && <><ServiceStatus health={data.health} demo={demo} /><p className="muted">Que un servicio responda no garantiza que los equipos de red estén operativos.</p><Button icon={RefreshCw} busy={loading} onClick={refresh}>Actualizar información</Button></>}
      {modal?.kind === 'report-detail' && (modal.row.evidence || modal.row.evidenceDemo) && <figure className="evidence-preview"><img src={demo ? modal.row.evidenceDemo : `/api/reports/evidence/${encodeURIComponent(modal.row.evidence)}?view=1`} alt={`Evidencia fotográfica del reporte ${modal.row.id}`} /><figcaption>Evidencia fotográfica adjunta</figcaption><a className="button button-secondary evidence-download" href={demo ? modal.row.evidenceDemo : `/api/reports/evidence/${encodeURIComponent(modal.row.evidence)}`} download="evidencia-idf"><Download size={18} />Descargar</a></figure>}
      {modal?.kind === 'report-resolve' && <ResolveReport row={modal.row} save={resolveReport} />}
      {modal?.kind === 'report-detail' && modal.row.status !== 'resolved' && can('idf.visits.write') && (demo || modal.row.record_key) && <ResolveReport row={modal.row} save={resolveReport} />}
      {modal?.kind === 'access' && <>
        <Notice title={demo ? 'Identidad de demostración' : user.name}>
          {demo ? `Perfil de demostración (${roleLabel(user.role)}) · Datos ficticios.` : `Usuario: ${user.username} · Rol: ${roleLabel(user.role)}`}
        </Notice>
        {demo && (
          <div className="demo-role-selector">
            <p className="eyebrow">Probar rol en la demostración</p>
            <div className="demo-role-buttons">
              {roleInfo.map(r => (
                <Button
                  key={r.id}
                  variant={user.role === r.id ? 'primary' : 'secondary'}
                  onClick={() => switchDemoRole?.(r.id)}
                >
                  {roleLabel(r.id)}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="role-list">
          {roleInfo.map(role => (
            <div key={role.id}>
              <ShieldCheck size={25} />
              <div>
                <strong>{roleLabel(role.id)}</strong>
                <p>{role.description}</p>
              </div>
            </div>
          ))}
        </div>
        {logoutError && <Notice title="No se pudo cerrar la sesión" tone="danger">{logoutError}</Notice>}
        {!demo && <Button icon={LogOut} busy={logoutBusy} onClick={async () => { const exit = async () => { setLogoutBusy(true); setLogoutError(''); try { await signOut(); } catch (e) { setLogoutError(e.message); } finally { setLogoutBusy(false); } }; if (dirty) { setModal(null); setPendingNavigation(() => exit); } else await exit(); }}>Cerrar sesión</Button>}
      </>}
    </Dialog>
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{toast && <div className="toast"><CheckCircle2 size={21} /><span>{toast}</span><IconButton icon={X} label="Cerrar notificación" onClick={() => setToast('')} /></div>}</div>
  </>;
}
