import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, ArrowUpDown, Building2, Calendar, Camera, Check, CheckCircle2, Eye, Thermometer, ChevronDown, ChevronLeft, ChevronRight, Clock, Clock3, Copy, Download, FileText, Grid, HardDrive, Headset, Info, Laptop, Layers3, List, Monitor, Network, Package, Plus, Printer, Radio, RotateCcw, Router, Search, Server, ShieldCheck, Smartphone, Users, Wifi, TriangleAlert, ExternalLink, RefreshCw, X, LogIn, LogOut, UserPlus, KeyRound, PlugZap, MapPin, MapPinOff } from 'lucide-react';
import { Badge, Button, DataTable, Dialog, Empty, IconButton, Metric, Note, Notice, SearchField, Select, downloadCsv, downloadExcel, useListState } from './components.jsx';
import { dateTime, number, request, selectRows, segmentKey, deviceInSegment, getOverviewSegmentDevices, isMeztliSegment, paginate, formatDeviceType, formatLocation, getUtilizationTone, getUtilizationColor, statusNames, formatUptime, getSaturationStatus, getSaturationLabel, SUPPORT_EXPORT_COLUMNS, buildSupportSheets, getSupportSegments, normalizeText } from './domain.mjs';
import { useSession } from './session.jsx';
import { DashboardWidgets } from './dashboard-widgets.jsx';

export function PageHeading({ eyebrow, title, description, updatedAt, children, headingId = 'page-title' }) {
  const hasActions = Boolean(children);
  return <div className={`page-heading ${hasActions ? 'has-actions' : 'empty-heading'}`}>
    <div className="sr-only">
      {eyebrow && <p>{eyebrow}</p>}
      <h1 tabIndex={-1} id={headingId}>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {hasActions && <div className="page-heading-actions">
      {children}
    </div>}
  </div>;
}
const options = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es-MX', { numeric: true })).map(v => <option key={v} value={v}>{v}</option>);
const detailText = (primary, secondary) => <div className="cell-detail"><strong>{primary || '—'}</strong>{secondary && <small>{secondary}</small>}</div>;
// El prefijo 192.168. corresponde a la red institucional; en IPAM mostramos
// solamente el segmento y host para que las tarjetas sean más legibles.
const displayIp = value => String(value || '—').replace(/^192\.168\./, '');
const readStoredPrincipalSegments = key => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null;
  } catch {
    return null;
  }
};
const cachePrincipalSegments = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Account preferences remain authoritative when browser storage is unavailable. */ }
};

