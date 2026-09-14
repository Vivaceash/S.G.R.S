import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Building2, ChevronDown, CircleHelp, FileText, Home, Menu, RefreshCw, Server, ShieldCheck, Wifi, X, ArrowRight, Eye, CheckCircle2, Copy, Printer, Users, PlugZap, LogOut, Download } from 'lucide-react';
import { Badge, Button, Dialog, Empty, IconButton, Loading, Notice, SearchField } from './components.jsx';
import { Addresses, AuditLog, Devices, Inventory, Overview, PageHeading, Requests } from './pages.jsx';
import { EditForm, EntryForm } from './forms.jsx';
import { ApiError, roleLabel, dateTime, inventoryFromIdfs, reportsFromData, request } from './domain.mjs';
import { createDemo } from './demo.mjs';
import { useSession } from './session.jsx';
import { UsersPage, ConnectionsPage, initialDemoUsers, initialDemoConnections } from './admin.jsx';
import { TelemetryNav, TelemetryPage, useTelemetryCatalog } from './telemetry.jsx';
import '../qrcode.js';

const emptyData = () => ({ segments: [], ips: [], devices: [], resources: [], requests: [], idfs: [], reports: {}, health: null, updatedAt: null });
const navItems = [ ['resumen', 'Dashboard', Home], ['altas', 'Gestión de altas', Wifi], ['inventario', 'Inventario', Server], ['idf', 'Registro IDF', Building2], ['bitacora', 'Bitácora', FileText] ];
const adminItems = [['usuarios', 'Usuarios y privilegios', Users], ['conexiones', 'Conexiones API', PlugZap]];
const titles = { resumen: 'Dashboard Operativo', altas: 'Gestión de Altas de Red', inventario: 'Recursos Disponibles', disponibilidad: 'Direcciones IP', dispositivos: 'Dispositivos de Red', idf: 'Registro IDF', entrada: 'Registro IDF', bitacora: 'Bitácora de Registros', usuarios: 'Usuarios y privilegios', conexiones: 'Conexiones con las APIs' };
function readRoute() {
  let raw = location.hash.slice(1) || 'resumen';
  const [base, query = ''] = raw.split('?');
  const alias = { actividad: 'bitacora', reporte: 'entrada', qr: 'idf' };
  return { path: alias[base] || base, params: new URLSearchParams(query), raw };
}
function Nav({ route, navigate, administration = false }) {
  const active = ['disponibilidad', 'dispositivos'].includes(route) ? 'inventario' : route === 'entrada' ? 'idf' : route;
  return <nav className="main-nav" aria-label={administration ? 'Administración' : 'Navegación principal'}>{(administration ? adminItems : navItems).map(([path, label, Icon]) => <a key={path} href={`#${path}`} aria-current={active === path ? 'page' : undefined} onClick={e => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate(path); } }}><Icon size={23} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span></a>)}</nav>;
}
function Brand() { return <div className="brand-image" role="img" aria-label="ISSSTE · Instituto de Seguridad y Servicios Sociales de los Trabajadores del Estado" />; }
function ServiceStatus({ health, demo }) {
  return <div className="service-list">{[['FortiGate', health?.forti], ['OmniVista', health?.omni]].map(([name, status]) => <div key={name}><span>{name}</span><Badge status={status === true ? 'normal' : status === false ? 'offline' : 'unknown'}>{demo ? 'Ejemplo' : status === true ? 'Servicio responde' : status === false ? 'Sin conexión' : 'Sin verificar'}</Badge></div>)}</div>;
}
function QrCard({ row, demo, toast }) {
  const url = new URL(location.origin);
  url.hash = `reporte?idf=${encodeURIComponent(row.id)}`;
  if (demo) url.searchParams.set('demo', '1');
  const value = url.toString();
  const svg = window.QRCode.generateSvg(value, { size: 224, margin: 4, colorDark: '#222222', colorLight: '#ffffff' });
  return <div className="qr-card"><p className="eyebrow">Registro de entrada</p><h3>{row.name}</h3><p>{row.zone}</p><img width="224" height="224" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={`Código QR para registrar una visita a ${row.name}`} /><a className="qr-url" href={value}>{value}</a><div className="flex justify-center gap-3"><Button icon={Copy} onClick={async () => { try { await navigator.clipboard.writeText(value); toast('Enlace copiado.'); } catch { toast('No se pudo copiar. Selecciona el enlace para copiarlo manualmente.'); } }}>Copiar enlace</Button><Button icon={Printer} onClick={() => window.print()}>Imprimir</Button></div><p className="muted">El dispositivo que escanee debe poder acceder a esta dirección. Los enlaces localhost solo funcionan en este equipo.</p></div>;
}
function DeviceDetail({ row, demo }) {
  const { can } = useSession();
  const [traffic, setTraffic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = async () => {
    if (!can('traffic.read') || demo) return;
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setLoading(true); setError('');
    const timer = setTimeout(() => current.abort(), 12000);
    try { const json = await request(`/api/traffic/ip/${encodeURIComponent(row.ip)}?limit=20&direction=all`, { signal: current.signal }); if (controller.current === current) setTraffic(json.data || json); }
    catch (e) { if (controller.current === current) setError(e.name === 'AbortError' ? 'La consulta tardó demasiado. Puedes volver a intentar.' : e.message); }
    finally { clearTimeout(timer); if (controller.current === current) setLoading(false); }
  };
  return <><dl className="detail-grid">{[['Dirección IP', row.ip], ['MAC', row.mac], ['Fabricante', row.vendor], ['Sistema operativo', row.os], ['Interfaz', row.interface], ['Estado', row.status]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'No informado'}</dd></div>)}</dl>
    {can('traffic.read') && <>
      <Button icon={RefreshCw} busy={loading} disabled={demo || !row.ip || row.ip === '—'} onClick={load}>Consultar telemetría de tráfico</Button>
      {demo && <p className="muted">La telemetría requiere una conexión real con FortiGate.</p>}
      {error && <Notice title="No se pudo consultar el tráfico" tone="danger">{error}</Notice>}
      {traffic && <div className="traffic-summary"><h3>Telemetría consultada</h3><dl className="detail-grid"><div><dt>Sesiones activas</dt><dd>{traffic.active_sessions_count ?? '—'}</dd></div><div><dt>Bytes enviados</dt><dd>{traffic.total_sent_bytes ?? '—'}</dd></div><div><dt>Bytes recibidos</dt><dd>{traffic.total_rcvd_bytes ?? '—'}</dd></div></dl><h3>Sesiones recientes</h3>{traffic.sessions?.length ? <ul className="detail-list">{traffic.sessions.slice(0, 20).map((s, i) => <li key={i}><span>{s.dst_ip || s.src_ip || 'Destino no informado'}</span><span>{s.application || s.protocol_name || 'Sin clasificar'}</span></li>)}</ul> : <p>Sin sesiones reportadas.</p>}</div>}
    </>}
  </>;
}
export default function App() {
  const { demo, setDemo, user, can, signOut, roles: roleInfo } = useSession();
  const catalog = useTelemetryCatalog(!demo && can('traffic.read'));
  const [demoUsers, setDemoUsers] = useState(initialDemoUsers);
  const [demoConnections, setDemoConnections] = useState(initialDemoConnections);
  const [data, setData] = useState(() => demo ? createDemo() : emptyData());
  const [route, setRoute] = useState(readRoute);
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
  useEffect(() => {
    const title = route.path.startsWith('consulta/') ? can('traffic.read') ? catalog.modules.find(item => item.id === route.path.slice(9))?.title || 'Consultas de red' : 'Acceso restringido' : titles[route.path] || 'Página no encontrada';
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
  const toggleMode = () => {
    const apply = () => { const next = !demo; loadController.current?.abort(); generation.current++; setDemo(next); setData(next ? createDemo() : emptyData()); setErrors({}); setLoading(!next); setDirty(false); setPendingNavigation(null); setModal(null); const url = new URL(location.href); if (next) url.searchParams.set('demo', '1'); else url.searchParams.delete('demo'); history.replaceState(null, '', url); };
    if (dirty) setPendingNavigation(() => apply); else apply();
  };
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
    let incident = { id, date: now, severity: values.issue ? 'medium' : 'low', device: 'Gabinete', temp: Number(values.temp), title: values.issue ? 'Visita con inconvenientes' : 'Registro de entrada', description: [values.reason, values.issue ? values.description : ''].filter(Boolean).join(' · '), status: values.issue ? 'open' : 'resolved', tech: demo ? values.actor : user.name };
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
  const records = reportsFromData(data.reports, data.idfs);
  const shared = { data, demo, navigate, openEditor, loading, errors, refresh, canWrite: can('inventory.write'), canExport: can('inventory.export') };
  let page;
  if (route.path.startsWith('consulta/')) page = can('traffic.read') ? <TelemetryPage catalog={catalog} moduleId={route.path.slice(9)} resourceId={route.params.get('recurso')} navigate={navigate} /> : <PageHeading eyebrow="Acceso restringido · 403" title="No tienes permiso para esta sección" description="Usa la navegación para consultar las secciones disponibles en tu cuenta." />;
  else if (route.path === 'resumen') page = <Overview {...shared} userId={user.id} errors={Object.values(errors)} />;
  else if (route.path === 'altas') page = <Requests {...shared} />;
  else if (route.path === 'inventario') page = <Inventory {...shared} />;
  else if (route.path === 'disponibilidad') page = <Addresses {...shared} />;
  else if (route.path === 'dispositivos') page = <Devices {...shared} selectedSegment={route.params.get('segmento')} />;
  else if (['idf', 'entrada'].includes(route.path)) page = <><div className="idf-desktop"><AuditLog {...shared} records={records} idfView /></div><div className="idf-mobile"><EntryForm key={route.raw} {...shared} user={user} canRegister={can('idf.visits.write')} idfId={route.params.get('idf')} save={saveEntry} onDirty={setDirty} /></div></>;
  else if (route.path === 'bitacora') page = <AuditLog {...shared} records={records} />;
  else if (['usuarios', 'conexiones'].includes(route.path)) page = !can('users.manage') ? <><PageHeading eyebrow="Acceso restringido · 403" title="No tienes permiso para esta sección" description="Usa la navegación para consultar las secciones disponibles en tu cuenta." /><Button onClick={() => navigate('resumen')}>Volver al dashboard</Button></> : route.path === 'usuarios' ? <UsersPage demoUsers={demoUsers} setDemoUsers={setDemoUsers} notify={notify} /> : <ConnectionsPage demoConnections={demoConnections} setDemoConnections={setDemoConnections} onDirty={setDirty} notify={notify} />;
  else page = <><PageHeading eyebrow="Error 404" title="Página no encontrada" description="Esta sección no existe en el centro operativo." /><Empty action={<Button onClick={() => navigate('resumen')}>Ir al dashboard</Button>}>Usa la navegación para abrir una sección disponible.</Empty></>;
  const modalTitle = modal?.kind === 'ip' ? `Administrar ${modal.row.ip}` : modal?.kind === 'release' ? `Liberar ${modal.row.ip}` : modal?.kind === 'resource' || modal?.kind === 'stock' ? modal.row ? 'Actualizar recurso' : 'Agregar recurso' : modal?.kind === 'request' ? 'Nueva alta de red' : modal?.kind === 'qr' ? 'Código QR del gabinete' : modal?.kind === 'device-detail' ? modal.row.name : modal?.kind === 'request-detail' ? 'Detalle de solicitud' : modal?.kind === 'report-detail' ? 'Detalle del registro' : modal?.kind === 'services' ? 'Estado de los servicios' : 'Acceso y privilegios';
  return <>
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>Ir al contenido</a>
    <header className="institutional-header"><a href="#resumen" className="brand-link" onClick={e => { e.preventDefault(); navigate('resumen'); }}><Brand /></a><div className="header-title"><strong>Centro Operativo</strong><span>Redes e Infraestructura</span></div>
      <div className="header-search"><SearchField value={globalQuery} onChange={setGlobalQuery} label="Buscar una sección" placeholder="Buscar una sección del centro operativo…" />{globalQuery && <div className="global-results">{navItems.filter(([, label]) => label.toLocaleLowerCase('es-MX').includes(globalQuery.toLocaleLowerCase('es-MX'))).map(([path, label, Icon]) => <button type="button" key={path} onClick={() => { setGlobalQuery(''); navigate(path); }}><Icon size={18} />{label}<ArrowRight size={16} /></button>)}{!navItems.some(([, label]) => label.toLowerCase().includes(globalQuery.toLowerCase())) && <p>Sin secciones coincidentes.</p>}</div>}</div>
      <IconButton icon={Bell} label="Consultar estado de servicios" onClick={() => openEditor('services')} /><button className="account-button" type="button" onClick={() => openEditor('access')}><span className="avatar">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><span><strong>{user.name}</strong><small>{demo ? 'Perfil de ejemplo' : roleLabel(user.role)}</small></span><ChevronDown size={14} /></button><div className="mexico-wordmark">Servir a<br />México</div><IconButton icon={Menu} label="Abrir navegación" className="mobile-menu" aria-expanded={menu} onClick={() => setMenu(true)} /></header>
    <aside className="sidebar"><Nav route={route.path} navigate={navigate} />{can('traffic.read') && <div className="sidebar-admin"><p>Consultas de red</p><TelemetryNav modules={catalog.modules} route={route.path} navigate={navigate} />{catalog.error && <Button onClick={catalog.retry}>Reintentar navegación</Button>}</div>}<div className="sidebar-bottom"><Building2 size={28} strokeWidth={1.5} /><p>Dirección de Tecnologías<br />de la Información</p><small>ISSSTE<br />2026 · Centro Operativo SGRS</small></div>{can('users.manage') && <div className="sidebar-admin"><p>Administración</p><Nav administration route={route.path} navigate={navigate} /></div>}</aside>
    <main className="main-content" id="main-content" tabIndex={-1}><div className={`mode-bar ${demo ? 'mode-demo' : ''}`}><span>{demo ? 'Vista de demostración · Datos ficticios · Cambios solo en esta sesión' : 'Consulta de servicios e inventario local'}</span><div><button type="button" onClick={toggleMode}>{demo ? 'Volver a datos del sistema' : 'Ver demostración del diseño'}</button><IconButton icon={RefreshCw} label="Actualizar información" disabled={loading} className={loading ? 'refreshing' : ''} onClick={refresh} /></div></div>
      {Object.keys(errors).length > 0 && <Notice title="No se pudo actualizar toda la información" tone="warning" action={<Button onClick={refresh} busy={loading}>Reintentar</Button>}>Los datos conservados pueden estar desactualizados. Consultas pendientes: {Object.keys(errors).map(k => ({ idfs: 'IDFs', ips: 'direcciones IP', devices: 'dispositivos', reports: 'bitácora', health: 'servicios', segments: 'segmentos DHCP' })[k]).join(', ')}.</Notice>}
      {!can('inventory.write') && <Notice title="Perfil viewer · Solo consulta">Puedes revisar la información operativa. El registro y la edición requieren un perfil administrador.</Notice>}{page}
    </main>
    <Dialog open={menu} onClose={() => setMenu(false)} title="Centro Operativo"><Nav route={route.path} navigate={navigate} />{can('traffic.read') && <TelemetryNav modules={catalog.modules} route={route.path} navigate={navigate} />}{can('users.manage') && <div className="mobile-admin"><Nav administration route={route.path} navigate={navigate} /></div>}</Dialog>
    <Dialog open={Boolean(pendingNavigation)} onClose={() => setPendingNavigation(null)} title="Tienes cambios sin guardar" footer={<><Button autoFocus onClick={() => setPendingNavigation(null)}>Seguir editando</Button><Button variant="danger" onClick={() => pendingNavigation?.()}>Descartar cambios y continuar</Button></>}>Si continúas, se perderán los datos del formulario que aún no has guardado.</Dialog>
    <Dialog open={Boolean(modal)} onClose={closeModal} title={modalTitle} wide={['resource', 'stock', 'request', 'device-detail'].includes(modal?.kind)} busy={releaseBusy}>
      {discardModal && <Notice title="¿Descartar los cambios sin guardar?" tone="warning" action={<div className="flex gap-2"><Button autoFocus onClick={() => setDiscardModal(false)}>Seguir editando</Button><Button variant="danger" onClick={() => { setModalDirty(false); setModal(null); }}>Descartar</Button></div>}>La información guardada anteriormente se conservará.</Notice>}
      {modal && ['resource', 'stock', 'ip', 'request'].includes(modal.kind) && <><EditForm key={`${modal.kind}-${modal.row?.id || modal.row?.ip || 'new'}`} kind={modal.kind} row={modal.row} data={data} save={saveEditor} cancel={closeModal} onDirty={setModalDirty} />{modal.kind === 'ip' && modal.row.status !== 'available' && <div className="danger-zone"><Button variant="danger" disabled={modalDirty} onClick={() => setModal({ kind: 'release', row: modal.row })}>Liberar dirección IP</Button><small>Elimina la asignación del inventario local.</small></div>}</>}
      {modal?.kind === 'release' && <><p>Se quitará la asignación de <strong>{modal.row.hostname || 'este equipo'}</strong> y la dirección quedará disponible en el inventario local. Esto no desconecta al equipo ni cambia el firewall.</p>{releaseError && <Notice title="Liberación sin confirmar" tone="danger">{releaseError}</Notice>}<div className="form-actions"><Button autoFocus disabled={releaseBusy} onClick={() => setModal(null)}>Cancelar</Button><Button variant="danger" busy={releaseBusy} disabled={releaseUncertain} onClick={releaseIp}>Liberar dirección</Button></div></>}
      {modal?.kind === 'qr' && <QrCard row={modal.row} demo={demo} toast={notify} />}
      {modal?.kind === 'device-detail' && <DeviceDetail row={modal.row} demo={demo} />}
      {modal && ['request-detail', 'report-detail'].includes(modal.kind) && <dl className="detail-grid">{Object.entries(modal.kind === 'request-detail' ? { Folio: modal.row.id, Usuario: modal.row.name, Área: modal.row.area, Red: modal.row.network, Responsable: modal.row.actor, Fecha: dateTime(modal.row.date) } : { Folio: modal.row.id, IDF: modal.row.idf, Responsable: modal.row.actor, Actividad: modal.row.title, Descripción: modal.row.description, Temperatura: modal.row.temp == null ? '—' : `${modal.row.temp} °C`, Fecha: dateTime(modal.row.date) }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
      {modal?.kind === 'services' && <><ServiceStatus health={data.health} demo={demo} /><p className="muted">Que un servicio responda no garantiza que los equipos de red estén operativos.</p><Button icon={RefreshCw} busy={loading} onClick={refresh}>Actualizar información</Button></>}
      {modal?.kind === 'report-detail' && (modal.row.evidence || modal.row.evidenceDemo) && <a className="button button-secondary evidence-download" href={demo ? modal.row.evidenceDemo : `/api/reports/evidence/${encodeURIComponent(modal.row.evidence)}`} download="evidencia-idf"><Download size={18} />Descargar evidencia fotográfica</a>}
      {modal?.kind === 'access' && <><Notice title={demo ? 'Identidad de demostración' : user.name}>{demo ? 'Este perfil solo opera sobre datos ficticios.' : `Usuario: ${user.username} · Rol: ${roleLabel(user.role)}`}</Notice><div className="role-list">{roleInfo.map(role => <div key={role.id}><ShieldCheck size={25} /><div><strong>{roleLabel(role.id)}</strong><p>{role.description}</p></div></div>)}</div>{logoutError && <Notice title="No se pudo cerrar la sesión" tone="danger">{logoutError}</Notice>}{!demo && <Button icon={LogOut} busy={logoutBusy} onClick={async () => { const exit = async () => { setLogoutBusy(true); setLogoutError(''); try { await signOut(); } catch (e) { setLogoutError(e.message); } finally { setLogoutBusy(false); } }; if (dirty) { setModal(null); setPendingNavigation(() => exit); } else await exit(); }}>Cerrar sesión</Button>}</>}
    </Dialog>
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">{toast && <div className="toast"><CheckCircle2 size={21} /><span>{toast}</span><IconButton icon={X} label="Cerrar notificación" onClick={() => setToast('')} /></div>}</div>
  </>;
}