export function Overview({ data, demo, navigate, loading, errors, userId, openEditor, refresh }) {
  const [activeSegmentKey, setActiveSegmentKey] = useState(null);
  const devicesPanelRef = useRef(null);
  const { segments, ips, devices, resources } = data;
  const available = ips.filter(ip => ip.status === 'available').length;
  const online = devices.filter(d => d.status === 'online').length;
  const pressureSegments = segments.map(segment => {
    const capacity = Number(segment.capacity);
    const assigned = Number(segment.active_leases);
    const fillPercent = capacity > 0 && Number.isFinite(assigned) ? assigned / capacity * 100 : Number(segment.utilization_percent) || 0;
    return { ...segment, fillPercent };
  }).filter(segment => Number.isFinite(segment.fillPercent)).sort((a, b) => b.fillPercent - a.fillPercent).slice(0, 3);
  const [all, setAll] = useState(false);
  const preferenceKey = `sgrs:principal-segments:${demo ? 'demo' : userId}`;
  const [chosen, setChosen] = useState(() => readStoredPrincipalSegments(preferenceKey));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [preferenceError, setPreferenceError] = useState('');
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceSaved, setPreferenceSaved] = useState(false);
  const preferenceLoadId = useRef(0);
  useEffect(() => {
    if (!preferenceSaved) return undefined;
    const timer = setTimeout(() => setPreferenceSaved(false), 3500);
    return () => clearTimeout(timer);
  }, [preferenceSaved]);
  useEffect(() => {
    let alive = true;
    const loadId = ++preferenceLoadId.current;
    setPreferenceError('');
    if (demo) {
      setChosen(readStoredPrincipalSegments(preferenceKey));
      return () => { alive = false; };
    }
    const controller = new AbortController();
    setPreferenceBusy(true);
    setChosen(readStoredPrincipalSegments(preferenceKey));
    request('/api/dashboard/preferences', { signal: controller.signal }).then(async result => {
      if (!alive || loadId !== preferenceLoadId.current) return;
      const remote = result?.principal_segments;
      if (Array.isArray(remote)) {
        setChosen(remote);
        cachePrincipalSegments(preferenceKey, remote);
      } else {
        const stored = readStoredPrincipalSegments(preferenceKey);
        setChosen(stored);
        if (remote === null && stored !== null) {
          await request('/api/dashboard/preferences', { signal: controller.signal, body: { principal_segments: stored } });
        }
      }
    }).catch(error => {
      if (!alive || loadId !== preferenceLoadId.current || error.name === 'AbortError') return;
      setChosen(readStoredPrincipalSegments(preferenceKey));
      setPreferenceError('No se pudo consultar tu selección en la cuenta. Se muestra la última selección de este navegador, si está disponible.');
    }).finally(() => { if (alive && loadId === preferenceLoadId.current) setPreferenceBusy(false); });
    return () => { alive = false; controller.abort(); };
  }, [demo, userId, preferenceKey]);
  const principalKeys = chosen ?? segments.slice(0, 3).map(segmentKey);
  const activeSegment = segments.find(s => segmentKey(s) === activeSegmentKey) || null;
  const visibleSegments = all ? segments : segments.filter(s => principalKeys.includes(segmentKey(s)));
  const networkUsage = segments.map(segment => {
    const connected = Number(segment.active_leases) || 0;
    const capacity = Number(segment.capacity) || 0;
    return {
      segment,
      name: segment.name || segment.interface || 'Red sin nombre',
      connected,
      capacity,
      fillPercent: capacity > 0 ? connected / capacity * 100 : Number(segment.utilization_percent) || 0,
      online: getOverviewSegmentDevices(devices, segment).filter(device => device.status === 'online').length,
    };
  }).sort((a, b) => b.fillPercent - a.fillPercent || b.connected - a.connected || a.name.localeCompare(b.name, 'es-MX'));
  const highestNetworkUsage = Math.max(1, ...networkUsage.map(item => item.connected));
  const totalConnections = networkUsage.reduce((sum, item) => sum + item.connected, 0);
  const usageColors = ['#7a1235', '#b61c49', '#df5472', '#d39128', '#178e64', '#4789c8'];
  let accumulatedUsage = 0;
  const usageSlices = networkUsage.slice(0, 6).map((item, index) => {
    const start = totalConnections ? accumulatedUsage / totalConnections * 100 : 0;
    accumulatedUsage += item.connected;
    return { ...item, color: usageColors[index], start, end: totalConnections ? accumulatedUsage / totalConnections * 100 : 0 };
  });
  const remainingUsage = Math.max(0, totalConnections - usageSlices.reduce((sum, item) => sum + item.connected, 0));
  const usageChart = totalConnections ? `conic-gradient(${[...usageSlices.map(item => `${item.color} ${item.start}% ${item.end}%`), remainingUsage ? `#e9e5e2 ${accumulatedUsage / totalConnections * 100}% 100%` : ''].filter(Boolean).join(', ')})` : '#e9e5e2';
  const editSegments = () => { setDraft(principalKeys); setPreferenceError(''); setPreferenceSaved(false); setEditing(true); };
  const saveSegments = async () => {
    ++preferenceLoadId.current;
    setPreferenceBusy(true);
    setPreferenceError('');
    setPreferenceSaved(false);
    try {
      if (demo) {
        localStorage.setItem(preferenceKey, JSON.stringify(draft));
      } else {
        await request('/api/dashboard/preferences', { body: { principal_segments: draft } });
        cachePrincipalSegments(preferenceKey, draft);
      }
      setChosen(draft); setAll(false); setEditing(false); setPreferenceSaved(true);
    } catch (error) {
      setPreferenceError(error.message || 'No se pudo guardar la selección. Inténtalo de nuevo.');
    } finally {
      setPreferenceBusy(false);
    }
  };
  return <>
    <PageHeading eyebrow="Centro operativo" title="Dashboard Operativo" description="Métricas generales y estado de la infraestructura de red" updatedAt={data.updatedAt} />
    <DashboardWidgets key={`${demo ? 'demo' : 'live'}:${userId}`} data={data} demo={demo} userId={userId} navigate={navigate} loading={loading} errors={errors} refresh={refresh}>
    <section data-widget-id="metrics" className="overview-metrics" aria-label="Indicadores de infraestructura">
      <Metric icon={Network} label={demo ? 'Disponibilidad de red' : 'Direcciones disponibles'} value={demo ? '98.7%' : loading ? '—' : number(available)} caption={demo ? '+2.3% vs. mes anterior · Ejemplo' : 'Sin asignar en el inventario IP'} />
      <Metric icon={Monitor} tone="success" label="Dispositivos activos" value={loading ? '—' : number(online)} caption={`De ${number(devices.length)} equipos consultados`} />
      <Metric icon={Users} label="Concesiones activas" value={loading ? '—' : number(segments.reduce((sum, s) => sum + (s.active_leases || 0), 0))} caption="Asignaciones reportadas por DHCP" />
      <article className="network-pressure"><div className="network-pressure-header"><h3>Redes más cerca del límite</h3><small>uso de IPs</small></div>{pressureSegments.length ? <ol>{pressureSegments.map(segment => <li key={segmentKey(segment)}><span><strong>{segment.name || segment.interface || 'Red sin nombre'}</strong><small>{number(segment.active_leases)} / {number(segment.capacity)}</small></span><i><em style={{ width: `${Math.min(100, Math.max(0, segment.fillPercent))}%` }} /></i><b>{number(segment.fillPercent)}%</b></li>)}</ol> : <p className="muted">Sin datos de utilización por segmento.</p>}</article>
    </section>
    <section data-widget-id="segments" className="segment-section"><div className="section-heading"><Layers3 className="section-icon" size={31} aria-hidden="true" /><div><h2>Segmentos de Red y VLANs</h2><p>Capacidad y asignación de los principales segmentos de la infraestructura</p></div><div className="section-actions"><span>{number(segments.length)} segmentos</span><Button onClick={editSegments} icon={Plus} disabled={loading || preferenceBusy || !segments.length}>Elegir principales</Button><Button onClick={() => setAll(!all)} icon={ArrowRight}>{all ? 'Ver principales' : 'Ver todos'}</Button></div></div>
      {preferenceSaved && <Notice title="Preferencia guardada" role="status">{demo ? 'La selección se conserva en este navegador.' : 'La selección se conservará al volver a iniciar sesión.'}</Notice>}
      {preferenceError && !editing && <Notice title="Preferencia no disponible" tone="warning">{preferenceError}</Notice>}
      {segments.length ? <><div className="segment-grid">{visibleSegments.map((segment, index) => {
        const isSelected = activeSegmentKey === segmentKey(segment);
        const meterTone = getUtilizationTone(segment.utilization_percent);
        const meterColor = getUtilizationColor(segment.utilization_percent);
        return <article className={`segment-card segment-${index % 3} ${isSelected ? 'segment-card-selected' : ''}`} key={`${segment.id}-${segment.interface}`}>
        <div className="segment-card-heading"><h3><span className="segment-dot" />{segment.name || segment.interface}</h3><Badge status={segment.status} /></div>
        <div className="segment-address"><small>{segment.vlan || segment.interface}</small><strong>{segment.subnet || segment.ip_ranges?.[0] || 'Rango no informado'}</strong></div>
        <dl className="segment-details"><div><dt><Router size={16} />Gateway</dt><dd className="font-mono">{segment.default_gateway || '—'}</dd></div><div><dt><Network size={16} />Máscara</dt><dd className="font-mono">{segment.netmask || '—'}</dd></div><div><dt><FileText size={16} />IPs asignadas</dt><dd><strong>{number(segment.active_leases)} / {number(segment.capacity)}</strong></dd></div></dl>
        <dl className="segment-details segment-secondary"><div><dt><Monitor size={16} />{isMeztliSegment(segment) ? 'Concesiones DHCP' : 'Dispositivos en línea'}</dt><dd className="text-success"><strong>{isMeztliSegment(segment) ? number(segment.active_leases) : number(getOverviewSegmentDevices(devices, segment).filter(device => device.status === 'online').length)}</strong></dd></div><div><dt><Clock3 size={16} />{demo ? 'Promedio diario' : 'Duración de concesión'}</dt><dd>{demo ? number(segment.average) : segment.lease_time_seconds ? `${number(segment.lease_time_seconds)} s` : 'No informada'}</dd></div></dl>
        <div className={`capacity-meter capacity-meter-${meterTone}`} style={{ '--meter-fill': meterColor }}><meter min="0" max="100" value={segment.utilization_percent || 0} className={`meter-${meterTone}`} style={{ '--meter-fill': meterColor }} aria-label={`Utilización de ${segment.interface}`} /><small><span className={`meter-bullet meter-bullet-${meterTone}`} style={{ background: meterColor }} aria-hidden="true" />{number(segment.utilization_percent)}% utilizado</small></div>
        <div className="segment-description"><Building2 size={21} aria-hidden="true" /><p>{segment.description || `Pool de direcciones de la interfaz ${segment.interface}. Consulta los equipos asociados a este segmento.`}</p></div>
        <Button variant={isSelected ? 'secondary' : 'primary'} className={`w-full ${isSelected ? 'is-selected' : ''}`} icon={Server} aria-expanded={isSelected} onClick={() => { const key = segmentKey(segment); if (activeSegmentKey === key) { setActiveSegmentKey(null); } else { setActiveSegmentKey(key); setTimeout(() => { devicesPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60); } }}>{isSelected ? 'Ocultar dispositivos' : 'Ver dispositivos'} {isSelected ? <ChevronDown size={17} /> : <ArrowRight size={17} />}</Button>
      </article>; })}</div>{!visibleSegments.length && <Empty title="Sin segmentos principales" action={<Button icon={Plus} onClick={editSegments}>Elegir principales</Button>}>Agrega los segmentos que quieres ver en tu dashboard.</Empty>}</> : <div className="panel"><Empty title={loading ? 'Consultando segmentos de red' : 'Sin segmentos disponibles'}>{loading ? 'Espera mientras se consulta la capacidad DHCP.' : 'La conexión con el servicio DHCP no devolvió segmentos. Puedes revisar el inventario IP o actualizar la consulta.'}</Empty></div>}
    </section>
    <section data-widget-id="network" className="network-usage panel" aria-labelledby="network-usage-title">
      <div className="network-usage-heading"><div><p className="eyebrow">Conectividad por red</p><h2 id="network-usage-title">Usuarios conectados por red</h2><p>Distribución de las concesiones DHCP activas por segmento.</p></div><p className="network-usage-total"><strong>{number(totalConnections)}</strong><span>conexiones activas</span></p></div>
      {networkUsage.length ? <div className="network-usage-content">
        <div className="network-usage-chart" style={{ background: usageChart }} role="img" aria-label={`${number(totalConnections)} conexiones activas distribuidas en ${number(networkUsage.length)} redes`}><div><strong>{number(totalConnections)}</strong><span>conexiones</span></div></div>
        <div className="network-usage-list" aria-label="Redes con más conexiones">
          {usageSlices.map(item => <button type="button" className="network-usage-row" key={segmentKey(item.segment)} onClick={() => navigate(`dispositivos?segmento=${encodeURIComponent(segmentKey(item.segment))}`)} title={`Ver dispositivos de ${item.name}`}><span className="network-usage-name"><i style={{ background: item.color }} /><strong>{item.name}</strong><small>{item.segment.vlan || item.segment.interface || item.segment.subnet || 'Segmento de red'}</small></span><span className="network-usage-bar"><i><b style={{ width: `${Math.round(item.connected / highestNetworkUsage * 100)}%`, background: item.color }} /></i><strong>{number(item.connected)}<small>{item.segment.capacity ? ` / ${number(item.segment.capacity)}` : ''}</small></strong></span><span className="network-usage-online">{number(item.online)} <small>en línea</small></span></button>)}
          {remainingUsage > 0 && <p className="network-usage-more">+ {number(networkUsage.length - usageSlices.length)} redes adicionales · {number(remainingUsage)} conexiones</p>}
        </div>
      </div> : <Empty title="Sin conexiones por red">El servicio DHCP aún no devolvió concesiones activas por segmento.</Empty>}
      <p className="network-usage-note">Una concesión DHCP representa una conexión o dispositivo con dirección asignada; una persona puede usar más de un equipo.</p>
    </section>
    </DashboardWidgets>
    {activeSegment && <SegmentDevicesPanel panelRef={devicesPanelRef} segment={activeSegment} devices={devices} onClose={() => setActiveSegmentKey(null)} openEditor={openEditor} />}
    <Dialog open={editing} onClose={() => setEditing(false)} title="Elegir segmentos principales" wide busy={preferenceBusy}>
      <p className="muted">Selecciona las tarjetas que quieres mostrar al abrir el dashboard. {demo ? 'En la demostración se guarda en este navegador.' : 'La selección se guarda en tu cuenta y se conserva al volver a iniciar sesión.'}</p>
      <div className="segment-picker">{segments.map(segment => { const key = segmentKey(segment); const selected = draft.includes(key); return <article className="panel" key={key}><div><strong>{segment.name || segment.interface}</strong><p className="muted font-mono">{segment.subnet || segment.ip_ranges?.join(', ') || segment.default_gateway || 'Rango no informado'}</p></div><Button disabled={preferenceBusy} aria-pressed={selected} aria-label={`${selected ? 'Quitar' : 'Agregar'} ${segment.name || segment.interface}`} icon={selected ? Check : Plus} variant={selected ? 'primary' : 'secondary'} onClick={() => setDraft(old => selected ? old.filter(value => value !== key) : [...old, key])}>{selected ? 'Visible · Quitar' : 'Agregar'}</Button></article>; })}</div>
      {preferenceError && <Notice tone="danger" title="No se guardó la selección">{preferenceError}</Notice>}
      <div className="dialog-actions"><Button onClick={() => setEditing(false)} disabled={preferenceBusy}>Cancelar</Button><Button variant="primary" busy={preferenceBusy} onClick={saveSegments}>Guardar selección</Button></div>
    </Dialog>
    <Note>Consulta el inventario de {number(resources.length)} recursos y registra las visitas a los cuartos de telecomunicaciones. {demo ? 'Todas las cifras de esta vista son de demostración.' : 'La disponibilidad histórica y el estado global de la red aún no se calculan.'}</Note>
  </>;
}
export function Requests({ demo }) {
  const [tab, setTab] = useState('oficios'); // 'oficios' | 'all'
  const { canViewSubmodule } = useSession();
  const canViewOficios = canViewSubmodule('altas', 'oficios');
  const canViewAll = canViewSubmodule('altas', 'all');
  const visibleTab = (tab === 'oficios' && canViewOficios) || (tab === 'all' && canViewAll) ? tab : canViewOficios ? 'oficios' : 'all';
  const usersState = useListState('altas-usuarios');
  const oficiosState = useListState('altas-oficios');
  const [snapshot, setSnapshot] = useState({ users: [], sources: {}, loading: !demo, error: '', updatedAt: null });
  const [selectedUser, setSelectedUser] = useState(null);
  const [editingConcessionUser, setEditingConcessionUser] = useState(null);
  const [concessionDate, setConcessionDate] = useState('');
  const [concessionBusy, setConcessionBusy] = useState(false);
  const [concessionError, setConcessionError] = useState('');
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Abre el modal para modificar concesión cargando la fecha en formato YYYY-MM-DD
  const openConcessionModal = user => {
    setConcessionError('');
    setEditingConcessionUser(user);
    const ts = user.dateOfEffective ? Number(user.dateOfEffective) : (Date.now() + 7 * 86400000);
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    setConcessionDate(dateStr);
  };

  const handleSaveConcession = async () => {
    if (!editingConcessionUser || !concessionDate) return;
    // Fija la fecha al final del día seleccionado (23:59:59) en la hora local
    const [year, month, day] = concessionDate.split('-').map(Number);
    if (!year || !month || !day) {
      setConcessionError('Fecha no válida.');
      return;
    }
    const targetDate = new Date(year, month - 1, day, 23, 59, 59, 999);
    const targetTs = targetDate.getTime();
    if (isNaN(targetTs)) {
      setConcessionError('Fecha no válida.');
      return;
    }
    setConcessionBusy(true);
    setConcessionError('');
    try {
      if (demo) {
        setSnapshot(prev => ({
          ...prev,
          users: prev.users.map(u => u.username === editingConcessionUser.username ? { ...u, dateOfEffective: targetTs, customConcession: true } : u)
        }));
        setEditingConcessionUser(null);
      } else {
        const res = await request('/api/altas/concession', {
          body: {
            username: editingConcessionUser.username,
            dateOfEffective: targetTs,
            reason: 'Modificación de tiempo de concesión por administrador'
          }
        });
        if (!res.success) {
          throw new Error(res.error || 'No se pudo guardar la concesión.');
        }
        setSnapshot(prev => {
          const nextUsers = prev.users.map(u => {
            if (String(u.username).toLowerCase() === String(editingConcessionUser.username).toLowerCase()) {
              return { ...u, dateOfEffective: targetTs, customConcession: true };
            }
            return u;
          });
          return { ...prev, users: nextUsers };
        });
        setEditingConcessionUser(null);
        setRevision(v => v + 1);
      }
    } catch (err) {
      setConcessionError(err.message || 'Error al guardar la nueva fecha de concesión.');
    } finally {
      setConcessionBusy(false);
    }
  };

  // Actualizar el cronómetro local cada 10 segundos para mantener el conteo en tiempo real
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (demo) {
      // Demo mock con datos de ejemplo para oficios
      const sampleTime = Date.now() + 8 * 3600 * 1000;
      const demoUsers = [
        {
          username: 'bryan.castillo',
          fullName: 'Bryan Eduardo Castillo de Santia',
          department: 'Urgencias',
          position: 'Médico Residente',
          description: 'Oficio',
          dateOfEffective: sampleTime + 1200000,
          registeredAt: Date.now() - 3 * 86400000,
          status: 'online',
          accessRoleProfile: '__SSID-Ehecatl',
          devices: [{ deviceMac: '0E1D6C3CF78A', deviceName: 'bryan.castillo', status: 'online', cotejo: 'encontrado' }]
        },
        {
          username: 'josue.cruz',
          fullName: 'Josue de Jesus Cruz Cervantes',
          department: 'Medicina Interna',
          position: 'Interno',
          description: 'Oficio',
          dateOfEffective: sampleTime + 900000,
          registeredAt: Date.now() - 5 * 86400000,
          status: 'online',
          accessRoleProfile: '__SSID-Ehecatl',
          devices: [{ deviceMac: 'FCD202641F4F', deviceName: 'josue.cruz', status: 'online', cotejo: 'encontrado' }]
        },
        {
          username: 'jose.torres',
          fullName: 'Jose Luis Torres Preciado',
          department: 'Cirugía',
          position: 'Residente',
          description: 'Oficio',
          dateOfEffective: sampleTime + 600000,
          registeredAt: Date.now() - 7 * 86400000,
          status: 'online',
          accessRoleProfile: '__SSID-Ehecatl',
          devices: [{ deviceMac: 'EA0CFCE5F9D9', deviceName: 'jose.torres', status: 'online', cotejo: 'encontrado' }]
        }
      ];
      setSnapshot({ users: demoUsers, sources: {}, loading: false, error: '', updatedAt: new Date().toISOString() });
      return;
    }
    const controller = new AbortController(); let alive = true;
    setSnapshot(old => ({ ...old, loading: true, error: '' }));
    request('/api/altas/omnivista', { signal: controller.signal }).then(result => {
      if (!result.success && !result.data) throw new Error('OmniVista no confirmó la consulta.');
      const data = result.data || {};
      if (alive) {
        const users = Array.isArray(data.users) ? data.users : [];
        setSnapshot({ users, sources: data.sources || {}, loading: false, error: '', updatedAt: new Date().toISOString() });
        setSelectedUser(current => current ? users.find(user => user.username === current.username) || null : null);
      }
    }).catch(error => { if (alive) setSnapshot(old => ({ ...old, loading: false, error: error.name === 'AbortError' ? 'Consulta cancelada.' : error.message })); });
    return () => { alive = false; controller.abort(); };
  }, [demo, revision]);

  // Filtrado y cómputo de usuarios cuyo campo 'description' empiece o contenga "Oficio"
  const oficiosUsers = useMemo(() => {
    return snapshot.users
      .filter(user => {
        const desc = String(user.description || '').trim().toLowerCase();
        return desc.startsWith('oficio') || desc.includes('oficio');
      })
      .map(user => {
        const effectiveTime = user.dateOfEffective ? Number(user.dateOfEffective) : null;
        const diffMs = effectiveTime ? effectiveTime - now : null;
        return {
          ...user,
          effectiveTime,
          diffMs,
          isExpired: diffMs !== null && diffMs <= 0,
        };
      })
      .sort((a, b) => {
        // Ordenar primero los que van a expirar más pronto (menor diffMs positivo primero)
        if (a.diffMs === null && b.diffMs === null) return 0;
        if (a.diffMs === null) return 1;
        if (b.diffMs === null) return -1;
        // Los activos con menor tiempo restante van hasta arriba
        const aActive = a.diffMs > 0;
        const bActive = b.diffMs > 0;
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        if (aActive && bActive) return a.diffMs - b.diffMs;
        // Si ambos ya están vencidos, ordenar por el más recientemente vencido
        return b.diffMs - a.diffMs;
      });
  }, [snapshot.users, now]);

  const activeOficios = oficiosUsers.filter(u => !u.isExpired && u.diffMs !== null);
  const expiredOficios = oficiosUsers.filter(u => u.isExpired);
  // Se dan de baja hoy: activos a los que les quedan menos de 24 horas (< 86,400,000 ms)
  const expiringToday24h = oficiosUsers.filter(u => !u.isExpired && u.diffMs !== null && u.diffMs <= 24 * 3600 * 1000);
  // Cercanos a dar de baja: activos a los que les quedan 7 días o menos (<= 7 * 86,400,000 ms)
  const expiringSoon7Days = oficiosUsers.filter(u => !u.isExpired && u.diffMs !== null && u.diffMs <= 7 * 86400 * 1000);

  const deviceCount = snapshot.users.reduce((total, user) => total + (Array.isArray(user.devices) ? user.devices.length : 0), 0);
  const accountsWithDevices = useMemo(
    () => snapshot.users.filter(user => Array.isArray(user.devices) && user.devices.length > 0).length,
    [snapshot.users]
  );
  const accountsCoverage = snapshot.users.length ? Math.round((accountsWithDevices / snapshot.users.length) * 100) : 0;

  // Función para formatear el tiempo restante de concesión
  const formatCountdown = diffMs => {
    if (diffMs === null) return 'Sin fecha límite';
    if (diffMs <= 0) return 'Concesión expirada';
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes} min`;
  };

  const oficiosColumns = [
    {
      key: 'username',
      label: 'Usuario',
      render: row => (
        <div style={{ lineHeight: 1.25 }}>
          <span style={{ display: 'block', fontSize: '13px', fontWeight: 500 }}>{row.username}</span>
          <small className="text-muted" style={{ fontSize: '11px', display: 'block', maxWidth: '190px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.fullName}>
            {row.fullName || '—'}
          </small>
        </div>
      )
    },
    {
      key: 'timeRemaining',
      label: 'Concesión restante',
      sortable: false,
      render: row => {
        if (row.diffMs === null) return <span className="text-muted text-xs">Indefinido</span>;
        if (row.isExpired) {
          return (
            <span className="badge badge-danger concession-countdown">
              <Clock3 size={16} /> Expirado
            </span>
          );
        }
        const hours = row.diffMs / (3600 * 1000);
        const tone = hours < 3 ? 'danger' : hours < 12 ? 'warning' : 'info';
        return (
          <div className="concession-time">
            <span className={`badge badge-${tone} concession-countdown`}>
              <Clock size={16} /> {formatCountdown(row.diffMs)}
            </span>
            <small className="concession-expiry">
              Vence {new Date(row.effectiveTime).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </small>
          </div>
        );
      }
    },
    {
      key: 'devices',
      label: 'Dispositivos',
      sortable: false,
      render: row => {
        const devs = Array.isArray(row.devices) ? row.devices : [];
        if (!devs.length) return <span className="text-muted text-xs">0 equipos</span>;
        return (
          <Button variant="secondary" style={{ padding: '4px 9px', fontSize: '11.5px', minHeight: '30px' }} onClick={() => setSelectedUser(row)}>
            <Smartphone size={13} /> {devs.length} {devs.length === 1 ? 'eq.' : 'eqs.'} · Ver
          </Button>
        );
      }
    },
    {
      key: 'description',
      label: 'Motivo',
      render: row => {
        const text = String(row.description || 'Oficio').trim();
        return (
          <span
            className="oficio-badge"
            title={text}
          >
            {text.length > 22 ? `${text.slice(0, 20)}…` : text}
          </span>
        );
      }
    },
    {
      key: 'registeredAt',
      label: 'Fecha de alta',
      render: row => {
        const val = row.registeredAt;
        if (!val) return <span className="text-muted text-xs">—</span>;
        const d = new Date(Number(val));
        return (
          <div style={{ lineHeight: 1.25 }}>
            <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#334155', display: 'block' }}>
              {d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <small style={{ fontSize: '10px', color: '#64748b' }}>
              {d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
            </small>
          </div>
        );
      }
    },
    {
      key: 'department',
      label: 'Área',
      render: row => (
        <span style={{ fontSize: '12px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap' }} title={row.department}>
          {row.department || '—'}
        </span>
      )
    },
    {
      key: 'status',
      label: 'Estado',
      render: row => <Badge status={row.isExpired ? 'offline' : 'online'}>{row.isExpired ? 'Vencida' : 'Activo'}</Badge>
    },
    {
      key: 'actions',
      label: 'Acciones',
      sortable: false,
      render: row => (
        <Button
          variant="secondary"
          style={{ padding: '3px 8px', fontSize: '11px', minHeight: '28px', whiteSpace: 'nowrap' }}
          onClick={() => openConcessionModal(row)}
          title="Modificar tiempo de concesión"
        >
          <Calendar size={13} /> Modificar
        </Button>
      )
    }
  ];

  const userColumns = [
    { key: 'username', label: 'Cuenta' },
    { key: 'fullName', label: 'Nombre' },
    {
      key: 'registeredAt',
      label: 'Fecha de alta',
      render: row => row.registeredAt ? (
        <span style={{ fontSize: '12px' }}>
          {new Date(Number(row.registeredAt)).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
        </span>
      ) : <span className="text-muted text-xs">—</span>
    },
    { key: 'department', label: 'Departamento' },
    { key: 'position', label: 'Puesto' },
    { key: 'description', label: 'Descripción / Motivo' },
    { key: 'accessRoleProfile', label: 'Perfil de acceso' },
    { key: 'status', label: 'Estado', render: row => <Badge status={row.status} /> },
    {
      key: 'devices',
      label: 'Dispositivos',
      sortable: false,
      render: row => (Array.isArray(row.devices) && row.devices.length > 0) ? (
        <Button variant="secondary" onClick={() => setSelectedUser(row)}>
          {row.devices.length} {row.devices.length === 1 ? 'equipo' : 'equipos'} · Ver
        </Button>
      ) : (
        <span className="text-muted text-xs">Sin equipos</span>
      )
    }
  ];

  return (
    <>
      <PageHeading
        eyebrow="Gestión de altas · Consulta"
        title="Gestión de Altas de Red"
        description="Consulta de cuentas, concesiones temporales por oficio y cotejo de terminales en OmniVista con FortiGate."
        updatedAt={snapshot.updatedAt}
      />

      <div className="altas-banner-strip">
        <div className="altas-badge-readonly">
          <Info size={14} aria-hidden="true" />
          <span>Cotejo de Cuentas y Concesiones · OmniVista</span>
        </div>
        <p className="altas-readonly-desc">
          Supervisión de usuarios temporales por oficio y cómputo de tiempo de concesión restante para baja en red.
        </p>
        {snapshot.updatedAt && (
          <span className="altas-sync-time">
            Actualizado: {dateTime(snapshot.updatedAt)}
          </span>
        )}
      </div>

      {demo && <Notice title="Vista de demostración">Para consultar OmniVista cambia a datos del sistema e inicia sesión con una cuenta autorizada.</Notice>}
      {snapshot.error && <Notice title="No se pudo consultar OmniVista" tone="danger" action={<Button onClick={() => setRevision(value => value + 1)}>Reintentar</Button>}>{snapshot.error}</Notice>}

      <div className="metric-grid">
        <Metric
          icon={AlertCircle}
          tone="danger"
          label="Se dan de baja hoy"
          value={snapshot.loading ? '—' : number(expiringToday24h.length)}
          caption={`${number(expiredOficios.length)} concesiones ya vencidas`}
        />
        <Metric
          icon={Clock}
          tone="warning"
          label="Cercanos a dar de baja"
          value={snapshot.loading ? '—' : number(expiringSoon7Days.length)}
          caption="Vencen en los próximos 7 días"
        />
        <Metric
          icon={Users}
          label="Total por Oficio"
          value={snapshot.loading ? '—' : number(oficiosUsers.length)}
          caption="Cuentas activas con Oficio"
        />
        <Metric
          icon={Monitor}
          tone="success"
          label="Dispositivos asociados"
          value={snapshot.loading ? '—' : number(deviceCount)}
          caption={snapshot.sources.company_properties?.complete ? `${number(snapshot.sources.company_properties?.unassociated || 0)} sin cuenta coincidente` : 'Cotejo con FortiGate'}
        />
      </div>

      {/* Pestañas de Navegación de Altas */}
      <nav className="inventory-tabs" role="tablist" aria-label="Secciones de altas" style={{ marginTop: '18px' }}>
        {canViewOficios && <button
          type="button"
          role="tab"
          id="altas-tab-oficios"
          className={visibleTab === 'oficios' ? 'active' : ''}
          aria-selected={visibleTab === 'oficios'}
          onClick={() => setTab('oficios')}
        >
          <Clock size={16} /> Usuarios próximos a dar de baja ({activeOficios.length})
        </button>}
        {canViewAll && <button
          type="button"
          role="tab"
          id="altas-tab-all"
          className={visibleTab === 'all' ? 'active' : ''}
          aria-selected={visibleTab === 'all'}
          onClick={() => setTab('all')}
        >
          <Users size={16} /> Todas las cuentas ({snapshot.users.length})
        </button>}
      </nav>

      {visibleTab === 'oficios' ? (
        <DataTable
          title="Usuarios con concesión temporal por Oficio (Próximos a dar de baja)"
          className="oficios-table"
          rows={oficiosUsers}
          columns={oficiosColumns}
          state={oficiosState}
          noun="usuarios por oficio"
          loading={snapshot.loading}
          error={snapshot.error}
          onRetry={() => setRevision(value => value + 1)}
          exportable={!demo}
          emptyText="No se encontraron cuentas con descripción de Oficio en OmniVista."
          toolbar={
            <SearchField value={oficiosState.query} onChange={oficiosState.setQuery} placeholder="Buscar usuario, oficio, nombre o departamento…" />
          }
        />
      ) : (
        <DataTable
          title="Todas las cuentas de usuarios OmniVista"
          rows={snapshot.users}
          columns={userColumns}
          state={usersState}
          noun="cuentas"
          loading={snapshot.loading}
          error={snapshot.error}
          onRetry={() => setRevision(value => value + 1)}
          exportable={!demo}
          emptyText="OmniVista no devolvió cuentas en esta consulta."
          toolbar={
            <SearchField value={usersState.query} onChange={usersState.setQuery} placeholder="Buscar cuenta, nombre o departamento…" />
          }
        />
      )}

      <Dialog open={Boolean(selectedUser)} title={`Dispositivos de ${selectedUser?.username || 'la cuenta'}`} onClose={() => setSelectedUser(null)} wide>
        <div style={{ marginBottom: '14px' }}>
          <p className="muted" style={{ margin: 0 }}>Cotejo entre Company Property de OmniVista y el inventario observado por FortiGate.</p>
          {selectedUser?.description && (
            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px' }}>
              <strong>Motivo de alta / Oficio:</strong> {selectedUser.description}
              {selectedUser.dateOfEffective && (
                <span style={{ display: 'block', marginTop: '3px', color: '#64748b' }}>
                  Límite de concesión: {new Date(Number(selectedUser.dateOfEffective)).toLocaleString('es-MX')}
                </span>
              )}
            </div>
          )}
        </div>
        {selectedUser?.devices?.length ? (
          <div className="detail-list">
            {selectedUser.devices.map((device, index) => (
              <article className="panel" key={`${device.deviceMac || device.id || index}`}>
                <div className="flex items-center justify-between gap-3">
                  <strong>{device.deviceName || device.deviceMac || 'Dispositivo sin nombre'}</strong>
                  <Badge status={device.forti?.status || device.status} />
                </div>
                <dl className="detail-grid">
                  <div><dt>MAC</dt><dd className="font-mono">{device.deviceMac || '—'}</dd></div>
                  <div><dt>Equipo OmniVista</dt><dd>{device.lastAccessDeviceName || '—'}</dd></div>
                  <div><dt>Categoría / familia</dt><dd>{[device.deviceCategory, device.deviceFamily].filter(Boolean).join(' · ') || '—'}</dd></div>
                  <div><dt>Sistema operativo</dt><dd>{device.deviceOS || '—'}</dd></div>
                  <div><dt>Cotejo</dt><dd>{device.cotejo}</dd></div>
                  {device.forti && <>
                    <div><dt>FortiGate · IP</dt><dd className="font-mono">{device.forti.ip || '—'}</dd></div>
                    <div><dt>FortiGate · tipo / interfaz</dt><dd>{[device.forti.type, device.forti.interface].filter(Boolean).join(' · ') || '—'}</dd></div>
                    <div><dt>FortiGate · última detección</dt><dd>{device.forti.last_seen || '—'}</dd></div>
                  </>}
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="Sin dispositivos asociados">OmniVista no tiene terminales asociadas a esta cuenta en la consulta actual.</Empty>
        )}
      </Dialog>

      {/* Modal / Diálogo para modificar tiempo de concesión con calendario */}
      <Dialog
        open={Boolean(editingConcessionUser)}
        title={`Modificar tiempo de concesión · ${editingConcessionUser?.username || ''}`}
        onClose={() => !concessionBusy && setEditingConcessionUser(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
            Selecciona la nueva fecha y hora límite en la que la cuenta de <strong>{editingConcessionUser?.fullName || editingConcessionUser?.username}</strong> finalizará su concesión y deberá ser dada de baja en la red.
          </p>

          {editingConcessionUser && (
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div><strong>Cuenta:</strong> <span className="font-mono">{editingConcessionUser.username}</span></div>
              {editingConcessionUser.department && <div><strong>Área:</strong> {editingConcessionUser.department}</div>}
              {editingConcessionUser.description && <div><strong>Oficio / Motivo:</strong> {editingConcessionUser.description}</div>}
              <div>
                <strong>Límite registrado actualmente:</strong>{' '}
                {editingConcessionUser.dateOfEffective
                  ? new Date(Number(editingConcessionUser.dateOfEffective)).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
                  : 'Sin fecha asignada'}
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="concession-date-picker" style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={16} /> Fecha de vencimiento (Día)
            </label>
            <input
              id="concession-date-picker"
              type="date"
              value={concessionDate}
              onChange={e => setConcessionDate(e.target.value)}
              className="form-input"
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                marginTop: '6px'
              }}
            />
            <small className="field-help" style={{ color: '#64748b', marginTop: '4px', display: 'block' }}>
              Selecciona únicamente el día límite para dar de baja al usuario en la red.
            </small>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '11.5px', color: '#64748b' }}>Accesos rápidos:</span>
            {[
              { label: 'Mañana', days: 1 },
              { label: '+3 días', days: 3 },
              { label: '+7 días', days: 7 },
              { label: '+15 días', days: 15 },
              { label: '+30 días', days: 30 }
            ].map(preset => (
              <button
                key={preset.label}
                type="button"
                className="button button-ghost"
                style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px', border: '1px solid #e2e8f0' }}
                onClick={() => {
                  const d = new Date(Date.now() + preset.days * 86400 * 1000);
                  const pad = n => String(n).padStart(2, '0');
                  setConcessionDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {concessionError && (
            <Notice tone="danger" title="Error al guardar">{concessionError}</Notice>
          )}

          <div className="dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <Button onClick={() => setEditingConcessionUser(null)} disabled={concessionBusy}>
              Cancelar
            </Button>
            <Button variant="primary" busy={concessionBusy} onClick={handleSaveConcession}>
              Guardar nueva concesión
            </Button>
          </div>
        </div>
      </Dialog>

      <Note title="Alcance de la consulta">La pestaña de usuarios próximos a dar de baja filtra automáticamente las cuentas cuya descripción inicia o contiene "Oficio", calculando el tiempo restante de concesión y priorizando a los que están más próximos a vencer.</Note>
    </>
  );
}
export function Inventory({ data, demo, navigate, openEditor, errors, loading, refresh, canWrite, canExport }) {
  const state = useListState('recursos');
  const resources = selectRows(data.resources, '', state.filters);
  const count = key => resources.reduce((sum, r) => sum + (r[key] || 0), 0);
  const columns = [
    { key: 'name', label: 'Recurso', render: r => <div className="resource-name"><Server size={24} strokeWidth={1.5} />{detailText(r.name, r.description || r.brand)}</div> },
    { key: 'category', label: 'Categoría' },
    ...(demo ? [{ key: 'quantity', label: 'Existencia actual', render: r => <strong className="tabular-nums">{r.quantity}</strong> }, { key: 'available', label: 'Disponibles' }]
      : [{ key: 'ru', label: 'Nivel en rack' }, { key: 'serial', label: 'Número de serie', render: r => <span className="font-mono">{r.serial || '—'}</span> }]),
    { key: 'status', label: 'Estado', render: r => <Badge status={r.status} /> },
    { key: 'idf', label: 'IDF / Ubicación', render: r => detailText(r.idf, r.zone) },
    { key: 'actions', label: 'Acciones', sortable: false, render: r => <Button disabled={!canWrite} onClick={() => openEditor(demo ? 'stock' : 'resource', r)}>Actualizar</Button> },
  ];
  return <><PageHeading eyebrow="Inventario de infraestructura" title="Recursos Disponibles" description="Consulta y gestión del inventario por IDF y segmento de red" updatedAt={data.updatedAt} />
    <div className="toolbar"><Select label="IDF / MDF" value={state.filters.idf || ''} onChange={e => state.setFilter('idf', e.target.value)}><option value="">Todos los IDFs</option>{options(data.resources.map(r => r.idf))}</Select><Select label="Categoría" value={state.filters.category || ''} onChange={e => state.setFilter('category', e.target.value)}><option value="">Todas las categorías</option>{options(data.resources.map(r => r.category))}</Select><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar recurso, categoría o descripción…" /><Button icon={Plus} variant="primary" onClick={() => openEditor(demo ? 'stock' : 'resource')} disabled={!data.idfs.length || !canWrite}>Agregar recurso</Button></div>
    <section className="metric-grid"><Metric icon={Layers3} label="Total de recursos" value={number(resources.length)} caption={demo ? 'tipos de recursos' : 'equipos registrados'} /><Metric icon={Package} tone="gold" label={demo ? 'Existencia total' : 'Gabinetes'} value={number(demo ? count('quantity') : new Set(resources.map(r => r.idf)).size)} caption={demo ? 'unidades en inventario' : 'con equipos registrados'} /><Metric icon={CheckCircle2} tone="success" label={demo ? 'Disponibles' : 'En servicio'} value={number(demo ? count('available') : resources.filter(r => r.status === 'online').length)} caption={demo ? 'unidades disponibles' : 'según el inventario'} /><Metric icon={TriangleAlert} tone="danger" label={demo ? 'Stock crítico' : 'Fuera de servicio'} value={number(resources.filter(r => demo ? r.status === 'critical' : r.status === 'offline').length)} caption="requieren atención" /></section>
    <DataTable title="Listado de recursos" rows={data.resources} columns={columns} state={state} noun="recursos" exportable={canExport} loading={loading} error={errors.idfs} onRetry={refresh} toolbar={<div className="section-heading compact"><Server size={28} className="section-icon" /><div><h2>Listado de recursos {state.filters.idf ? `en ${state.filters.idf}` : 'de infraestructura'}</h2><p>{demo ? 'Administra la existencia de los recursos de infraestructura.' : 'Inventario físico de equipos. Las existencias por unidades se incorporarán en una etapa posterior.'}</p></div></div>} />
    <Note>Verifica el IDF, la identificación del equipo y su estado antes de guardar. Solo los perfiles operativos pueden modificar el inventario.</Note></>;
}
export function Addresses({ data, navigate, openEditor, loading, errors, refresh, canWrite, canExport }) {
  const state = useListState('ips');
  const { canViewSubmodule } = useSession();
  const canViewList = canViewSubmodule('disponibilidad', 'list');
  const canViewMatrix = canViewSubmodule('disponibilidad', 'matrix');
  const rows = data.ips.map(r => ({ ...r, id: r.ip }));
  const [view, setView] = useState('matrix');
  const visibleView = (view === 'matrix' && canViewMatrix) || (view === 'list' && canViewList) ? view : canViewMatrix ? 'matrix' : 'list';
  const columns = [{ key: 'ip', label: 'Dirección IP', render: r => <strong className="ip-address" title={r.ip}>{displayIp(r.ip)}</strong> }, { key: 'vlan', label: 'VLAN / Segmento' }, { key: 'location', label: 'Ubicación' }, { key: 'type', label: 'Tipo de uso' }, { key: 'status', label: 'Estado', render: r => <Badge status={r.status} /> }, { key: 'hostname', label: 'Equipo asignado' }, { key: 'actions', label: 'Acciones', sortable: false, render: r => <Button disabled={!canWrite} onClick={() => openEditor('ip', r)}>{r.status === 'available' ? 'Asignar' : 'Administrar'}</Button> }];
  const filtered = selectRows(rows, state.query, state.filters, state.sort, state.asc);
  const segmentRows = state.filters.vlan ? rows.filter(row => row.vlan === state.filters.vlan) : rows;
  const counts = ['all', 'available', 'occupied', 'reserved'].reduce((result, status) => ({ ...result, [status]: status === 'all' ? segmentRows.length : segmentRows.filter(row => row.status === status).length }), {});
  const filteredBySegment = filtered.reduce((groups, row) => { const key = row.vlan || 'Sin segmento'; (groups[key] ||= []).push(row); return groups; }, {});
  const chooseStatus = status => state.setFilter('status', status === 'all' ? '' : status);
  const labelForStatus = status => ({ available: 'Libre', occupied: 'Ocupada', reserved: 'Reservada' }[status] || 'Sin estado');
  return <><PageHeading eyebrow="Inventario de infraestructura" title="Direcciones IP" description="Consulta de direcciones disponibles y asignadas por segmento de red" updatedAt={data.updatedAt} />
    <section className="ip-kpi-grid" aria-label="Resumen de direcciones IP">{[
      ['all', 'Total direcciones', counts.all, 'Todos los segmentos'], ['available', 'Libres disponibles', counts.available, 'Listas para asignación'], ['occupied', 'IPs ocupadas', counts.occupied, 'Asignadas en producción'], ['reserved', 'Reservadas / gateways', counts.reserved, 'Gateways y VIPs de enlace'],
    ].map(([status, label, value, caption]) => <button key={status} type="button" className={`ip-kpi ip-kpi-${status} ${(!state.filters.status && status === 'all') || state.filters.status === status ? 'is-active' : ''}`} onClick={() => chooseStatus(status)}><span>{label}</span><strong>{number(value)}</strong><i style={{ width: `${counts.all ? Math.round(value / counts.all * 100) : 0}%` }} /><small>{caption}</small></button>)}</section>
    <div className="toolbar ip-toolbar"><Select label="VLAN / Segmento" value={state.filters.vlan || ''} onChange={e => state.setFilter('vlan', e.target.value)}><option value="">Todos los segmentos</option>{options(rows.map(r => r.vlan))}</Select><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar IP, host, MAC o ubicación…" /><div className="ip-status-filters" aria-label="Filtrar por estado">{[['all', 'Todas'], ['available', 'Libres'], ['occupied', 'Ocupadas'], ['reserved', 'Reservadas']].map(([status, label]) => <button type="button" key={status} aria-pressed={(!state.filters.status && status === 'all') || state.filters.status === status} onClick={() => chooseStatus(status)}>{label} <b>{number(counts[status])}</b></button>)}</div><div className="ip-view-toggle" aria-label="Vista de direcciones">{canViewList && <button type="button" aria-pressed={visibleView === 'list'} onClick={() => setView('list')}>☷ Lista</button>}{canViewMatrix && <button type="button" aria-pressed={visibleView === 'matrix'} onClick={() => setView('matrix')}>▦ Matriz</button>}</div></div>
    {visibleView === 'matrix' ? <section className="ip-matrix" aria-label="Matriz de direcciones IP">{loading ? <div className="loading-state">Cargando direcciones IP…</div> : errors.ips ? <Notice title="No se pudieron cargar las direcciones" tone="warning" action={<Button onClick={refresh}>Reintentar</Button>}>{errors.ips}</Notice> : Object.entries(filteredBySegment).map(([segment, ips]) => <section key={segment} className="ip-segment"><div><h2>{segment}</h2><span>{ips.length} IPs</span></div><article>{ips.map(ip => <button key={ip.ip} type="button" className={`ip-cell ip-cell-${ip.status}`} onClick={() => openEditor('ip', ip)} title={`${ip.ip} · ${labelForStatus(ip.status)}${ip.hostname ? ` · ${ip.hostname}` : ''}`}><strong>{displayIp(ip.ip)}</strong><small><i />{labelForStatus(ip.status)}</small></button>)}</article></section>)}{!loading && !errors.ips && !filtered.length && <Empty title="Sin direcciones coincidentes">Modifica los filtros o busca otra dirección.</Empty>}</section> : <DataTable title="Direcciones IP" rows={rows} columns={columns} state={state} noun="direcciones" loading={loading} error={errors.ips} onRetry={refresh} />}
    <Note>Las asignaciones modifican el inventario local. No cambian reservas DHCP ni aplican configuraciones al firewall.</Note></>;
}
export function CopyButton({ text, title = 'Copiar', className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!text || text === '—' || text === 'Pendiente de confirmar') return null;

  const handleCopy = async e => {
    e.stopPropagation();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      className={`inline-copy-btn ${copied ? 'is-copied' : ''} ${className}`}
      onClick={handleCopy}
      title={copied ? '¡Copiado!' : title}
      aria-label={copied ? '¡Copiado!' : title}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied && <span className="copy-tooltip">Copiado</span>}
    </button>
  );
}

export function DeviceTypeBadge({ type }) {
  let Icon = HardDrive;
  let label = type || 'Dispositivo';
  let theme = 'type-other';

  if (type === 'Computadora') {
    Icon = Monitor;
    label = 'Computadora';
    theme = 'type-computer';
  } else if (type === 'Impresora') {
    Icon = Printer;
    label = 'Impresora';
    theme = 'type-printer';
  } else if (type === 'Teléfono') {
    Icon = Smartphone;
    label = 'Teléfono';
    theme = 'type-phone';
  } else if (['Equipo de red', 'Router', 'Switch', 'Access Point'].includes(type)) {
    Icon = Router;
    label = type;
    theme = 'type-network';
  }

  return (
    <span className={`device-type-badge ${theme}`}>
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function Devices({ data, navigate, openEditor, loading, errors, refresh, canExport, selectedSegment }) {
  const state = useListState('equipos');
  const segment = data.segments.find(item => segmentKey(item) === selectedSegment);
  const eligible = data.devices.filter(device => device.status === 'online' || device.is_reserved === true);
  const devices = selectedSegment ? eligible.filter(device => deviceInSegment(device, segment)) : eligible;
  const omniMatchedCount = devices.filter(d => d.omnivista?.matched).length;
  const typeOptions = Array.from(new Set(devices.map(d => formatDeviceType(d.type, d.os || d.omnivista?.os || d.raw?.os_name, d.omnivista?.device_name || d.name, d.vendor)).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  const vendorOptions = Array.from(new Set(devices.map(d => d.vendor).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  const sizeChoice = ['25', '50', '100', 'all'].includes(state.pageSize) ? state.pageSize : '25';
  const pageSize = sizeChoice === 'all' ? Math.max(1, devices.length) : Number(sizeChoice);

  const columns = [
    {
      key: 'name',
      label: 'Dispositivo',
      value: r => r.omnivista?.device_name || r.name,
      render: r => (
        <div className="cell-detail">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="device-name-text">{r.omnivista?.device_name || r.name}</strong>
            {r.omnivista?.matched && <span className="network-tag omni-tag" title="Cotejado con Company Property de OmniVista 2500">OmniVista</span>}
          </div>
          <div className="device-vendor-line">
            {r.vendor && <span className="vendor-pill">{r.vendor}</span>}
            {r.omnivista?.account && <small className="text-muted">Cuenta: {r.omnivista.account}</small>}
            {r.name !== r.omnivista?.device_name && r.name && <small className="text-muted">Forti: {r.name}</small>}
          </div>
        </div>
      )
    },
    {
      key: 'ip',
      label: 'Dirección IP',
      value: r => r.ip_source === 'unconfirmed' ? 'Pendiente de confirmar' : (r.ip || '—'),
      render: r => {
        const isConfirmed = r.ip_source !== 'unconfirmed' && r.ip && r.ip !== '—';
        const ipText = isConfirmed ? r.ip : (r.ip_source === 'unconfirmed' ? 'Pendiente de confirmar' : '—');
        return (
          <div className="cell-detail">
            <div className="flex items-center gap-1.5">
              <span className={`ip-address ${!isConfirmed ? 'ip-unconfirmed' : ''}`}>{ipText}</span>
              {isConfirmed && <CopyButton text={r.ip} title="Copiar dirección IP" />}
            </div>
            {r.is_reserved && (
              <small className="ip-reserved-tag">
                IP reservada{r.reserved_ip && r.reserved_ip !== r.ip ? `: ${r.reserved_ip}` : ''}
              </small>
            )}
          </div>
        );
      }
    },
    {
      key: 'mac',
      label: 'MAC',
      value: r => r.mac || '—',
      render: r => (
        <div className="flex items-center gap-1.5 font-mono text-muted text-xs">
          <span>{r.mac || '—'}</span>
          {r.mac && r.mac !== '—' && <CopyButton text={r.mac} title="Copiar dirección MAC" />}
        </div>
      )
    },
    {
      key: 'type',
      label: 'Tipo',
      value: r => formatDeviceType(r.type, r.os || r.omnivista?.os || r.raw?.os_name, r.omnivista?.device_name || r.name, r.vendor),
      render: r => <DeviceTypeBadge type={formatDeviceType(r.type, r.os || r.omnivista?.os || r.raw?.os_name, r.omnivista?.device_name || r.name, r.vendor)} />
    },
    {
      key: 'location',
      label: 'Ubicación',
      value: r => r.omnivista?.location || formatLocation(r.location, r.vendor, segment?.name || r.interface),
      render: r => {
        if (r.omnivista?.location) {
          return (
            <div className="cell-detail">
              <strong className="text-location">{r.omnivista.location}</strong>
              {r.omnivista.ap_name && <small className="text-muted">AP: {r.omnivista.ap_name}</small>}
            </div>
          );
        }
        const loc = formatLocation(r.location, r.vendor, segment?.name || r.interface);
        return (!loc || loc === '—') ? <span className="location-empty">Sin ubicación</span> : <span className="location-text">{loc}</span>;
      }
    },
    {
      key: 'status',
      label: 'Estado reportado',
      value: r => statusNames[r.status] || r.status,
      render: r => <Badge status={r.status} />
    },
    {
      key: 'activity',
      label: 'Última actividad',
      value: r => r.activity || r.last_seen || 'Reciente',
      render: r => <span className="text-muted text-xs">{r.activity || r.last_seen || 'Reciente'}</span>
    }
  ];

  const rows = devices.map((d, i) => {
    const computedType = formatDeviceType(d.type, d.os || d.omnivista?.os || d.raw?.os_name, d.omnivista?.device_name || d.name, d.vendor) || '';
    return {
      ...d,
      id: `${d.interface || ''}:${d.mac || d.ip}:${i}`,
      type: computedType,
      vendor: d.vendor || '',
      _search_name: d.omnivista?.device_name || d.name || '',
      _search_loc: d.omnivista?.location || formatLocation(d.location, d.vendor, segment?.name || d.interface) || '',
      _search_type: computedType,
      _search_acc: d.omnivista?.account || '',
      _search_ap: d.omnivista?.ap_name || '',
      _search_mac: d.mac || '',
    };
  });

  return (
    <>
      <PageHeading eyebrow="Inventario de infraestructura" title="Dispositivos de Red" description="Equipos detectados y consulta de información técnica" updatedAt={data.updatedAt} />

      {selectedSegment && (
        <Notice
          title={segment ? `Segmento: ${segment.name || segment.interface}` : 'Segmento no disponible'}
          action={<Button onClick={() => { state.setPage(1); navigate('dispositivos'); }}>Ver todos los segmentos</Button>}
        >
          {segment ? [segment.subnet, segment.default_gateway && `Gateway ${segment.default_gateway}`, segment.netmask && `Máscara ${segment.netmask}`].filter(Boolean).join(' · ') || segment.ip_ranges?.join(', ') : 'Actualiza la consulta para cargar este segmento.'}
        </Notice>
      )}

      <div className="toolbar devices-toolbar">
        <div className="devices-toolbar-main">
          <SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar por equipo, IP, MAC o fabricante…" />
          <div className="devices-filters-group">
            <Select label="Tipo de dispositivo" value={state.filters.type || ''} onChange={e => state.setFilter('type', e.target.value)} className="devices-filter-select">
              <option value="">Todos los tipos</option>
              {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
            <Select label="Marca / Fabricante" value={state.filters.vendor || ''} onChange={e => state.setFilter('vendor', e.target.value)} className="devices-filter-select">
              <option value="">Todas las marcas</option>
              {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
            <Select label="Estado" value={state.filters.status || ''} onChange={e => state.setFilter('status', e.target.value)} className="devices-filter-select">
              <option value="">Todos los estados</option>
              <option value="online">En servicio</option>
              <option value="offline">Reservados fuera de línea</option>
            </Select>
            <Select label="Por página" value={sizeChoice} onChange={e => state.setPageSize(e.target.value)} className="devices-filter-select">
              <option value="25">25 dispositivos</option>
              <option value="50">50 dispositivos</option>
              <option value="100">100 dispositivos</option>
              <option value="all">Todos</option>
            </Select>
          </div>
          {canExport && (
            <Button
              icon={Download}
              disabled={!devices.length}
              onClick={() => downloadCsv('Dispositivos-de-Red', columns, rows)}
              className="devices-export-btn"
            >
              Exportar
            </Button>
          )}
        </div>
        <div className="devices-toolbar-right">
          {omniMatchedCount > 0 && <span className="network-tag omni-badge">{number(omniMatchedCount)} cotejados en OmniVista</span>}
          <div className="segment-devices-hint">
            <Info size={16} aria-hidden="true" />
            <span>Selecciona cualquier fila para abrir el detalle técnico</span>
          </div>
        </div>
      </div>

      <DataTable
        title="Dispositivos de red"
        rows={rows}
        columns={columns}
        state={state}
        pageSize={pageSize}
        noun="dispositivos"
        exportable={false}
        loading={loading}
        error={errors.devices || (selectedSegment && errors.segments)}
        onRetry={refresh}
        onRowClick={r => openEditor('device-detail', r)}
        rowClassName={r => r.status === 'offline' ? 'segment-device-row device-row-offline' : 'segment-device-row'}
      />

      <Note>
        Se muestran equipos en línea y equipos con reserva DHCP, aunque estén desconectados. El estado en línea proviene de FortiGate. Las IP se actualizan por MAC con DHCP y ARP; los equipos sin dirección confirmada permanecen visibles en su interfaz. Los registros históricos sin reserva se excluyen.
      </Note>
    </>
  );
}

export function MeztliManagement({ data, openEditor, loading, errors, refresh, canExport }) {
  const state = useListState('gestion-meztli');
  // La vista no debe iniciar ocultando los equipos admitidos: cuando todos
  // tienen reserva DHCP, el filtro "No admitidos" hacía parecer que la tabla
  // no se actualizaba aunque FortiGate hubiera devuelto concesiones vigentes.
  const [admissionFilter, setAdmissionFilter] = useState('all');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState('');
  const directLeases = Array.isArray(data.meztliLeases) ? data.meztliLeases : [];
  const meztliSegment = data.segments.find(segment => normalizeText(`${segment.name || ''} ${segment.interface || ''} ${segment.vlan || ''}`).includes('meztli') || /\b94\b/.test(String(segment.vlan || '')));
  const looksLikeMeztli = device => normalizeText([device.interface, device.vlan, device.ssid, device.network, device.omnivista?.ssid, device.omnivista?.profile].filter(Boolean).join(' ')).includes('meztli') || /\b94\b/.test(String(device.vlan || ''));
  const belongsToMeztli = device => (meztliSegment && deviceInSegment(device, meztliSegment)) || looksLikeMeztli(device);
  const meztliDevices = data.devices.filter(belongsToMeztli);
  const directMeztliLeases = directLeases.filter(lease => normalizeText(lease.interface).includes('meztli'));
  // DHCP leases are the source of truth when available; device inventory is only
  // retained as a visual fallback for demo/offline integrations.
  const connected = directMeztliLeases.length ? directMeztliLeases.map(lease => ({ ...lease, name: lease.device_name || lease.hostname || lease.mac || 'Sin identificar', status: lease.is_online === false ? 'offline' : 'online', activity: lease.is_online === false ? 'Sin conexión' : 'En línea' })) : meztliDevices.filter(device => device.status === 'online' || device.is_online === true);
  const reserved = connected.filter(device => device.is_reserved === true);
  const unmanaged = connected.filter(device => device.is_reserved !== true);
  const getDeviceType = device => {
    const identity = normalizeText([device.name, device.hostname, device.type, device.detected_device, device.vendor, device.os].filter(Boolean).join(' '));
    if (/iphone|android|pixel|samsung|redmi|moto|huawei|ipad/.test(identity)) return 'Móvil';
    if (/espressif|\besp[ -]?\d|iot/.test(identity)) return 'IoT';
    if (/poco|laptop|notebook|macbook|windows|desktop|workstation/.test(identity)) return 'Equipo de usuario';
    return device.type || device.detected_device || formatDeviceType(device.type, device.os, device.name || device.hostname, device.vendor) || 'No identificado';
  };
  const allRows = connected.map((device, index) => ({
    ...device,
    id: device.id || `${device.interface || 'meztli'}:${device.mac || device.ip || index}`,
    admission: device.is_reserved === true ? 'admitted' : 'not-admitted',
    deviceType: getDeviceType(device),
  }));
  const rows = allRows.filter(device => (admissionFilter === 'all' || device.admission === admissionFilter) && (!deviceTypeFilter || device.deviceType === deviceTypeFilter));
  const elapsedSinceLease = timestamp => {
    const seconds = Math.max(0, Math.floor(Date.now() / 1000 - Number(timestamp)));
    if (!timestamp || !Number.isFinite(seconds)) return 'No disponible';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours} h ${minutes} min` : `${Math.max(1, minutes)} min`;
  };
  const columns = [
    { key: 'name', label: 'Dispositivo', value: row => row.device_name || row.omnivista?.device_name || row.name || row.hostname || 'Sin identificar', render: row => detailText(row.device_name || row.omnivista?.device_name || row.name || row.hostname || 'Sin identificar', row.deviceType || row.vendor || 'Detectado por FortiGate') },
    { key: 'ip', label: 'Dirección IP', value: row => row.ip || '—', render: row => <span className="ip-address">{row.ip || '—'}</span> },
    { key: 'mac', label: 'MAC', value: row => row.mac || '—', render: row => <span className="font-mono text-muted text-xs">{row.mac || '—'}</span> },
    { key: 'online', label: 'Estado', value: row => row.is_online === false ? 'offline' : 'online', render: row => <Badge status={row.is_online === false ? 'offline' : 'online'}>{row.is_online === false ? 'Sin conexión' : 'En línea'}</Badge> },
    { key: 'uptime', label: 'Tiempo en línea', value: row => row.lease_started_at || 0, render: row => row.is_online === false ? detailText('Sin conexión', 'Concesión DHCP vigente') : detailText(elapsedSinceLease(row.lease_started_at), 'desde la última renovación DHCP') },
    { key: 'admission', label: 'Admisión', value: row => row.admission, render: row => row.admission === 'admitted' ? <span className="meztli-reservation-mark meztli-table-mark"><ShieldCheck size={13} /> Admitido</span> : <span className="meztli-unapproved-mark"><TriangleAlert size={13} /> No admitido</span> },
  ];
  return <>
    <PageHeading eyebrow="Supervisión de red inalámbrica" title="Gestión Meztli" description="Dispositivos conectados a Meztli sin reserva DHCP" updatedAt={data.updatedAt} />
    {unmanaged.length > 0 && <Notice title="Aviso: conexiones no admitidas detectadas">Hay <strong>{number(unmanaged.length)} dispositivo{unmanaged.length === 1 ? '' : 's'}</strong> conectado{unmanaged.length === 1 ? '' : 's'} a <strong>SSID-Meztli</strong> sin reserva DHCP. Revísalos antes de realizar una acción en la red.</Notice>}
    <section className="metric-grid meztli-metrics"><Metric icon={Wifi} label="Conectados a Meztli" value={number(connected.length)} caption="actividad detectada en este momento" /><Metric icon={ShieldCheck} tone="success" label="Con reserva DHCP" value={number(reserved.length)} caption="autorizados para permanecer conectados" ><span className="meztli-reservation-mark"><ShieldCheck size={12} /> Reserva activa</span></Metric><Metric icon={TriangleAlert} tone="danger" label="No deberían estar conectados" value={number(unmanaged.length)} caption="sin reserva DHCP · requieren revisión" /></section>
    <DataTable title="Conexiones de SSID-Meztli" rows={rows} columns={columns} state={state} pageSize={25} noun={admissionFilter === 'not-admitted' ? 'dispositivos por revisar' : 'dispositivos'} toolbar={<div className="toolbar meztli-table-toolbar"><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar dispositivo, IP o MAC…" /><Select label="Admisión" value={admissionFilter} onChange={event => setAdmissionFilter(event.target.value)}><option value="not-admitted">No admitidos</option><option value="admitted">Admitidos (reserva DHCP)</option><option value="all">Todos</option></Select><Select label="Tipo de dispositivo" value={deviceTypeFilter} onChange={event => setDeviceTypeFilter(event.target.value)}><option value="">Todos los tipos</option>{options(allRows.map(row => row.deviceType))}</Select></div>} exportable={canExport} loading={loading} error={errors.meztliLeases || errors.devices} onRetry={refresh} onRowClick={row => openEditor('device-detail', row)} emptyText={connected.length ? admissionFilter === 'not-admitted' ? 'Todos los dispositivos conectados a Meztli tienen una reserva DHCP.' : 'No hay dispositivos que coincidan con los filtros seleccionados.' : 'FortiGate no devolvió concesiones DHCP activas para SSID-Meztli.'} />
    <Note title="Alcance de Gestión Meztli">La vista es de supervisión: no modifica reservas DHCP ni desconecta equipos. Abre un registro para revisar sus datos técnicos antes de realizar cualquier acción en la red.</Note>
  </>;
}
export function AuditLog({
  data,
  records,
  navigate,
  openEditor,
  loading,
  errors,
  refresh,
  idfView = false,
  filterIdf = null,
  canWrite,
  canExport,
  canResolve,
  onResolve,
  consolidated = false,
}) {
  const state = useListState(idfView ? 'reportes-idf' : 'bitacora');
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => {
    state.setFilter('idf', filterIdf || '');
  }, [filterIdf]);

  const enrichedRecords = useMemo(() => {
    return (records || []).map(r => {
      const hasEvidence = Boolean(r.evidence || r.evidenceDemo);
      const isTempAlert = r.temp != null && Number(r.temp) >= 25;
      return {
        ...r,
        hasEvidence: hasEvidence ? 'yes' : 'no',
        tempAlert: isTempAlert ? 'alert' : 'normal',
        evidenceLabel: hasEvidence ? 'Con foto' : 'Sin foto',
        statusLabel: r.status === 'resolved' ? 'Resuelto' : 'Abierto',
        formattedDate: dateTime(r.date),
        temperatureValue: r.temp != null ? `${r.temp} °C` : '—',
      };
    });
  }, [records]);

  const counts = useMemo(() => {
    const total = enrichedRecords.length;
    const open = enrichedRecords.filter(r => r.status === 'open').length;
    const resolved = enrichedRecords.filter(r => r.status === 'resolved').length;
    const evidence = enrichedRecords.filter(r => r.hasEvidence === 'yes').length;
    const tempAlert = enrichedRecords.filter(r => r.tempAlert === 'alert').length;
    const idfsCount = new Set(enrichedRecords.map(r => r.idfId || r.idf)).size;
    return { total, open, resolved, evidence, tempAlert, idfsCount };
  }, [enrichedRecords]);

  const handleResolve = async (record) => {
    if (!onResolve) return;
    setResolvingId(record.id || record.key);
    try {
      await onResolve(record);
    } finally {
      setResolvingId(null);
    }
  };

  const auditKpis = [
    {
      id: 'all',
      label: 'Total registros',
      value: counts.total,
      caption: `${counts.idfsCount} IDFs con visitas`,
      icon: FileText,
      tone: 'total',
      pct: 100,
      isActive: !state.filters.status && !state.filters.hasEvidence && !state.filters.tempAlert,
      onClick: () => {
        state.setFilter('status', '');
        state.setFilter('hasEvidence', '');
        state.setFilter('tempAlert', '');
      },
    },
    {
      id: 'open',
      label: 'Incidencias pendientes',
      value: counts.open,
      caption: 'Inconvenientes por resolver',
      icon: TriangleAlert,
      tone: 'occupied',
      pct: counts.total ? Math.round((counts.open / counts.total) * 100) : 0,
      isActive: state.filters.status === 'open',
      onClick: () => {
        state.setFilter('hasEvidence', '');
        state.setFilter('tempAlert', '');
        state.setFilter('status', state.filters.status === 'open' ? '' : 'open');
      },
    },
    {
      id: 'resolved',
      label: 'Sin pendientes / Conformes',
      value: counts.resolved,
      caption: 'Inspecciones atendidas',
      icon: CheckCircle2,
      tone: 'available',
      pct: counts.total ? Math.round((counts.resolved / counts.total) * 100) : 0,
      isActive: state.filters.status === 'resolved',
      onClick: () => {
        state.setFilter('hasEvidence', '');
        state.setFilter('tempAlert', '');
        state.setFilter('status', state.filters.status === 'resolved' ? '' : 'resolved');
      },
    },
    {
      id: 'evidence',
      label: 'Con evidencia fotográfica',
      value: counts.evidence,
      caption: 'Inspecciones con fotografía',
      icon: Camera,
      tone: 'evidence',
      pct: counts.total ? Math.round((counts.evidence / counts.total) * 100) : 0,
      isActive: state.filters.hasEvidence === 'yes',
      onClick: () => {
        state.setFilter('status', '');
        state.setFilter('tempAlert', '');
        state.setFilter('hasEvidence', state.filters.hasEvidence === 'yes' ? '' : 'yes');
      },
    },
    {
      id: 'temp',
      label: 'Alertas térmicas',
      value: counts.tempAlert,
      caption: 'Temperatura ≥ 25 °C',
      icon: Thermometer,
      tone: 'reserved',
      pct: counts.total ? Math.round((counts.tempAlert / counts.total) * 100) : 0,
      isActive: state.filters.tempAlert === 'alert',
      onClick: () => {
        state.setFilter('status', '');
        state.setFilter('hasEvidence', '');
        state.setFilter('tempAlert', state.filters.tempAlert === 'alert' ? '' : 'alert');
      },
    },
  ];

  // 6 perfectly proportioned columns: generous width for Actions so NO buttons are cut off
  const columns = [
    {
      key: 'idf',
      label: 'IDF / Folio',
      value: r => `${r.idf} ${r.id}`,
      render: r => (
        <div className="audit-cell-block">
          <div className="audit-idf-main">
            <span className="audit-idf-icon-wrap" aria-hidden="true">
              <Building2 size={15} />
            </span>
            <div className="audit-idf-info">
              <strong className="audit-idf-name">{r.idf || 'IDF'}</strong>
              {r.device && <span className="audit-component-label">{r.device}</span>}
            </div>
          </div>
          <div className="audit-folio-line">
            <span className="audit-folio-chip" title={r.id}>
              {r.id ? (r.id.length > 20 ? `${r.id.slice(0, 16)}…` : r.id) : '—'}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'title',
      label: 'Actividad e incidencia',
      value: r => `${r.title || ''} ${r.description || ''}`,
      render: r => (
        <div className="audit-activity-content">
          <strong className="audit-activity-title">{r.title || 'Inspección técnica'}</strong>
          <p className="audit-desc-text" title={r.description}>
            {r.description || 'Sin notas adicionales.'}
          </p>
        </div>
      ),
    },
    {
      key: 'actor',
      label: 'Responsable y fecha',
      value: r => `${r.actor} ${r.date}`,
      render: r => (
        <div className="audit-actor-group">
          <div className="audit-actor-line">
            <span className="audit-actor-avatar" aria-hidden="true">
              {(r.actor || 'T').charAt(0).toUpperCase()}
            </span>
            <span className="audit-actor-name">{r.actor || 'Sin responsable'}</span>
          </div>
          <span className="audit-date-subtext">{dateTime(r.date)}</span>
        </div>
      ),
    },
    {
      key: 'temp',
      label: 'Temperatura / Foto',
      value: r => (r.temp != null ? Number(r.temp) : -999),
      render: r => {
        const isHot = r.temp != null && Number(r.temp) >= 25;
        const hasPhoto = r.hasEvidence === 'yes';
        return (
          <div className="audit-conditions-group">
            {r.temp != null ? (
              <span className={`audit-temp-pill ${isHot ? 'is-hot' : 'is-normal'}`}>
                <Thermometer size={13} aria-hidden="true" />
                <b>{r.temp} °C</b>
              </span>
            ) : (
              <span className="text-muted text-xs">—</span>
            )}
            {hasPhoto && (
              <button
                type="button"
                className="audit-photo-badge"
                onClick={e => {
                  e.stopPropagation();
                  openEditor('report-detail', r, { readOnly: consolidated });
                }}
                title="Ver fotografía adjunta"
              >
                <Camera size={13} aria-hidden="true" />
                <span>Foto</span>
              </button>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Estado',
      value: r => r.status,
      render: r => (
        <div className="audit-status-cell">
          <Badge status={r.status}>
            {r.status === 'resolved' ? 'Resuelto' : 'Abierto'}
          </Badge>
          {r.severity && r.status !== 'resolved' && (
            <span className={`severity-tag severity-${r.severity}`}>
              {r.severity === 'high' ? 'Alta' : r.severity === 'medium' ? 'Media' : 'Baja'}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Acciones',
      sortable: false,
      render: r => (
        <div className="audit-actions-group" onClick={e => e.stopPropagation()}>
          <Button
            icon={Eye}
            onClick={() => openEditor('report-detail', r, { readOnly: consolidated })}
            title="Ver detalle completo"
          >
            Ver
          </Button>
          {r.status !== 'resolved' && (canResolve || canWrite) && onResolve && (
            <Button
              variant="primary"
              icon={Check}
              busy={resolvingId === (r.id || r.key)}
              onClick={() => handleResolve(r)}
              title="Resolver incidencia"
            >
              Resolver
            </Button>
          )}
        </div>
      ),
    },
  ];

  const exportColumns = [
    { key: 'id', label: 'Folio' },
    { key: 'idf', label: 'IDF' },
    { key: 'device', label: 'Equipo / Componente' },
    { key: 'title', label: 'Actividad' },
    { key: 'description', label: 'Descripción' },
    { key: 'actor', label: 'Responsable' },
    { key: 'temperatureValue', label: 'Temperatura' },
    { key: 'evidenceLabel', label: 'Evidencia fotográfica' },
    { key: 'statusLabel', label: 'Estado' },
    { key: 'severity', label: 'Severidad' },
    { key: 'formattedDate', label: 'Fecha de inspección' },
  ];

  const hasActiveFilters = Boolean(
    state.query ||
    state.filters.idf ||
    state.filters.status ||
    state.filters.hasEvidence ||
    state.filters.tempAlert
  );

  return (
    <>
      {!idfView && !consolidated && (
        <PageHeading
          eyebrow="Trazabilidad operativa · Cuartos de telecomunicaciones"
          title="Bitácora de Visitas e Incidencias en IDF"
          description="Historial de inspecciones, bitácora de visitas técnicas, telemetría y resolución de incidencias en IDFs"
          updatedAt={data.updatedAt}
        />
      )}



      {!idfView && !consolidated && (
        <section className="audit-kpi-grid" aria-label="Resumen de la bitácora IDF">
          {auditKpis.map(({ id, label, value, caption, icon: Icon, tone, pct, isActive, onClick }) => (
            <button
              key={id}
              type="button"
              className={`audit-kpi audit-kpi-${tone} ${isActive ? 'is-active' : ''}`}
              onClick={onClick}
            >
              <span className="audit-kpi-heading">
                <i><Icon size={19} /></i>
                {label}
              </span>
              <strong>{number(value)}</strong>
              <div className="audit-kpi-meter"><i style={{ width: `${pct}%` }} /></div>
              <small>{caption}<b>{pct}%</b></small>
            </button>
          ))}
        </section>
      )}

      <DataTable
        title={consolidated ? 'Bitácora consolidada de visitas a IDFs' : idfView ? 'Reportes enviados desde móvil' : 'Bitácora institucional de visitas a IDFs'}
        className={`audit-table ${consolidated ? 'audit-table-consolidated' : ''}`}
        rows={enrichedRecords}
        rowKey="key"
        columns={columns}
        state={state}
        noun="registros"
        exportable={false}
        loading={loading}
        error={errors.reports || errors.idfs}
        onRetry={refresh}
        toolbar={
          <div className="audit-toolbar">
            <SearchField
              value={state.query}
              onChange={state.setQuery}
              placeholder="Buscar folio, responsable, IDF, equipo o nota…"
            />
            <Select
              label="IDF / Cuarto"
              value={state.filters.idf || ''}
              onChange={e => state.setFilter('idf', e.target.value)}
            >
              <option value="">Todos los IDFs</option>
              {options(records.map(r => r.idf))}
            </Select>
            <Select
              label="Estado"
              value={state.filters.status || ''}
              onChange={e => state.setFilter('status', e.target.value)}
            >
              <option value="">Todos los estados</option>
              <option value="open">Con incidencias abiertas</option>
              <option value="resolved">Sin pendientes / Resueltos</option>
            </Select>
            <Select
              label="Evidencia fotográfica"
              value={state.filters.hasEvidence || ''}
              onChange={e => state.setFilter('hasEvidence', e.target.value)}
            >
              <option value="">Toda la bitácora</option>
              <option value="yes">Con foto adjunta</option>
              <option value="no">Sin fotografía</option>
            </Select>
            <Select
              label="Temperatura"
              value={state.filters.tempAlert || ''}
              onChange={e => state.setFilter('tempAlert', e.target.value)}
            >
              <option value="">Cualquier temperatura</option>
              <option value="alert">Alerta térmica (≥ 25 °C)</option>
              <option value="normal">Normal (&lt; 25 °C)</option>
            </Select>
            {hasActiveFilters && (
              <Button onClick={state.reset} variant="secondary">
                Limpiar filtros
              </Button>
            )}
          </div>
        }
      />


      <Note title="Trazabilidad y normativa técnica">
        Horarios referenciados a la Ciudad de México. Las visitas y reportes nuevos incorporan sello temporal e identidad validados por el servidor. Las entradas registradas son inmutables para garantizar auditoría institucional y cumplimiento técnico.
      </Note>
    </>
  );
}

export function SegmentDevicesPanel({ panelRef, segment, devices = [], onClose, openEditor }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [pageSizeChoice, setPageSizeChoice] = useState('25');
  const [currentPage, setCurrentPage] = useState(1);

  const segmentDevices = getOverviewSegmentDevices(devices, segment);
  const onlineCount = segmentDevices.filter(d => d.status === 'online').length;
  const omniMatchedCount = segmentDevices.filter(d => d.omnivista?.matched).length;
  const typeOptions = Array.from(new Set(segmentDevices.map(d => formatDeviceType(d.type, d.os || d.omnivista?.os || d.raw?.os_name, d.omnivista?.device_name || d.name, d.vendor)).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
  const vendorOptions = Array.from(new Set(segmentDevices.map(d => d.vendor).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));

  const filtered = segmentDevices.filter(d => {
    const computedType = formatDeviceType(d.type, d.os || d.omnivista?.os || d.raw?.os_name, d.omnivista?.device_name || d.name, d.vendor);
    if (statusFilter && d.status !== statusFilter) return false;
    if (typeFilter && computedType !== typeFilter) return false;
    if (vendorFilter && (d.vendor || '') !== vendorFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const devType = formatDeviceType(d.type, d.os || d.omnivista?.os || d.raw?.os_name, d.omnivista?.device_name || d.name, d.vendor).toLowerCase();
    const devLoc = (d.omnivista?.location || formatLocation(d.location, d.vendor, segment.name || segment.interface)).toLowerCase();
    const ovName = (d.omnivista?.device_name || '').toLowerCase();
    const ovAcc = (d.omnivista?.account || '').toLowerCase();
    const ovAp = (d.omnivista?.ap_name || '').toLowerCase();
    return (
      (d.name && d.name.toLowerCase().includes(q)) ||
      (d.ip && d.ip.toLowerCase().includes(q)) ||
      (d.mac && d.mac.toLowerCase().includes(q)) ||
      (d.vendor && d.vendor.toLowerCase().includes(q)) ||
      (d.os && d.os.toLowerCase().includes(q)) ||
      ovName.includes(q) ||
      ovAcc.includes(q) ||
      ovAp.includes(q) ||
      devType.includes(q) ||
      devLoc.includes(q)
    );
  });

  const pageSize = pageSizeChoice === 'all' ? Math.max(1, filtered.length) : Number(pageSizeChoice);
  const pageData = paginate(filtered, currentPage, pageSize);

  useEffect(() => {
    if (pageData.current !== currentPage) {
      setCurrentPage(pageData.current);
    }
  }, [pageData.current, currentPage]);

  const handleQuery = q => { setQuery(q); setCurrentPage(1); };
  const handleStatus = e => { setStatusFilter(e.target.value); setCurrentPage(1); };
  const handleSize = e => { setPageSizeChoice(e.target.value); setCurrentPage(1); };

  return <section className="segment-devices-panel" ref={panelRef} aria-labelledby="segment-devices-title">
    <div className="segment-devices-header">
      <div className="segment-devices-title-area">
        <h3 id="segment-devices-title"><Server size={22} className="text-brand" aria-hidden="true" />Dispositivos en {segment.name || segment.interface}</h3>
        <div className="segment-devices-meta">
          <span>Red: <strong>{segment.subnet || segment.ip_ranges?.[0] || 'Rango no informado'}</strong></span>
          {segment.default_gateway && <span>Gateway: <strong>{segment.default_gateway}</strong></span>}
          <Badge status={segment.status} />
          <span className="network-tag">{isMeztliSegment(segment) ? `${number(segmentDevices.length)} clientes DHCP` : `${number(segmentDevices.length)} dispositivos (${number(onlineCount)} en línea)`}</span>
          {omniMatchedCount > 0 && <span className="network-tag omni-badge">{number(omniMatchedCount)} cotejados en OmniVista</span>}
        </div>
      </div>
      <div className="segment-devices-actions">
        <Button icon={X} variant="secondary" onClick={onClose}>Cerrar</Button>
      </div>
    </div>
    <div className="segment-devices-toolbar">
      <div className="devices-toolbar-main">
        <SearchField value={query} onChange={handleQuery} placeholder="Buscar por equipo, IP, MAC o fabricante…" />
        <div className="devices-filters-group">
          <Select label="Tipo de dispositivo" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCurrentPage(1); }} className="devices-filter-select">
            <option value="">Todos los tipos</option>
            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select label="Marca / Fabricante" value={vendorFilter} onChange={e => { setVendorFilter(e.target.value); setCurrentPage(1); }} className="devices-filter-select">
            <option value="">Todas las marcas</option>
            {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Select label="Estado" value={statusFilter} onChange={handleStatus} className="devices-filter-select">
            <option value="">Todos los estados</option>
            <option value="online">En servicio</option>
            <option value="offline">Fuera de línea / Reservados</option>
          </Select>
          <Select label="Por página" value={pageSizeChoice} onChange={handleSize} className="devices-filter-select">
            <option value="25">25 dispositivos</option>
            <option value="50">50 dispositivos</option>
            <option value="100">100 dispositivos</option>
            <option value="all">Todos</option>
          </Select>
        </div>
      </div>
      <div className="segment-devices-hint"><Info size={16} aria-hidden="true" /><span>Selecciona cualquier fila para abrir el detalle técnico</span></div>
    </div>
    <div className="segment-devices-list">
      {filtered.length ? <>
        <table className="segment-devices-table" aria-label={`Dispositivos pertenecientes a ${segment.name || segment.interface}`}>
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Dirección IP</th>
              <th>MAC</th>
              <th>Tipo</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th>Última actividad</th>
            </tr>
          </thead>
          <tbody>
            {pageData.rows.map((d, index) => <tr key={`${d.mac || d.ip || d.id || index}`} className="segment-device-row" role="button" tabIndex={0} onClick={() => openEditor?.('device-detail', d)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor?.('device-detail', d); } }} title={`Haz clic para ver la información técnica de ${d.omnivista?.device_name || d.name || d.ip || 'este dispositivo'}`}>
              <td>
                <div className="cell-detail">
                  <div className="flex items-center gap-2">
                    <strong>{d.omnivista?.device_name || d.name}</strong>
                    {d.omnivista?.matched && <span className="network-tag omni-tag" title="Cotejado con Company Property de OmniVista 2500">OmniVista</span>}
                  </div>
                  <small>{[d.vendor, d.omnivista?.account && `Cuenta: ${d.omnivista.account}`, d.name !== d.omnivista?.device_name && d.name].filter(Boolean).join(' · ')}</small>
                </div>
              </td>
              <td><div className="cell-detail"><span className="ip-address">{d.ip_source === 'unconfirmed' ? 'Pendiente de confirmar' : (d.ip || '—')}</span>{d.is_reserved && <small>IP reservada{d.reserved_ip && d.reserved_ip !== d.ip ? `: ${d.reserved_ip}` : ''}</small>}</div></td>
              <td><span className="font-mono text-muted">{d.mac || '—'}</span></td>
              <td>{formatDeviceType(d.type, d.os || d.omnivista?.os || d.raw?.os_name, d.omnivista?.device_name || d.name, d.vendor)}</td>
              <td>
                {d.omnivista?.location ? (
                  <div className="cell-detail">
                    <strong className="text-location">{d.omnivista.location}</strong>
                    {d.omnivista.ap_name && <small className="text-muted">AP: {d.omnivista.ap_name}</small>}
                  </div>
                ) : (
                  formatLocation(d.location, d.vendor, segment.name || segment.interface)
                )}
              </td>
              <td><Badge status={d.status} /></td>
              <td>{d.activity || d.last_seen || 'Reciente'}</td>
            </tr>)}
          </tbody>
        </table>
        <div className="table-footer">
          <span role="status">
            {pageSizeChoice === 'all'
              ? `Mostrando todos los ${number(filtered.length)} dispositivos`
              : `Mostrando ${(pageData.current - 1) * pageSize + 1}–${Math.min(pageData.current * pageSize, pageData.total)} de ${number(pageData.total)} dispositivos`}
          </span>
          {pageData.pages > 1 && <nav className="pagination" aria-label={`Paginación de dispositivos de ${segment.name || segment.interface}`}>
            <IconButton icon={ChevronLeft} label="Página anterior" disabled={pageData.current <= 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))} />
            {Array.from({ length: Math.min(5, pageData.pages) }, (_, i) => {
              const start = Math.min(Math.max(1, pageData.current - 2), Math.max(1, pageData.pages - 4));
              return start + i;
            }).map(p => <button type="button" key={p} className={p === pageData.current ? 'current' : ''} aria-label={`Página ${p}`} aria-current={p === pageData.current ? 'page' : undefined} onClick={() => setCurrentPage(p)}>{p}</button>)}
            <IconButton icon={ChevronRight} label="Página siguiente" disabled={pageData.current >= pageData.pages} onClick={() => setCurrentPage(p => Math.min(pageData.pages, p + 1))} />
          </nav>}
        </div>
      </> : <Empty title={segmentDevices.length ? 'Sin coincidencias' : 'Sin dispositivos en este segmento'} action={segmentDevices.length ? <Button onClick={() => { setQuery(''); setStatusFilter(''); }}>Limpiar filtros</Button> : undefined}>{segmentDevices.length ? 'No hay dispositivos que coincidan con los criterios de búsqueda.' : `No se detectaron dispositivos asociados ni reservas DHCP registradas para la red ${segment.name || segment.interface}.`}</Empty>}
    </div>
  </section>;
}

export function SupportMovements({ demo }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [photoError, setPhotoError] = useState(false);
  const showDetail = row => { setPhotoError(false); setSelected(row); };
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const reload = () => {
    if (demo) return;
    request('/api/support/movements').then(result => { setRows(result.movements || []); setError(''); })
      .catch(problem => setError(problem.message || 'No se pudo cargar la bitácora.'));
  };
  useEffect(() => { reload(); }, [demo]);
  const visible = rows.filter(row => !query || normalizeText(`${row.element} ${row.identifier} ${row.actor_name || ''} ${row.actor} ${row.idf_name} ${row.notes}`).includes(normalizeText(query)));
  return <section className="support-log-view">
    <PageHeading eyebrow="Movimientos" title="Bitácora de soporte" description="Retiros de tóner y otros elementos provenientes del IDF 3" />
    <div className="support-log-origin" role="note">
      <span className="support-log-origin-icon">
        <Building2 size={24} aria-hidden="true" />
      </span>
      <div className="support-log-origin-text">
        <div className="support-log-origin-header">
          <strong>Punto de origen centralizado: IDF 3</strong>
          <span className="support-inventory-badge-live">Norma Operativa</span>
        </div>
        <p>Todo el inventario de soporte se gestiona y despacha exclusivamente desde el IDF 3.</p>
      </div>
    </div>

    <div className="support-log-toolbar">
      <div className="support-log-search">
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar movimientos de soporte"
          placeholder="Buscar por elemento, identificación, responsable o nota…"
        />
      </div>
      <Button icon={RefreshCw} onClick={reload} className="support-log-btn-refresh">
        Actualizar
      </Button>
    </div>

    <div className="support-log-meta-bar">
      <span className="support-log-count-pill" role="status">
        <b>{visible.length}</b> {visible.length === 1 ? 'movimiento registrado' : 'movimientos registrados'}
        {query ? ' (filtrados)' : ''}
      </span>
    </div>

    {error && <Notice tone="danger">{error}</Notice>}

    <div className="support-log-table-wrap">
      <table className="support-log-table desktop-only-table">
        <thead>
          <tr>
            <th>IDF / Folio</th>
            <th>Elemento e identificación</th>
            <th>Responsable y fecha</th>
            <th>Evidencia</th>
            <th>Observaciones</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(row => (
            <tr key={row.id}>
              <td>
                <div className="support-cell-idf">
                  <span className="support-idf-pill">{row.idf_name}</span>
                  <span className="support-folio-chip" title={row.id}>
                    {row.id.slice(0, 8).toUpperCase()}
                  </span>
                </div>
              </td>
              <td>
                <div className="support-cell-element">
                  <strong className="support-element-name">{row.element}</strong>
                  {row.quantity != null && (
                    <span className="support-qty-badge">
                      Retirado: <b>{row.quantity}</b> {row.unit || 'pza'}
                    </span>
                  )}
                  {row.identifier && (
                    <small className="support-identifier-tag">{row.identifier}</small>
                  )}
                </div>
              </td>
              <td>
                <div className="support-cell-actor">
                  <div className="audit-actor-line">
                    <span className="audit-actor-avatar" aria-hidden="true">
                      {(row.actor_name || row.actor || 'T').charAt(0).toUpperCase()}
                    </span>
                    <span className="audit-actor-name">{row.actor_name || row.actor}</span>
                  </div>
                  <span className="audit-date-subtext">
                    {dateTime(row.date)} · <small className="text-muted">{row.actor}</small>
                  </span>
                </div>
              </td>
              <td>
                {row.evidence ? (
                  <button
                    type="button"
                    className="support-evidence-link"
                    onClick={() => showDetail(row)}
                  >
                    <Camera size={14} aria-hidden="true" />
                    <span>Ver foto</span>
                  </button>
                ) : (
                  <span className="text-muted text-xs">Sin foto</span>
                )}
              </td>
              <td>
                <span className="support-notes-cell">{row.notes || '—'}</span>
              </td>
              <td><Button icon={Eye} onClick={() => showDetail(row)}>Ver</Button></td>
            </tr>
          ))}
          {!visible.length && (
            <tr>
              <td colSpan={6} className="support-log-empty">
                {rows.length ? 'No hay movimientos con esos filtros.' : 'Aún no hay retiros registrados.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Vista adaptativa en tarjetas para pantallas móviles */}
      <div className="support-log-mobile-list" aria-label="Lista de movimientos para pantallas pequeñas">
        {visible.map(row => (
          <article key={row.id} className="support-log-mobile-card">
            <div className="support-log-mobile-card-header">
              <div>
                <strong>{row.idf_name}</strong>
                <span className="support-log-folio-badge">{row.id.slice(0, 8).toUpperCase()}</span>
              </div>
              <Button icon={Eye} onClick={() => showDetail(row)}>Ver</Button>
            </div>
            <div className="support-log-mobile-card-body">
              <div className="support-log-mobile-item">
                <span className="support-log-mobile-label">Elemento</span>
                <strong>{row.element}</strong>
                {row.quantity != null && <small>Retirado: {row.quantity} {row.unit || ''}</small>}
                {row.identifier && <small>{row.identifier}</small>}
              </div>
              <div className="support-log-mobile-item">
                <span className="support-log-mobile-label">Responsable y Fecha</span>
                <span>{row.actor_name || row.actor}</span>
                <small>{dateTime(row.date)}</small>
              </div>
              {row.notes && (
                <div className="support-log-mobile-notes">
                  <span className="support-log-mobile-label">Observaciones</span>
                  <p>{row.notes}</p>
                </div>
              )}
            </div>
          </article>
        ))}
        {!visible.length && (
          <div className="support-log-empty-mobile">
            {rows.length ? 'No hay movimientos con esos filtros.' : 'Aún no hay retiros registrados.'}
          </div>
        )}
      </div>
    </div>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} title="Detalle del registro" wide>
      {selected && <div className="idf-report-sheet">
        <div className="idf-report-sheet-header">
          <div className="idf-report-sheet-titles">
            <span className="idf-report-badge-folio">Folio: {selected.id}</span>
            <h3 className="idf-report-sheet-activity">Retiro de {selected.element}</h3>
            <p className="idf-report-sheet-subtitle">Movimiento registrado en <strong>{selected.idf_name}</strong> · Origen: IDF 3</p>
          </div>
        </div>
        <div className="idf-report-sections">
          <div className="idf-report-card">
            <h4 className="idf-card-title">Datos operativos</h4>
            <div className="idf-card-grid">
              <div className="idf-info-item"><span className="idf-info-label">IDF / Destino</span><strong className="idf-info-val highlight">{selected.idf_name}</strong></div>
              <div className="idf-info-item"><span className="idf-info-label">Elemento e identificación</span><strong className="idf-info-val">{selected.element} · {selected.identifier || 'Sin identificación'}</strong></div>
              <div className="idf-info-item"><span className="idf-info-label">Cantidad retirada</span><strong className="idf-info-val">{selected.quantity == null ? 'Sin registro' : `${selected.quantity} ${selected.unit || 'pza'}`}</strong></div>
            </div>
          </div>
          <div className="idf-report-card">
            <h4 className="idf-card-title">Responsable y fecha</h4>
            <div className="idf-card-grid">
              <div className="idf-info-item"><span className="idf-info-label">Responsable</span><strong className="idf-info-val">{selected.actor_name || selected.actor}</strong></div>
              <div className="idf-info-item"><span className="idf-info-label">Cuenta de soporte</span><strong className="idf-info-val">{selected.actor || 'Sin registro'}</strong></div>
              <div className="idf-info-item"><span className="idf-info-label">Fecha del movimiento</span><strong className="idf-info-val">{dateTime(selected.date)}</strong></div>
            </div>
          </div>
          <div className="idf-report-card full-span">
            <h4 className="idf-card-title">Observaciones</h4>
            <p className="idf-description-text">{selected.notes || 'Sin observaciones.'}</p>
          </div>
          <div className="idf-report-card full-span">
            <div className="idf-card-header-flex">
              <h4 className="idf-card-title">Evidencia fotográfica</h4>
              {selected.evidence && !photoError && <a className="button button-secondary idf-btn-download" href={`/api/support/movements/evidence/${encodeURIComponent(selected.evidence)}`} download="evidencia-soporte"><Download size={15} /> Descargar foto original</a>}
            </div>
            {selected.evidence && !photoError ? <div className="idf-photo-showcase">
              <div className="idf-photo-frame"><img className="idf-photo-img" src={`/api/support/movements/evidence/${encodeURIComponent(selected.evidence)}?view=1`} alt={`Evidencia del retiro de ${selected.element}`} onError={() => setPhotoError(true)} /></div>
              <div className="idf-photo-meta"><Camera size={16} aria-hidden="true" /><span>Fotografía adjunta al movimiento en {selected.idf_name}</span></div>
            </div> : <div className="idf-no-photo" role={photoError ? 'status' : undefined}>
              <Camera size={30} strokeWidth={1.5} aria-hidden="true" />
              <span>{photoError ? 'No se pudo cargar la fotografía adjunta.' : 'Sin evidencia fotográfica adjunta para este movimiento'}</span>
            </div>}
          </div>
        </div>
      </div>}
    </Dialog>
  </section>;
}

export function SupportInventory({ canEdit = false }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [draftQuantity, setDraftQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    request('/api/support/inventory').then(result => {
      if (active) { setItems(result.items || []); setError(''); }
    }).catch(problem => { if (active) setError(problem.message || 'No se pudo cargar el inventario.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const saveQuantity = async event => {
    event.preventDefault();
    const quantity = Number(draftQuantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0 || !reason.trim()) { setError('Indica una cantidad válida y el motivo de la corrección.'); return; }
    setSaving(true); setError('');
    try {
      const result = await request('/api/support/inventory/quantity', { body: { item_id: editing.id, quantity, version: editing.version, reason: reason.trim() } });
      setItems(current => current.map(item => item.id === editing.id ? result.item : item));
      setEditing(null); setReason('');
    } catch (problem) { setError(problem.message || 'No se pudo modificar la cantidad.'); }
    finally { setSaving(false); }
  };
  const visible = items.filter(item => !query || normalizeText(`${item.description} ${item.unit} ${item.status} ${item.notes}`).includes(normalizeText(query)));
  return <section className="support-inventory-view">
    <PageHeading eyebrow="IDF 3" title="Inventario soporte IDF 3" description="Inventario inicial del área de soporte" />
    {error && <Notice tone="danger">{error}</Notice>}
    {loading ? <p>Cargando inventario…</p> : <>
      <div className="support-inventory-summary">
        <span className="support-inventory-summary-icon">
          <Package size={26} aria-hidden="true" />
        </span>
        <div className="support-inventory-summary-content">
          <div className="support-inventory-summary-title">
            <strong><b>{items.length}</b> artículos inventariados</strong>
            <span className="support-inventory-badge-live">Registro activo</span>
          </div>
          <span className="support-inventory-summary-meta">
            Inventario operativo del IDF 3 · Actualizado al 05/10/2026
          </span>
        </div>
      </div>
      <div className="support-inventory-search-wrap">
        <label className="support-inventory-search-label">
          Buscar artículo
          <div className="support-inventory-search-input-box">
            <Search size={18} className="support-inventory-search-icon" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Busca por descripción, unidad, estado u observaciones…"
              className="support-inventory-search-input"
            />
          </div>
        </label>
      </div>
      <div className="support-log-table-wrap">
        <table className="support-log-table support-inventory-table">
          <thead>
            <tr>
              <th>N.º</th>
              <th>Artículo</th>
              <th>Cantidad</th>
              <th>Unidad</th>
              <th>Estado</th>
              <th>Observaciones</th>
              {canEdit && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map(item => (
              <tr key={item.id}>
                <td>
                  <span className="support-inventory-number">{item.source_number}</span>
                </td>
                <td>
                  <strong className="support-inventory-name">{item.description}</strong>
                  {item.location && <small className="support-inventory-loc">{item.location}</small>}
                </td>
                <td>
                  <strong className="support-inventory-quantity">{item.quantity}</strong>
                </td>
                <td>
                  <span className="support-inventory-unit">{item.unit}</span>
                </td>
                <td>
                  <span className="support-inventory-status">{item.status || 'Sin verificar'}</span>
                </td>
                <td>
                  <span className="support-inventory-notes">{item.notes || '—'}</span>
                </td>
                {canEdit && (
                  <td>
                    <Button
                      variant="secondary"
                      className="support-inventory-btn-edit"
                      onClick={() => {
                        setEditing(item);
                        setDraftQuantity(String(item.quantity));
                        setReason('');
                        setError('');
                      }}
                    >
                      Modificar cantidad
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="support-log-empty">
                  {items.length ? 'No hay artículos que coincidan con la búsqueda.' : 'No hay artículos cargados.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Tarjetas táctiles adaptadas a pantallas móviles (smartphones) */}
        <div className="support-inventory-mobile-list" aria-label="Lista de inventario para pantallas pequeñas">
          {visible.map(item => (
            <article key={item.id} className="support-inventory-mobile-card">
              <div className="support-inventory-mobile-card-header">
                <span className="support-inventory-number">#{item.source_number}</span>
                <span className="support-inventory-status">{item.status || 'Sin verificar'}</span>
              </div>
              <div className="support-inventory-mobile-card-body">
                <strong className="support-inventory-name">{item.description}</strong>
                {item.location && <small className="support-inventory-loc">{item.location}</small>}
                <div className="support-inventory-mobile-qty-row">
                  <div className="support-inventory-mobile-qty-pill">
                    <span className="support-inventory-mobile-qty-label">Cantidad:</span>
                    <strong className="support-inventory-quantity">{item.quantity}</strong>
                    <span className="support-inventory-unit">{item.unit}</span>
                  </div>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      className="support-inventory-btn-edit"
                      onClick={() => {
                        setEditing(item);
                        setDraftQuantity(String(item.quantity));
                        setReason('');
                        setError('');
                      }}
                    >
                      Modificar
                    </Button>
                  )}
                </div>
                {item.notes && (
                  <div className="support-inventory-mobile-notes">
                    <span className="support-inventory-mobile-notes-label">Observaciones:</span>
                    <p>{item.notes}</p>
                  </div>
                )}
              </div>
            </article>
          ))}
          {!visible.length && (
            <div className="support-log-empty-mobile">
              {items.length ? 'No hay artículos que coincidan con la búsqueda.' : 'No hay artículos cargados.'}
            </div>
          )}
        </div>
      </div>
      <p className="support-inventory-footnote">Las cantidades conservan sus unidades originales: piezas, cajas, kits, pares, paquetes o bolsas. Ningún estado se ha verificado físicamente.</p>
    </>}
    {editing && <div className="support-inventory-edit-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditing(null); }}><form className="support-inventory-edit panel" onSubmit={saveQuantity} aria-label={`Modificar cantidad de ${editing.description}`}>
      <h2>Modificar cantidad</h2><p><strong>{editing.description}</strong><br />Existencia actual: {editing.quantity} {editing.unit}</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <label>Nueva cantidad<input type="number" min="0" step="1" required value={draftQuantity} onChange={event => setDraftQuantity(event.target.value)} /></label>
      <label>Motivo de la corrección<textarea required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explica por qué se modifica la existencia" /></label>
      <div className="support-inventory-edit-actions"><Button type="button" variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button><Button type="submit" variant="primary" busy={saving}>Guardar cantidad</Button></div>
    </form></div>}
  </section>;
}

export function SupportDashboard({ data, navigate, openEditor, loading, errors, refresh, demo }) {
  const [networkQuery, setNetworkQuery] = useState('');
  const [computerQuery, setComputerQuery] = useState('');
  const [printerQuery, setPrinterQuery] = useState('');
  const [computerSort, setComputerSort] = useState('uptime');

  const [exportOpen, setExportOpen] = useState(false);
  const [exportComputers, setExportComputers] = useState(true);
  const [exportPrinters, setExportPrinters] = useState(true);

  const { segments = [], devices = [] } = data;

  const supportSegments = useMemo(() => getSupportSegments(segments), [segments]);

  // Balance y resumen de saturación para Columna 1
  const saturationSummary = supportSegments.reduce((acc, s) => {
    const status = getSaturationStatus(s);
    if (status === 'critical') acc.critical++;
    else if (status === 'warning') acc.warning++;
    else acc.normal++;

    const cap = Number(s.capacity) || 0;
    const occ = Number(s.active_leases) || 0;
    const free = s.available_ips != null
      ? Number(s.available_ips)
      : Math.max(0, cap - occ);

    acc.totalIps += cap;
    acc.occupiedIps += occ;
    acc.availableIps += free;
    return acc;
  }, { critical: 0, warning: 0, normal: 0, totalIps: 0, occupiedIps: 0, availableIps: 0 });

  // 1. Redes y estados
  const filteredSegments = supportSegments.filter(s => {
    if (!networkQuery.trim()) return true;
    const q = normalizeText(networkQuery);
    return (
      (s.name && normalizeText(s.name).includes(q)) ||
      (s.interface && normalizeText(s.interface).includes(q)) ||
      (s.subnet && normalizeText(s.subnet).includes(q)) ||
      (s.default_gateway && normalizeText(s.default_gateway).includes(q)) ||
      (s.vlan && normalizeText(s.vlan).includes(q)) ||
      (s.description && normalizeText(s.description).includes(q))
    );
  });

  // 2. Computadoras conectadas (online y tipo Computadora)
  const isComputer = d => {
    if (d.status !== 'online') return false;
    const os = d.os || d.omnivista?.os || d.raw?.os_name || '';
    const name = d.omnivista?.device_name || d.name || '';
    const type = formatDeviceType(d.type, os, name, d.vendor);
    return type === 'Computadora';
  };
  const computers = devices.filter(isComputer);
  const filteredComputers = computers.filter(c => {
    if (!computerQuery.trim()) return true;
    const q = normalizeText(computerQuery);
    const ovName = normalizeText(c.omnivista?.device_name || '');
    const ovLoc = normalizeText(c.omnivista?.location || '');
    return (
      (c.name && normalizeText(c.name).includes(q)) ||
      (c.ip && normalizeText(c.ip).includes(q)) ||
      (c.mac && normalizeText(c.mac).includes(q)) ||
      (c.vendor && normalizeText(c.vendor).includes(q)) ||
      (c.os && normalizeText(c.os).includes(q)) ||
      ovName.includes(q) ||
      ovLoc.includes(q)
    );
  });

  const sortedComputers = [...filteredComputers].sort((a, b) => {
    if (computerSort === 'uptime') {
      const aUptime = Number(a.uptime_seconds) || 0;
      const bUptime = Number(b.uptime_seconds) || 0;
      return bUptime - aUptime;
    }
    return 0;
  });

  // 3. Impresoras conectadas (online y tipo Impresora)
  const isPrinter = d => {
    if (d.status !== 'online') return false;
    const os = d.os || d.omnivista?.os || d.raw?.os_name || '';
    const name = d.omnivista?.device_name || d.name || '';
    const type = formatDeviceType(d.type, os, name, d.vendor);
    return type === 'Impresora';
  };
  const printers = devices.filter(isPrinter);
  const filteredPrinters = printers.filter(p => {
    if (!printerQuery.trim()) return true;
    const q = normalizeText(printerQuery);
    const ovName = normalizeText(p.omnivista?.device_name || '');
    const ovLoc = normalizeText(p.omnivista?.location || '');
    return (
      (p.name && normalizeText(p.name).includes(q)) ||
      (p.ip && normalizeText(p.ip).includes(q)) ||
      (p.mac && normalizeText(p.mac).includes(q)) ||
      (p.vendor && normalizeText(p.vendor).includes(q)) ||
      (p.model && normalizeText(p.model).includes(q)) ||
      ovName.includes(q) ||
      ovLoc.includes(q)
    );
  });

  const handleExportExcel = () => {
    if (!exportComputers && !exportPrinters) return;

    const sheets = buildSupportSheets({
      computers,
      printers,
      includeComputers: exportComputers,
      includePrinters: exportPrinters,
      columns: SUPPORT_EXPORT_COLUMNS,
    });

    if (!sheets.length) return;

    let filename = 'listado-soporte-dispositivos';
    if (exportComputers && !exportPrinters) filename = 'listado-soporte-computadoras';
    else if (!exportComputers && exportPrinters) filename = 'listado-soporte-impresoras';

    downloadExcel(filename, sheets);
    setExportOpen(false);
  };
  const handleExportCsv = handleExportExcel;

  return (
    <>
      <PageHeading
        eyebrow="Atención y diagnóstico técnico"
        title="Dashboard de Soporte"
        description="Monitoreo operativo de segmentos de red, computadoras e impresoras en servicio"
        updatedAt={data.updatedAt}
      />

      <div className="support-kpi-bar" role="region" aria-label="Resumen de telemetría de soporte">
        <div className="support-kpi-group">
          <div className="support-kpi-card kpi-network">
            <div className="support-kpi-icon"><Network size={18} aria-hidden="true" /></div>
            <div className="support-kpi-info">
              <span className="support-kpi-count">{number(supportSegments.length)}</span>
              <span className="support-kpi-label">Redes de soporte</span>
            </div>
          </div>

          <div className="support-kpi-divider" aria-hidden="true" />

          <div className="support-kpi-card kpi-computers">
            <div className="support-kpi-icon"><Monitor size={18} aria-hidden="true" /></div>
            <div className="support-kpi-info">
              <span className="support-kpi-count">{number(computers.length)}</span>
              <span className="support-kpi-label">Computadoras en línea</span>
            </div>
            <span className="support-kpi-pulse pulse-success" title="En servicio" />
          </div>

          <div className="support-kpi-divider" aria-hidden="true" />

          <div className="support-kpi-card kpi-printers">
            <div className="support-kpi-icon"><Printer size={18} aria-hidden="true" /></div>
            <div className="support-kpi-info">
              <span className="support-kpi-count">{number(printers.length)}</span>
              <span className="support-kpi-label">Impresoras en línea</span>
            </div>
            <span className="support-kpi-pulse pulse-info" title="En servicio" />
          </div>
        </div>

        <div className="support-kpi-actions">
          <Button
            icon={Download}
            variant="primary"
            className="support-export-action"
            onClick={() => setExportOpen(true)}
          >
            Exportar listado Excel
          </Button>
        </div>
      </div>

      <section className="support-dashboard-grid" aria-label="Tablero de 3 columnas para soporte">
        {/* Columna 1: Listado de redes y estados */}
        <div className="support-column">
          <div className="support-column-header">
            <div className="support-column-title">
              <Network size={20} className="text-brand" aria-hidden="true" />
              <h3>Listado de redes y estados</h3>
            </div>
            <span className="support-column-badge">{number(filteredSegments.length)}</span>
          </div>

          {/* Panel resumen de saturación */}
          <div className="support-saturation-panel" aria-label="Resumen de saturación de redes">
            <div className="support-saturation-counts">
              <span className="badge badge-danger" title="Redes saturadas / críticas con utilización >= 80%">
                <span className="badge-dot" aria-hidden="true" />
                <strong>{saturationSummary.critical}</strong> {saturationSummary.critical === 1 ? 'Saturada' : 'Saturadas'}
              </span>
              <span className="badge badge-warning" title="Redes en uso medio con utilización entre 50% y 79%">
                <span className="badge-dot" aria-hidden="true" />
                <strong>{saturationSummary.warning}</strong> Uso medio
              </span>
              <span className="badge badge-success" title="Redes disponibles con utilización < 50%">
                <span className="badge-dot" aria-hidden="true" />
                <strong>{saturationSummary.normal}</strong> {saturationSummary.normal === 1 ? 'Disponible' : 'Disponibles'}
              </span>
            </div>
            <div className="support-saturation-balance">
              <div className="support-balance-col">
                <span className="support-balance-lbl">Total IPs</span>
                <strong className="support-balance-num">{number(saturationSummary.totalIps)}</strong>
              </div>
              <div className="support-balance-col">
                <span className="support-balance-lbl">IPs Ocupadas</span>
                <strong className="support-balance-num text-danger">{number(saturationSummary.occupiedIps)}</strong>
              </div>
              <div className="support-balance-col">
                <span className="support-balance-lbl">IPs Libres</span>
                <strong className="support-balance-num text-success">{number(saturationSummary.availableIps)}</strong>
              </div>
            </div>
          </div>

          <div className="support-column-search">
            <SearchField
              value={networkQuery}
              onChange={setNetworkQuery}
              placeholder="Buscar red, VLAN o gateway…"
            />
          </div>
          <div className="support-column-body" tabIndex={0} aria-label="Lista de redes y segmentos">
            {filteredSegments.length ? (
              filteredSegments.map(segment => {
                const satStatus = getSaturationStatus(segment);
                const satLabel = getSaturationLabel(satStatus);
                const meterTone = getUtilizationTone(segment.utilization_percent);
                const meterColor = getUtilizationColor(segment.utilization_percent);
                const freeIps = segment.available_ips ?? Math.max(0, (Number(segment.capacity) || 0) - (Number(segment.active_leases) || 0));

                return (
                  <article key={segmentKey(segment)} className="support-item-card support-network-card">
                    <div className="support-card-top">
                      <div className="support-card-name">
                        <span className="segment-dot" />
                        <strong>{segment.name || segment.interface}</strong>
                      </div>
                      <Badge status={satStatus}>{satLabel}</Badge>
                    </div>
                    <div className="support-network-subnet">
                      <small>VLAN: {segment.vlan || segment.interface || '—'}</small>
                      <span className="font-mono">{segment.subnet || segment.ip_ranges?.[0] || 'Rango no informado'}</span>
                    </div>
                    <div className="support-network-breakdown">
                      <div className="support-breakdown-item">
                        <span className="support-breakdown-label">IPs Ocupadas</span>
                        <strong className="support-breakdown-val text-danger">{number(segment.active_leases || 0)}</strong>
                      </div>
                      <div className="support-breakdown-item">
                        <span className="support-breakdown-label">IPs Libres</span>
                        <strong className="support-breakdown-val text-success">{number(freeIps)}</strong>
                      </div>
                      <div className="support-breakdown-item">
                        <span className="support-breakdown-label">Capacidad</span>
                        <strong className="support-breakdown-val">{number(segment.capacity || 0)}</strong>
                      </div>
                    </div>
                    <div className="support-network-meta">
                      <span><Router size={14} aria-hidden="true" /> {segment.default_gateway || 'Sin gateway'}</span>
                      <span className="support-network-meta-tag">{satLabel} ({number(segment.utilization_percent)}%)</span>
                    </div>
                    <div className={`capacity-meter capacity-meter-${meterTone}`} style={{ '--meter-fill': meterColor }}>
                      <meter min="0" max="100" value={segment.utilization_percent || 0} aria-label={`Utilización de ${segment.name || segment.interface}`} />
                      <div className="support-meter-footer">
                        <small><span className={`meter-bullet meter-bullet-${meterTone}`} style={{ background: meterColor }} aria-hidden="true" />{number(segment.utilization_percent)}% utilizado</small>
                        <small className={`support-sat-indicator sat-${satStatus}`}>{satLabel}</small>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="support-empty-state">
                <p>No se encontraron redes coincidentes.</p>
              </div>
            )}
          </div>
        </div>

        {/* Columna 2: Computadoras conectadas */}
        <div className="support-column">
          <div className="support-column-header">
            <div className="support-column-title">
              <Monitor size={20} className="text-success" aria-hidden="true" />
              <h3>Computadoras conectadas</h3>
            </div>
            <span className="support-column-badge badge-success">{number(filteredComputers.length)}</span>
          </div>
          <div className="support-column-search">
            <SearchField
              value={computerQuery}
              onChange={setComputerQuery}
              placeholder="Buscar computadora, IP, usuario…"
            />
            <div className="support-column-sort">
              <ArrowUpDown size={14} className="text-muted" aria-hidden="true" />
              <label htmlFor="computer-sort-select" className="support-sort-label">Ordenar:</label>
              <select
                id="computer-sort-select"
                className="support-sort-select"
                value={computerSort}
                onChange={e => setComputerSort(e.target.value)}
                aria-label="Criterio de ordenamiento de computadoras"
              >
                <option value="standard">En línea (estándar)</option>
                <option value="uptime">Mayor tiempo conectadas (Top Uptime)</option>
              </select>
            </div>
          </div>
          <div className="support-column-body" tabIndex={0} aria-label="Lista de computadoras conectadas">
            {sortedComputers.length ? (
              sortedComputers.map((pc, idx) => {
                const displayName = pc.omnivista?.device_name || pc.name || 'Computadora';
                const loc = pc.omnivista?.location || formatLocation(pc.location, pc.vendor);
                return (
                  <article
                    key={`${pc.mac || pc.ip || idx}`}
                    className="support-item-card support-device-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditor?.('device-detail', pc)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openEditor?.('device-detail', pc);
                      }
                    }}
                    title={`Ver detalle técnico de ${displayName}`}
                  >
                    <div className="support-card-top">
                      <div className="support-card-name">
                        <Monitor size={17} className="text-muted" aria-hidden="true" />
                        <strong>{displayName}</strong>
                        {pc.omnivista?.matched && (
                          <span className="network-tag omni-tag" title="Cotejado con OmniVista 2500">OmniVista</span>
                        )}
                      </div>
                      <Badge status={pc.status} />
                    </div>
                    <div className="support-device-addresses">
                      <div className="support-device-ip-group">
                        <span className="ip-address font-mono">{pc.ip || '—'}</span>
                        {pc.mac && <span className="font-mono text-muted text-xs">{pc.mac}</span>}
                      </div>
                      {pc.uptime_seconds != null && (
                        <span className="support-uptime-badge" title={`Tiempo observado conectado por SGRS: ${formatUptime(pc.uptime_seconds)}`}>
                          <Clock size={12} aria-hidden="true" />
                          <span>Observado: {formatUptime(pc.uptime_seconds)}</span>
                        </span>
                      )}
                    </div>
                    <div className="support-device-info">
                      <span className="support-vendor">{pc.vendor || pc.os || 'Computadora'}</span>
                      {loc && loc !== '—' && <span className="support-location text-location">{loc}</span>}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="support-empty-state">
                <p>No se encontraron computadoras en línea coincidentes.</p>
              </div>
            )}
          </div>
        </div>

        {/* Columna 3: Impresoras conectadas */}
        <div className="support-column">
          <div className="support-column-header">
            <div className="support-column-title">
              <Printer size={20} className="text-info" aria-hidden="true" />
              <h3>Impresoras conectadas</h3>
            </div>
            <span className="support-column-badge badge-info">{number(filteredPrinters.length)}</span>
          </div>
          <div className="support-column-search">
            <SearchField
              value={printerQuery}
              onChange={setPrinterQuery}
              placeholder="Buscar impresora, IP, modelo…"
            />
          </div>
          <div className="support-column-body" tabIndex={0} aria-label="Lista de impresoras conectadas">
            {filteredPrinters.length ? (
              filteredPrinters.map((printer, idx) => {
                const displayName = printer.omnivista?.device_name || printer.name || 'Impresora';
                const loc = printer.omnivista?.location || formatLocation(printer.location, printer.vendor);
                return (
                  <article
                    key={`${printer.mac || printer.ip || idx}`}
                    className="support-item-card support-device-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditor?.('device-detail', printer)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openEditor?.('device-detail', printer);
                      }
                    }}
                    title={`Ver detalle técnico de ${displayName}`}
                  >
                    <div className="support-card-top">
                      <div className="support-card-name">
                        <Printer size={17} className="text-muted" aria-hidden="true" />
                        <strong>{displayName}</strong>
                        {printer.omnivista?.matched && (
                          <span className="network-tag omni-tag" title="Cotejado con OmniVista 2500">OmniVista</span>
                        )}
                      </div>
                      <Badge status={printer.status} />
                    </div>
                    <div className="support-device-addresses">
                      <span className="ip-address font-mono">{printer.ip || '—'}</span>
                      {printer.mac && <span className="font-mono text-muted text-xs">{printer.mac}</span>}
                    </div>
                    <div className="support-device-info">
                      <span className="support-vendor">{printer.vendor || printer.model || 'Impresora'}</span>
                      {loc && loc !== '—' && <span className="support-location text-location">{loc}</span>}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="support-empty-state">
                <p>No se encontraron impresoras en línea coincidentes.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Dialog interactivo para exportación Excel con hojas separadas */}
      <Dialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportar listado de dispositivos (Excel)"
        footer={
          <div className="dialog-actions">
            <Button onClick={() => setExportOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              icon={Download}
              disabled={!exportComputers && !exportPrinters}
              onClick={handleExportExcel}
            >
              Descargar archivo Excel
            </Button>
          </div>
        }
      >
        <p className="dialog-description">
          Descarga el reporte de inventario en formato Excel (.xls). Al seleccionar ambas opciones (&ldquo;Ambos&rdquo;), computadoras e impresoras se descargarán en un único archivo Excel separadas en hojas independientes (&ldquo;Computadoras&rdquo; e &ldquo;Impresoras&rdquo;).
        </p>

        <div className="support-export-modal-body">
          <div className="support-quick-selection">
            <span className="support-quick-label">Selección rápida:</span>
            <div className="support-quick-btn-group">
              <button
                type="button"
                className={`support-quick-btn ${exportComputers && exportPrinters ? 'is-active' : ''}`}
                onClick={() => { setExportComputers(true); setExportPrinters(true); }}
              >
                Ambos
              </button>
              <button
                type="button"
                className={`support-quick-btn ${exportComputers && !exportPrinters ? 'is-active' : ''}`}
                onClick={() => { setExportComputers(true); setExportPrinters(false); }}
              >
                Solo computadoras
              </button>
              <button
                type="button"
                className={`support-quick-btn ${!exportComputers && exportPrinters ? 'is-active' : ''}`}
                onClick={() => { setExportComputers(false); setExportPrinters(true); }}
              >
                Solo impresoras
              </button>
            </div>
          </div>

          <div className="support-checkbox-list">
            <label className={`support-checkbox-card ${exportComputers ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={exportComputers}
                onChange={e => setExportComputers(e.target.checked)}
              />
              <div className="support-checkbox-details">
                <div className="support-checkbox-main">
                  <Monitor size={18} className="text-success" aria-hidden="true" />
                  <strong>Computadoras</strong>
                </div>
                <span className="support-checkbox-count">{number(computers.length)} equipos</span>
              </div>
            </label>

            <label className={`support-checkbox-card ${exportPrinters ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={exportPrinters}
                onChange={e => setExportPrinters(e.target.checked)}
              />
              <div className="support-checkbox-details">
                <div className="support-checkbox-main">
                  <Printer size={18} className="text-info" aria-hidden="true" />
                  <strong>Impresoras</strong>
                </div>
                <span className="support-checkbox-count">{number(printers.length)} equipos</span>
              </div>
            </label>
          </div>

          {!exportComputers && !exportPrinters && (
            <Notice tone="warning" title="Sin categorías seleccionadas">
              Selecciona al menos una categoría para poder descargar el listado Excel.
            </Notice>
          )}

          <div className="support-export-note">
            <small className="text-muted">
              El archivo contiene las 8 columnas requeridas: Tipo de Dispositivo, Dirección IP, Dirección MAC, Nombre de Equipo / Hostname, Interfaz, Tiempo Conectado, Ubicación y Piso.
            </small>
          </div>
        </div>
      </Dialog>
    </>
  );
}


export function resolveActionMetadata(action = '') {
  if (action === 'session.login') {
    return {
      category: 'session',
      categoryLabel: 'Sesión',
      categoryTone: 'info',
      title: 'Inicio de sesión',
      icon: LogIn,
      description: 'Acceso autenticado al centro operativo S.G.R.S.',
    };
  }
  if (action === 'session.logout') {
    return {
      category: 'session',
      categoryLabel: 'Sesión',
      categoryTone: 'secondary',
      title: 'Cierre de sesión',
      icon: LogOut,
      description: 'Finalización de sesión de usuario.',
    };
  }
  if (action === 'user.created') {
    return {
      category: 'users',
      categoryLabel: 'Usuarios',
      categoryTone: 'brand',
      title: 'Alta de usuario',
      icon: UserPlus,
      description: 'Registro de nueva cuenta de usuario institucional.',
    };
  }
  if (action === 'user.updated') {
    return {
      category: 'users',
      categoryLabel: 'Usuarios',
      categoryTone: 'brand',
      title: 'Modificación de usuario',
      icon: Users,
      description: 'Actualización de datos, rol o permisos de usuario.',
    };
  }
  if (action === 'user.password.reset') {
    return {
      category: 'users',
      categoryLabel: 'Usuarios',
      categoryTone: 'warning',
      title: 'Restablecimiento de clave',
      icon: KeyRound,
      description: 'Reinicio de contraseña para acceso al sistema.',
    };
  }
  if (action === 'inventory.physical.update') {
    return {
      category: 'inventory',
      categoryLabel: 'Inventario',
      categoryTone: 'success',
      title: 'Cambio en inventario físico',
      icon: Server,
      description: 'Modificación física o documental de equipo / rack.',
    };
  }
  if (action === 'ap.map.position.saved') {
    return {
      category: 'maps',
      categoryLabel: 'Plano y APs',
      categoryTone: 'info',
      title: 'AP posicionado en plano',
      icon: MapPin,
      description: 'Punto de acceso ubicado en el mapa arquitectónico.',
    };
  }
  if (action === 'ap.map.position.removed') {
    return {
      category: 'maps',
      categoryLabel: 'Plano y APs',
      categoryTone: 'secondary',
      title: 'AP retirado de plano',
      icon: MapPinOff,
      description: 'Ubicación del punto de acceso retirada del plano.',
    };
  }
  if (action === 'connection.test') {
    return {
      category: 'connections',
      categoryLabel: 'Conexiones API',
      categoryTone: 'info',
      title: 'Prueba de enlace API',
      icon: Activity,
      description: 'Verificación de conectividad e integración con servicio externo.',
    };
  }
  if (action === 'connection.updated') {
    return {
      category: 'connections',
      categoryLabel: 'Conexiones API',
      categoryTone: 'warning',
      title: 'Actualización de API',
      icon: PlugZap,
      description: 'Actualización de configuración o credenciales de API.',
    };
  }
  if (action === 'idf.report.created') {
    return {
      category: 'idf',
      categoryLabel: 'Registro IDF',
      categoryTone: 'warning',
      title: 'Visita / Incidencia en IDF',
      icon: Building2,
      description: 'Inspección técnica o alerta reportada en cuarto IDF.',
    };
  }
  if (action === 'idf.report.resolved') {
    return {
      category: 'idf',
      categoryLabel: 'Registro IDF',
      categoryTone: 'success',
      title: 'Incidencia resuelta en IDF',
      icon: CheckCircle2,
      description: 'Atención y resolución técnica de inconveniente en cuarto IDF.',
    };
  }
  return {
    category: 'general',
    categoryLabel: 'Sistema',
    categoryTone: 'secondary',
    title: action.replace(/\./g, ' '),
    icon: Activity,
    description: 'Movimiento registrado en la base de datos del sistema.',
  };
}

export function ProjectAuditLog({
  data,
  navigate,
  openEditor,
  loading,
  errors,
  refresh,
  canExport,
}) {
  const state = useListState('bitacora-general');
  const rawAudit = data.audit || [];

  const enrichedEvents = useMemo(() => {
    return rawAudit.map((e, idx) => {
      const meta = resolveActionMetadata(e.action);
      const ts = typeof e.created_at === 'number' && e.created_at < 1e12
        ? e.created_at * 1000
        : Number(e.created_at) || Date.now();
      return {
        ...e,
        key: `audit-${e.id || idx}`,
        meta,
        formattedDate: dateTime(ts),
        category: meta.category,
        categoryLabel: meta.categoryLabel,
        categoryTone: meta.categoryTone,
        title: meta.title,
        description: meta.description,
        targetDisplay: e.target_label || e.target || '—',
        actorDisplay: e.actor_name || e.actor || 'Sistema',
      };
    });
  }, [rawAudit]);

  const counts = useMemo(() => {
    const total = enrichedEvents.length;
    const session = enrichedEvents.filter(e => e.category === 'session').length;
    const users = enrichedEvents.filter(e => e.category === 'users').length;
    const inventory = enrichedEvents.filter(e => e.category === 'inventory' || e.category === 'maps').length;
    const connections = enrichedEvents.filter(e => e.category === 'connections').length;
    const idf = enrichedEvents.filter(e => e.category === 'idf').length;
    return { total, session, users, inventory, connections, idf };
  }, [enrichedEvents]);

  const auditKpis = [
    {
      id: 'all',
      label: 'Total movimientos',
      value: counts.total,
      caption: 'Histórico registrado',
      pct: 100,
      icon: Activity,
      tone: 'brand',
      isActive: !state.filters.category,
      onClick: () => state.setFilter('category', ''),
    },
    {
      id: 'session',
      label: 'Sesiones y accesos',
      value: counts.session,
      caption: 'Inicios de sesión',
      pct: counts.total ? Math.round((counts.session / counts.total) * 100) : 0,
      icon: LogIn,
      tone: 'info',
      isActive: state.filters.category === 'session',
      onClick: () => state.setFilter('category', state.filters.category === 'session' ? '' : 'session'),
    },
    {
      id: 'users',
      label: 'Gestión de usuarios',
      value: counts.users,
      caption: 'Cuentas y privilegios',
      pct: counts.total ? Math.round((counts.users / counts.total) * 100) : 0,
      icon: Users,
      tone: 'purple',
      isActive: state.filters.category === 'users',
      onClick: () => state.setFilter('category', state.filters.category === 'users' ? '' : 'users'),
    },
    {
      id: 'inventory',
      label: 'Inventario y mapas',
      value: counts.inventory,
      caption: 'Cambios físicos y APs',
      pct: counts.total ? Math.round((counts.inventory / counts.total) * 100) : 0,
      icon: Server,
      tone: 'success',
      isActive: state.filters.category === 'inventory',
      onClick: () => state.setFilter('category', state.filters.category === 'inventory' ? '' : 'inventory'),
    },
    {
      id: 'idf',
      label: 'Registros IDF',
      value: counts.idf,
      caption: 'Visitas e incidencias',
      pct: counts.total ? Math.round((counts.idf / counts.total) * 100) : 0,
      icon: Building2,
      tone: 'warning',
      isActive: state.filters.category === 'idf',
      onClick: () => state.setFilter('category', state.filters.category === 'idf' ? '' : 'idf'),
    },
  ];

  const columns = [
    {
      key: 'created_at',
      label: 'Fecha y hora',
      width: '18%',
      value: r => r.created_at,
      render: r => (
        <div className="audit-actor-line" title={`Timestamp unix: ${r.created_at}`}>
          <Clock size={13} className="text-muted" aria-hidden="true" />
          <span className="font-mono text-xs">{r.formattedDate}</span>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Categoría',
      width: '13%',
      value: r => r.categoryLabel,
      render: r => (
        <span className={`audit-category audit-category-${r.category}`}>
          {r.categoryLabel}
        </span>
      ),
    },
    {
      key: 'action',
      label: 'Movimiento / Acción',
      width: '29%',
      value: r => `${r.title} ${r.description} ${r.action}`,
      render: r => {
        const Icon = r.meta.icon || Activity;
        return (
          <div className="project-audit-action-cell">
            <span className="project-audit-icon-wrap" aria-hidden="true">
              <Icon size={14} />
            </span>
            <div className="project-audit-action-info">
              <strong>{r.title}</strong>
              <small title={r.description}>{r.details || r.description}</small>
            </div>
          </div>
        );
      },
    },
    {
      key: 'actor',
      label: 'Responsable',
      width: '20%',
      value: r => `${r.actorDisplay} ${r.username || ''}`,
      render: r => (
        <div className="audit-actor-group">
          <div className="audit-actor-line">
            <span className="audit-actor-avatar" aria-hidden="true">
              {(r.actorDisplay || 'S').charAt(0).toUpperCase()}
            </span>
            <strong className="audit-actor-name">{r.actorDisplay}</strong>
          </div>
          {r.user_role && <span className="audit-date-subtext">Rol: {r.user_role}</span>}
        </div>
      ),
    },
    {
      key: 'target',
      label: 'Recurso / Objetivo',
      width: '20%',
      value: r => r.targetDisplay,
      render: r => (
        <div className="project-audit-target-cell">
          <span className="project-audit-target-pill" title={r.targetDisplay}>
            {r.targetDisplay}
          </span>
        </div>
      ),
    },
  ];

  const hasActiveFilters = Boolean(state.query || state.filters.category || state.filters.actor);

  return (
    <>
      <PageHeading
        eyebrow="Auditoría global · Trazabilidad del sistema"
        title="Bitácora General de Movimientos"
        description="Registro integral de cualquier evento o cambio en el proyecto: sesiones, usuarios, inventario, planos de red, conexiones y cuartos IDF"
        updatedAt={data.updatedAt}
      />

      <section className="audit-kpi-grid project-audit-summary" aria-label="Indicadores globales de la bitácora">
        {auditKpis.map(({ id, label, value, caption, icon: Icon, tone, pct, isActive, onClick }) => (
          <button
            key={id}
            type="button"
            className={`audit-kpi audit-kpi-${tone} ${isActive ? 'is-active' : ''}`}
            aria-pressed={isActive}
            onClick={onClick}
          >
            <span className="audit-kpi-heading">
              <i>
                <Icon size={18} />
              </i>
              {label}
            </span>
            <strong>{number(value)}</strong>
            <div className="audit-kpi-meter">
              <i style={{ width: `${pct}%` }} />
            </div>
            <small>
              {caption}
              <b>{pct}%</b>
            </small>
          </button>
        ))}
      </section>

      <DataTable
        title="Historial de movimientos y eventos registrados"
        className="project-audit-table"
        rows={enrichedEvents}
        rowKey="key"
        columns={columns}
        state={state}
        noun="movimientos"
        exportable={false}
        loading={loading}
        error={errors.audit}
        onRetry={refresh}
        toolbar={
          <div className="audit-toolbar">
            <SearchField
              value={state.query}
              onChange={state.setQuery}
              placeholder="Buscar responsable, acción, objetivo o detalle…"
            />
            <Select
              label="Categoría"
              value={state.filters.category || ''}
              onChange={e => state.setFilter('category', e.target.value)}
            >
              <option value="">Todas las categorías</option>
              <option value="session">Sesiones y accesos</option>
              <option value="users">Gestión de usuarios</option>
              <option value="inventory">Inventario físico</option>
              <option value="maps">Plano y APs</option>
              <option value="connections">Conexiones API</option>
              <option value="idf">Registros IDF</option>
            </Select>
            <Select
              label="Responsable"
              value={state.filters.actor || ''}
              onChange={e => state.setFilter('actor', e.target.value)}
            >
              <option value="">Todos los responsables</option>
              {options(enrichedEvents.map(e => e.actorDisplay))}
            </Select>
            {hasActiveFilters && (
              <Button onClick={state.reset} variant="secondary">
                Limpiar filtros
              </Button>
            )}
          </div>
        }
      />

      <Note title="Inmutabilidad y seguridad de auditoría">
        Todos los movimientos registrados en la bitácora son firmados por el servidor y almacenados en SQLite institucional con sellos de tiempo unix inmutables.
      </Note>
    </>
  );
}
