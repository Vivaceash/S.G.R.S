import React, { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FileText, Info, Layers3, Monitor, Network, Package, Plus, Router, Server, ShieldCheck, Users, Wifi, TriangleAlert, ExternalLink, RefreshCw, X } from 'lucide-react';
import { Badge, Button, DataTable, Dialog, Empty, IconButton, Metric, Note, Notice, SearchField, Select, downloadCsv, useListState } from './components.jsx';
import { dateTime, number, request, selectRows, segmentKey, deviceInSegment, getSegmentDevices, paginate, formatDeviceType, formatLocation, getUtilizationTone, getUtilizationColor, statusNames } from './domain.mjs';

export function PageHeading({ eyebrow, title, description, updatedAt, children, headingId = 'page-title' }) {
  const hasActions = Boolean(children || updatedAt);
  return <div className={`page-heading ${hasActions ? 'has-actions' : 'empty-heading'}`}>
    <div className="sr-only">
      {eyebrow && <p>{eyebrow}</p>}
      <h1 tabIndex={-1} id={headingId}>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {hasActions && <div className="page-heading-actions">
      {children}
      {updatedAt && <div className="update-stamp"><CalendarDays size={23} aria-hidden="true" /><div><span>Última consulta</span><strong>{dateTime(updatedAt)}</strong></div></div>}
    </div>}
  </div>;
}
const options = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es-MX', { numeric: true })).map(v => <option key={v} value={v}>{v}</option>);
const detailText = (primary, secondary) => <div className="cell-detail"><strong>{primary || '—'}</strong>{secondary && <small>{secondary}</small>}</div>;
// El prefijo 192.168. corresponde a la red institucional; en IPAM mostramos
// solamente el segmento y host para que las tarjetas sean más legibles.
const displayIp = value => String(value || '—').replace(/^192\.168\./, '');

export function Overview({ data, demo, navigate, loading, errors, userId, openEditor }) {
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
  const [chosen, setChosen] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem(preferenceKey)); return Array.isArray(value) && value.every(v => typeof v === 'string') ? value : null; } catch { return null; }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [preferenceError, setPreferenceError] = useState('');
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
      online: devices.filter(device => device.status === 'online' && deviceInSegment(device, segment)).length,
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
  const editSegments = () => { setDraft(principalKeys); setPreferenceError(''); setEditing(true); };
  const saveSegments = () => {
    try { localStorage.setItem(preferenceKey, JSON.stringify(draft)); }
    catch { setPreferenceError('No se pudo guardar la selección en este navegador. Habilita el almacenamiento e inténtalo de nuevo.'); return; }
    setChosen(draft); setAll(false); setEditing(false);
  };
  return <>
    <PageHeading eyebrow="Centro operativo" title="Dashboard Operativo" description="Métricas generales y estado de la infraestructura de red" updatedAt={data.updatedAt}>
      <div className={`operation-status ${errors.length ? 'degraded' : ''}`}><span className="status-light" /><div><strong>{demo ? 'Escenario de demostración' : errors.length ? 'Información parcial' : loading ? 'Consultando servicios' : 'Consulta completada'}</strong><small>{demo ? 'Datos de ejemplo para revisar el diseño' : 'El estado físico requiere telemetría actualizada'}</small></div></div>
    </PageHeading>
    <section className="overview-metrics" aria-label="Indicadores de infraestructura">
      <Metric icon={Network} label={demo ? 'Disponibilidad de red' : 'Direcciones disponibles'} value={demo ? '98.7%' : loading ? '—' : number(available)} caption={demo ? '+2.3% vs. mes anterior · Ejemplo' : 'Sin asignar en el inventario IP'} />
      <Metric icon={Monitor} tone="success" label="Dispositivos activos" value={loading ? '—' : number(online)} caption={`De ${number(devices.length)} equipos consultados`} />
      <Metric icon={Users} label="Concesiones activas" value={loading ? '—' : number(segments.reduce((sum, s) => sum + (s.active_leases || 0), 0))} caption="Asignaciones reportadas por DHCP" />
      <article className="network-pressure"><div className="network-pressure-header"><h3>Redes más cerca del límite</h3><small>uso de IPs</small></div>{pressureSegments.length ? <ol>{pressureSegments.map(segment => <li key={segmentKey(segment)}><span><strong>{segment.name || segment.interface || 'Red sin nombre'}</strong><small>{number(segment.active_leases)} / {number(segment.capacity)}</small></span><i><em style={{ width: `${Math.min(100, Math.max(0, segment.fillPercent))}%` }} /></i><b>{number(segment.fillPercent)}%</b></li>)}</ol> : <p className="muted">Sin datos de utilización por segmento.</p>}</article>
    </section>
    <section className="segment-section"><div className="section-heading"><Layers3 className="section-icon" size={31} aria-hidden="true" /><div><h2>Segmentos de Red y VLANs</h2><p>Capacidad y asignación de los principales segmentos de la infraestructura</p></div><div className="section-actions"><span>{number(segments.length)} segmentos</span><Button onClick={editSegments} icon={Plus} disabled={loading || !segments.length}>Elegir principales</Button><Button onClick={() => setAll(!all)} icon={ArrowRight}>{all ? 'Ver principales' : 'Ver todos'}</Button></div></div>
      {segments.length ? <><div className="segment-grid">{visibleSegments.map((segment, index) => {
        const isSelected = activeSegmentKey === segmentKey(segment);
        const meterTone = getUtilizationTone(segment.utilization_percent);
        const meterColor = getUtilizationColor(segment.utilization_percent);
        return <article className={`segment-card segment-${index % 3} ${isSelected ? 'segment-card-selected' : ''}`} key={`${segment.id}-${segment.interface}`}>
        <div className="segment-card-heading"><h3><span className="segment-dot" />{segment.name || segment.interface}</h3><Badge status={segment.status} /></div>
        <div className="segment-address"><small>{segment.vlan || segment.interface}</small><strong>{segment.subnet || segment.ip_ranges?.[0] || 'Rango no informado'}</strong></div>
        <dl className="segment-details"><div><dt><Router size={16} />Gateway</dt><dd className="font-mono">{segment.default_gateway || '—'}</dd></div><div><dt><Network size={16} />Máscara</dt><dd className="font-mono">{segment.netmask || '—'}</dd></div><div><dt><FileText size={16} />IPs asignadas</dt><dd><strong>{number(segment.active_leases)} / {number(segment.capacity)}</strong></dd></div></dl>
        <dl className="segment-details segment-secondary"><div><dt><Monitor size={16} />{'Dispositivos en línea'}</dt><dd className="text-success"><strong>{number(devices.filter(device => device.status === 'online' && deviceInSegment(device, segment)).length)}</strong></dd></div><div><dt><Clock3 size={16} />{demo ? 'Promedio diario' : 'Duración de concesión'}</dt><dd>{demo ? number(segment.average) : segment.lease_time_seconds ? `${number(segment.lease_time_seconds)} s` : 'No informada'}</dd></div></dl>
        <div className={`capacity-meter capacity-meter-${meterTone}`} style={{ '--meter-fill': meterColor }}><meter min="0" max="100" value={segment.utilization_percent || 0} className={`meter-${meterTone}`} style={{ '--meter-fill': meterColor }} aria-label={`Utilización de ${segment.interface}`} /><small><span className={`meter-bullet meter-bullet-${meterTone}`} style={{ background: meterColor }} aria-hidden="true" />{number(segment.utilization_percent)}% utilizado</small></div>
        <div className="segment-description"><Building2 size={21} aria-hidden="true" /><p>{segment.description || `Pool de direcciones de la interfaz ${segment.interface}. Consulta los equipos asociados a este segmento.`}</p></div>
        <Button variant={isSelected ? 'secondary' : 'primary'} className={`w-full ${isSelected ? 'is-selected' : ''}`} icon={Server} aria-expanded={isSelected} onClick={() => { const key = segmentKey(segment); if (activeSegmentKey === key) { setActiveSegmentKey(null); } else { setActiveSegmentKey(key); setTimeout(() => { devicesPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60); } }}>{isSelected ? 'Ocultar dispositivos' : 'Ver dispositivos'} {isSelected ? <ChevronDown size={17} /> : <ArrowRight size={17} />}</Button>
      </article>; })}</div>{!visibleSegments.length && <Empty title="Sin segmentos principales" action={<Button icon={Plus} onClick={editSegments}>Elegir principales</Button>}>Agrega los segmentos que quieres ver en tu dashboard.</Empty>}</> : <div className="panel"><Empty title={loading ? 'Consultando segmentos de red' : 'Sin segmentos disponibles'}>{loading ? 'Espera mientras se consulta la capacidad DHCP.' : 'La conexión con el servicio DHCP no devolvió segmentos. Puedes revisar el inventario IP o actualizar la consulta.'}</Empty></div>}
    </section>
    {activeSegment && <SegmentDevicesPanel panelRef={devicesPanelRef} segment={activeSegment} devices={devices} onClose={() => setActiveSegmentKey(null)} openEditor={openEditor} />}
    <section className="network-usage panel" aria-labelledby="network-usage-title">
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
    <Dialog open={editing} onClose={() => setEditing(false)} title="Elegir segmentos principales" wide>
      <p className="muted">Selecciona las tarjetas que quieres mostrar al abrir el dashboard. Esta preferencia se guarda para tu cuenta en este navegador.</p>
      <div className="segment-picker">{segments.map(segment => { const key = segmentKey(segment); const selected = draft.includes(key); return <article className="panel" key={key}><div><strong>{segment.name || segment.interface}</strong><p className="muted font-mono">{segment.subnet || segment.ip_ranges?.join(', ') || segment.default_gateway || 'Rango no informado'}</p></div><Button aria-pressed={selected} aria-label={`${selected ? 'Quitar' : 'Agregar'} ${segment.name || segment.interface}`} icon={selected ? Check : Plus} variant={selected ? 'primary' : 'secondary'} onClick={() => setDraft(old => selected ? old.filter(value => value !== key) : [...old, key])}>{selected ? 'Visible · Quitar' : 'Agregar'}</Button></article>; })}</div>
      {preferenceError && <Notice tone="danger" title="No se guardó la selección">{preferenceError}</Notice>}
      <div className="dialog-actions"><Button onClick={() => setEditing(false)}>Cancelar</Button><Button variant="primary" onClick={saveSegments}>Guardar selección</Button></div>
    </Dialog>
    <Note>Consulta el inventario de {number(resources.length)} recursos y registra las visitas a los cuartos de telecomunicaciones. {demo ? 'Todas las cifras de esta vista son de demostración.' : 'La disponibilidad histórica y el estado global de la red aún no se calculan.'}</Note>
  </>;
}
export function Requests({ demo }) {
  const usersState = useListState('altas-usuarios');
  const [snapshot, setSnapshot] = useState({ users: [], sources: {}, loading: !demo, error: '', updatedAt: null });
  const [selectedUser, setSelectedUser] = useState(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (demo) { setSnapshot({ users: [], sources: {}, loading: false, error: '', updatedAt: null }); return; }
    const controller = new AbortController(); let alive = true;
    setSnapshot(old => ({ ...old, loading: true, error: '' }));
    request('/api/altas/omnivista', { signal: controller.signal }).then(result => {
      if (!result.success && !result.data) throw new Error('OmniVista no confirmó la consulta.');
      const data = result.data || {};
      if (alive) {
        const users = Array.isArray(data.users) ? data.users : [];
        setSnapshot({ users, sources: data.sources || {}, loading: false, error: '', updatedAt: new Date().toISOString() });
        // Si el detalle de una cuenta estaba abierto mientras se actualizaba,
        // reemplazar la referencia evita mostrar la lista anterior de dispositivos.
        setSelectedUser(current => current ? users.find(user => user.username === current.username) || null : null);
      }
    }).catch(error => { if (alive) setSnapshot(old => ({ ...old, loading: false, error: error.name === 'AbortError' ? 'Consulta cancelada.' : error.message })); });
    return () => { alive = false; controller.abort(); };
  }, [demo, revision]);
  const deviceCount = snapshot.users.reduce((total, user) => total + (Array.isArray(user.devices) ? user.devices.length : 0), 0);
  const userColumns = [{ key: 'username', label: 'Cuenta' }, { key: 'fullName', label: 'Nombre' }, { key: 'department', label: 'Departamento' }, { key: 'position', label: 'Puesto' }, { key: 'accessRoleProfile', label: 'Perfil de acceso' }, { key: 'status', label: 'Estado', render: row => <Badge status={row.status} /> }, { key: 'devices', label: 'Dispositivos', sortable: false, render: row => <Button onClick={() => setSelectedUser(row)}>{Array.isArray(row.devices) ? row.devices.length : 0} · Ver</Button> }];
  return <><PageHeading eyebrow="Gestión de altas · Consulta" title="Gestión de Altas de Red" description="Consulta de cuentas y dispositivos registrados en OmniVista. Esta pantalla no crea, aprueba ni modifica altas." updatedAt={snapshot.updatedAt}><Button icon={RefreshCw} busy={snapshot.loading} onClick={() => setRevision(value => value + 1)}>Actualizar consulta</Button></PageHeading>
    <Notice title="Modo solo consulta">La información proviene de OmniVista. No hay botones de alta, aprobación, asignación ni escritura en esta pantalla.</Notice>
    {demo && <Notice title="Vista de demostración">Para consultar OmniVista cambia a datos del sistema e inicia sesión con una cuenta autorizada.</Notice>}
    {snapshot.error && <Notice title="No se pudo consultar OmniVista" tone="danger" action={<Button onClick={() => setRevision(value => value + 1)}>Reintentar</Button>}>{snapshot.error}</Notice>}
    <div className="metric-grid"><Metric icon={Users} label="Cuentas cotejadas" value={snapshot.loading ? '—' : number(snapshot.users.length)} caption={snapshot.sources.users?.complete ? 'Total recorrido en OmniVista' : 'Total no confirmado'} /><Metric icon={Monitor} tone="success" label="Dispositivos asociados" value={snapshot.loading ? '—' : number(deviceCount)} caption={snapshot.sources.company_properties?.complete ? `${number(snapshot.sources.company_properties?.unassociated || 0)} sin cuenta coincidente` : 'Cotejo parcial'} /><Metric icon={Network} tone="info" label="Coincidencias FortiGate" value={snapshot.loading ? '—' : number(snapshot.sources.fortigate?.matches || 0)} caption={snapshot.sources.fortigate?.status === 200 ? 'MAC asociada encontrada en FortiGate' : 'Fuente no disponible'}/></div>
    <DataTable title="Cuentas de usuarios OmniVista" rows={snapshot.users} columns={userColumns} state={usersState} noun="cuentas" loading={snapshot.loading} error={snapshot.error} onRetry={() => setRevision(value => value + 1)} exportable={!demo} emptyText="OmniVista no devolvió cuentas en esta consulta." toolbar={<SearchField value={usersState.query} onChange={usersState.setQuery} placeholder="Buscar cuenta, nombre o departamento…" />} />
    <Dialog open={Boolean(selectedUser)} title={`Dispositivos de ${selectedUser?.username || 'la cuenta'}`} onClose={() => setSelectedUser(null)} wide><p className="muted">Cotejo entre Company Property de OmniVista y el inventario observado por FortiGate.</p>{selectedUser?.devices?.length ? <div className="detail-list">{selectedUser.devices.map((device, index) => <article className="panel" key={`${device.deviceMac || device.id || index}`}><div className="flex items-center justify-between gap-3"><strong>{device.deviceName || device.deviceMac || 'Dispositivo sin nombre'}</strong><Badge status={device.forti?.status || device.status} /></div><dl className="detail-grid"><div><dt>MAC</dt><dd>{device.deviceMac || '—'}</dd></div><div><dt>Equipo OmniVista</dt><dd>{device.lastAccessDeviceName || '—'}</dd></div><div><dt>Categoría / familia</dt><dd>{[device.deviceCategory, device.deviceFamily].filter(Boolean).join(' · ') || '—'}</dd></div><div><dt>Sistema operativo</dt><dd>{device.deviceOS || '—'}</dd></div><div><dt>Cotejo</dt><dd>{device.cotejo}</dd></div>{device.forti && <><div><dt>FortiGate · IP</dt><dd>{device.forti.ip || '—'}</dd></div><div><dt>FortiGate · tipo / interfaz</dt><dd>{[device.forti.type, device.forti.interface].filter(Boolean).join(' · ') || '—'}</dd></div><div><dt>FortiGate · última detección</dt><dd>{device.forti.last_seen || '—'}</dd></div></>}</dl></article>)}</div> : <Empty title="Sin dispositivos asociados">OmniVista no tiene terminales asociadas a esta cuenta en la consulta actual.</Empty>}</Dialog>
    <Note title="Alcance de la consulta">La tabla principal contiene cuentas; los dispositivos aparecen al seleccionar “Ver”. La información FortiGate es una coincidencia por MAC (y no modifica ningún equipo).</Note></>;
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
  const rows = data.ips.map(r => ({ ...r, id: r.ip }));
  const [view, setView] = useState('matrix');
  const columns = [{ key: 'ip', label: 'Dirección IP', render: r => <strong className="ip-address" title={r.ip}>{displayIp(r.ip)}</strong> }, { key: 'vlan', label: 'VLAN / Segmento' }, { key: 'location', label: 'Ubicación' }, { key: 'type', label: 'Tipo de uso' }, { key: 'status', label: 'Estado', render: r => <Badge status={r.status} /> }, { key: 'hostname', label: 'Equipo asignado' }, { key: 'actions', label: 'Acciones', sortable: false, render: r => <Button disabled={!canWrite} onClick={() => openEditor('ip', r)}>{r.status === 'available' ? 'Asignar' : 'Administrar'}</Button> }];
  const filtered = selectRows(rows, state.query, state.filters, state.sort, state.asc);
  const segmentRows = state.filters.vlan ? rows.filter(row => row.vlan === state.filters.vlan) : rows;
  const counts = ['all', 'available', 'occupied', 'reserved'].reduce((result, status) => ({ ...result, [status]: status === 'all' ? segmentRows.length : segmentRows.filter(row => row.status === status).length }), {});
  const filteredBySegment = filtered.reduce((groups, row) => { const key = row.vlan || 'Sin segmento'; (groups[key] ||= []).push(row); return groups; }, {});
  const chooseStatus = status => state.setFilter('status', status === 'all' ? '' : status);
  const labelForStatus = status => ({ available: 'Libre', occupied: 'Ocupada', reserved: 'Reservada' }[status] || 'Sin estado');
  return <><PageHeading eyebrow="Inventario de infraestructura" title="Direcciones IP" description="Consulta de direcciones disponibles y asignadas por segmento de red" updatedAt={data.updatedAt}><Button icon={Download} disabled={!filtered.length || !canExport} onClick={() => downloadCsv('Direcciones-IP', columns.filter(c => c.key !== 'actions'), filtered)}>Exportar</Button></PageHeading>
    <section className="ip-kpi-grid" aria-label="Resumen de direcciones IP">{[
      ['all', 'Total direcciones', counts.all, 'Todos los segmentos'], ['available', 'Libres disponibles', counts.available, 'Listas para asignación'], ['occupied', 'IPs ocupadas', counts.occupied, 'Asignadas en producción'], ['reserved', 'Reservadas / gateways', counts.reserved, 'Gateways y VIPs de enlace'],
    ].map(([status, label, value, caption]) => <button key={status} type="button" className={`ip-kpi ip-kpi-${status} ${(!state.filters.status && status === 'all') || state.filters.status === status ? 'is-active' : ''}`} onClick={() => chooseStatus(status)}><span>{label}</span><strong>{number(value)}</strong><i style={{ width: `${counts.all ? Math.round(value / counts.all * 100) : 0}%` }} /><small>{caption}</small></button>)}</section>
    <div className="toolbar ip-toolbar"><Select label="VLAN / Segmento" value={state.filters.vlan || ''} onChange={e => state.setFilter('vlan', e.target.value)}><option value="">Todos los segmentos</option>{options(rows.map(r => r.vlan))}</Select><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar IP, host, MAC o ubicación…" /><div className="ip-status-filters" aria-label="Filtrar por estado">{[['all', 'Todas'], ['available', 'Libres'], ['occupied', 'Ocupadas'], ['reserved', 'Reservadas']].map(([status, label]) => <button type="button" key={status} aria-pressed={(!state.filters.status && status === 'all') || state.filters.status === status} onClick={() => chooseStatus(status)}>{label} <b>{number(counts[status])}</b></button>)}</div><div className="ip-view-toggle" aria-label="Vista de direcciones"><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>☷ Lista</button><button type="button" aria-pressed={view === 'matrix'} onClick={() => setView('matrix')}>▦ Matriz</button></div></div>
    {view === 'matrix' ? <section className="ip-matrix" aria-label="Matriz de direcciones IP">{loading ? <div className="loading-state">Cargando direcciones IP…</div> : errors.ips ? <Notice title="No se pudieron cargar las direcciones" tone="warning" action={<Button onClick={refresh}>Reintentar</Button>}>{errors.ips}</Notice> : Object.entries(filteredBySegment).map(([segment, ips]) => <section key={segment} className="ip-segment"><div><h2>{segment}</h2><span>{ips.length} IPs</span></div><article>{ips.map(ip => <button key={ip.ip} type="button" className={`ip-cell ip-cell-${ip.status}`} onClick={() => openEditor('ip', ip)} title={`${ip.ip} · ${labelForStatus(ip.status)}${ip.hostname ? ` · ${ip.hostname}` : ''}`}><strong>{displayIp(ip.ip)}</strong><small><i />{labelForStatus(ip.status)}</small></button>)}</article></section>)}{!loading && !errors.ips && !filtered.length && <Empty title="Sin direcciones coincidentes">Modifica los filtros o busca otra dirección.</Empty>}</section> : <DataTable title="Direcciones IP" rows={rows} columns={columns} state={state} noun="direcciones" loading={loading} error={errors.ips} onRetry={refresh} />}
    <Note>Las asignaciones modifican el inventario local. No cambian reservas DHCP ni aplican configuraciones al firewall.</Note></>;
}
export function Devices({ data, navigate, openEditor, loading, errors, refresh, canExport, selectedSegment }) {
  const state = useListState('equipos');
  const segment = data.segments.find(item => segmentKey(item) === selectedSegment);
  const eligible = data.devices.filter(device => device.status === 'online' || device.is_reserved === true);
  const devices = selectedSegment ? eligible.filter(device => deviceInSegment(device, segment)) : eligible;
  const omniMatchedCount = devices.filter(d => d.omnivista?.matched).length;
  const sizeChoice = ['25', '50', '100', 'all'].includes(state.pageSize) ? state.pageSize : '25';
  const pageSize = sizeChoice === 'all' ? Math.max(1, devices.length) : Number(sizeChoice);

  const columns = [
    {
      key: 'name',
      label: 'Dispositivo',
      value: r => r.omnivista?.device_name || r.name,
      render: r => (
        <div className="cell-detail">
          <div className="flex items-center gap-2">
            <strong>{r.omnivista?.device_name || r.name}</strong>
            {r.omnivista?.matched && <span className="network-tag omni-tag" title="Cotejado con Company Property de OmniVista 2500">OmniVista</span>}
          </div>
          <small>{[r.vendor, r.omnivista?.account && `Cuenta: ${r.omnivista.account}`, r.name !== r.omnivista?.device_name && r.name].filter(Boolean).join(' · ')}</small>
        </div>
      )
    },
    {
      key: 'ip',
      label: 'Dirección IP',
      value: r => r.ip_source === 'unconfirmed' ? 'Pendiente de confirmar' : (r.ip || '—'),
      render: r => (
        <div className="cell-detail">
          <span className="ip-address">{r.ip_source === 'unconfirmed' ? 'Pendiente de confirmar' : (r.ip || '—')}</span>
          {r.is_reserved && <small>IP reservada{r.reserved_ip && r.reserved_ip !== r.ip ? `: ${r.reserved_ip}` : ''}</small>}
        </div>
      )
    },
    {
      key: 'mac',
      label: 'MAC',
      value: r => r.mac || '—',
      render: r => <span className="font-mono text-muted">{r.mac || '—'}</span>
    },
    {
      key: 'type',
      label: 'Tipo',
      value: r => formatDeviceType(r.type, r.os || r.omnivista?.os || r.raw?.os_name, r.omnivista?.device_name || r.name, r.vendor),
      render: r => formatDeviceType(r.type, r.os || r.omnivista?.os || r.raw?.os_name, r.omnivista?.device_name || r.name, r.vendor)
    },
    {
      key: 'location',
      label: 'Ubicación',
      value: r => r.omnivista?.location || formatLocation(r.location, r.vendor, segment?.name || r.interface),
      render: r => r.omnivista?.location ? (
        <div className="cell-detail">
          <strong className="text-location">{r.omnivista.location}</strong>
          {r.omnivista.ap_name && <small className="text-muted">AP: {r.omnivista.ap_name}</small>}
        </div>
      ) : (
        formatLocation(r.location, r.vendor, segment?.name || r.interface)
      )
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
      render: r => r.activity || r.last_seen || 'Reciente'
    }
  ];

  const rows = devices.map((d, i) => ({
    ...d,
    id: `${d.interface || ''}:${d.mac || d.ip}:${i}`,
    _search_name: d.omnivista?.device_name || d.name || '',
    _search_loc: d.omnivista?.location || formatLocation(d.location, d.vendor, segment?.name || d.interface) || '',
    _search_type: formatDeviceType(d.type, d.os || d.omnivista?.os || d.raw?.os_name, d.omnivista?.device_name || d.name, d.vendor) || '',
    _search_acc: d.omnivista?.account || '',
    _search_ap: d.omnivista?.ap_name || '',
    _search_mac: d.mac || '',
  }));

  return <><PageHeading eyebrow="Inventario de infraestructura" title="Dispositivos de Red" description="Equipos detectados y consulta de información técnica" updatedAt={data.updatedAt}>
    {omniMatchedCount > 0 && <span className="network-tag omni-badge">{number(omniMatchedCount)} cotejados en OmniVista</span>}
    {canExport && <Button icon={Download} disabled={!devices.length} onClick={() => downloadCsv('Dispositivos-de-Red', columns, rows)}>Exportar</Button>}
  </PageHeading>
    {selectedSegment && <Notice title={segment ? `Segmento: ${segment.name || segment.interface}` : 'Segmento no disponible'} action={<Button onClick={() => { state.setPage(1); navigate('dispositivos'); }}>Ver todos los segmentos</Button>}>{segment ? [segment.subnet, segment.default_gateway && `Gateway ${segment.default_gateway}`, segment.netmask && `Máscara ${segment.netmask}`].filter(Boolean).join(' · ') || segment.ip_ranges?.join(', ') : 'Actualiza la consulta para cargar este segmento.'}</Notice>}
    <div className="toolbar"><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar por equipo, IP, MAC o fabricante…" /><Select label="Estado" value={state.filters.status || ''} onChange={e => state.setFilter('status', e.target.value)}><option value="">Todos los estados</option><option value="online">En servicio</option><option value="offline">Reservados fuera de línea</option></Select><Select label="Dispositivos por página" value={sizeChoice} onChange={e => state.setPageSize(e.target.value)}><option value="25">25 dispositivos</option><option value="50">50 dispositivos</option><option value="100">100 dispositivos</option><option value="all">Todos los dispositivos</option></Select><div className="segment-devices-hint"><Info size={16} aria-hidden="true" /><span>Selecciona cualquier fila para abrir el detalle técnico</span></div></div>
    <DataTable title="Dispositivos de red" rows={rows} columns={columns} state={state} pageSize={pageSize} noun="dispositivos" exportable={false} loading={loading} error={errors.devices || (selectedSegment && errors.segments)} onRetry={refresh} onRowClick={r => openEditor('device-detail', r)} rowClassName={r => r.status === 'offline' ? 'segment-device-row device-row-offline' : 'segment-device-row'} />
    <Note>Se muestran equipos en línea y equipos con reserva DHCP, aunque estén desconectados. El estado en línea proviene de FortiGate. Las IP se actualizan por MAC con DHCP y ARP; los equipos sin dirección confirmada permanecen visibles en su interfaz. Los registros históricos sin reserva se excluyen.</Note></>;
}
export function AuditLog({ data, records, navigate, openEditor, loading, errors, refresh, idfView = false, canWrite, canExport }) {
  const state = useListState(idfView ? 'reportes-idf' : 'bitacora');
  const columns = [{ key: 'id', label: 'Folio', render: r => <span className="folio">{r.id}</span> }, { key: 'idf', label: 'IDF' }, { key: 'title', label: 'Actividad', render: r => detailText(r.title, r.description) }, { key: 'actor', label: 'Responsable' }, { key: 'temp', label: 'Temperatura', render: r => r.temp == null ? '—' : `${r.temp} °C` }, { key: 'status', label: 'Estado', render: r => <Badge status={r.status} /> }, { key: 'date', label: 'Fecha y hora', render: r => dateTime(r.date) }, { key: 'actions', label: 'Acciones', sortable: false, render: r => <Button onClick={() => openEditor('report-detail', r)}>Ver</Button> }];
  return <><PageHeading eyebrow={idfView ? 'Registro IDF · Supervisión' : 'Trazabilidad operativa'} title={idfView ? 'Reportes e incidencias de IDF' : 'Bitácora de Registros'} description={idfView ? 'Consulta los registros enviados desde dispositivos móviles' : 'Historial de inspecciones e incidencias en cuartos de telecomunicaciones'} updatedAt={data.updatedAt} />
    {idfView && <><section className="metric-grid"><Metric icon={FileText} label="Reportes recibidos" value={number(records.length)} caption="registros en la bitácora" /><Metric icon={TriangleAlert} tone="danger" label="Con incidencias" value={number(records.filter(r => r.status === 'open').length)} caption="inconvenientes reportados" /><Metric icon={CheckCircle2} tone="success" label="Sin pendientes" value={number(records.filter(r => r.status === 'resolved').length)} caption="visitas sin incidencias abiertas" /><Metric icon={Building2} tone="gold" label="IDFs con registros" value={number(new Set(records.map(r => r.idfId)).size)} caption="cuartos con actividad documentada" /></section><Notice title="Vista de consulta en escritorio">Las entradas se registran desde Registro IDF en el móvil. Desde el detalle puedes consultar una incidencia y registrar su resolución; el reporte original se conserva.</Notice></>}
    <div className="toolbar"><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar folio, responsable o actividad…" /><Select label="IDF" value={state.filters.idf || ''} onChange={e => state.setFilter('idf', e.target.value)}><option value="">Todos los IDFs</option>{options(records.map(r => r.idf))}</Select><Select label="Tipo de reporte" value={state.filters.status || ''} onChange={e => state.setFilter('status', e.target.value)}><option value="">Todos los reportes</option><option value="open">Con incidencias abiertas</option><option value="resolved">Sin pendientes</option></Select><Button icon={RefreshCw} busy={loading} onClick={refresh}>Actualizar reportes</Button></div>
    <DataTable title={idfView ? 'Reportes enviados desde móvil' : 'Bitácora de visitas'} rows={records} rowKey="key" columns={columns} state={state} noun="registros" exportable={canExport} loading={loading} error={errors.reports || errors.idfs} onRetry={refresh} />
    {!idfView && canWrite && <div className="idf-mobile"><Button icon={Plus} onClick={() => navigate('idf')}>Registrar otra entrada</Button></div>}
    <Note>Horarios de Ciudad de México. Los registros nuevos incluyen la identidad de la cuenta y la fecha asignadas por el servidor. Los registros históricos conservan la información declarada originalmente.</Note></>;
}


export function SegmentDevicesPanel({ panelRef, segment, devices = [], onClose, openEditor }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pageSizeChoice, setPageSizeChoice] = useState('25');
  const [currentPage, setCurrentPage] = useState(1);

  const segmentDevices = getSegmentDevices(devices, segment);
  const onlineCount = segmentDevices.filter(d => d.status === 'online').length;
  const omniMatchedCount = segmentDevices.filter(d => d.omnivista?.matched).length;

  const filtered = segmentDevices.filter(d => {
    if (statusFilter && d.status !== statusFilter) return false;
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
          <span className="network-tag">{number(segmentDevices.length)} dispositivos ({number(onlineCount)} en línea)</span>
          {omniMatchedCount > 0 && <span className="network-tag omni-badge">{number(omniMatchedCount)} cotejados en OmniVista</span>}
        </div>
      </div>
      <div className="segment-devices-actions">
        <Button icon={X} variant="secondary" onClick={onClose}>Cerrar</Button>
      </div>
    </div>
    <div className="segment-devices-toolbar">
      <SearchField value={query} onChange={handleQuery} placeholder="Buscar por equipo, IP, MAC o fabricante…" />
      <Select label="Estado" value={statusFilter} onChange={handleStatus}>
        <option value="">Todos los estados</option>
        <option value="online">En servicio</option>
        <option value="offline">Fuera de línea / Reservados</option>
      </Select>
      <Select label="Dispositivos por página" value={pageSizeChoice} onChange={handleSize}>
        <option value="25">25 dispositivos</option>
        <option value="50">50 dispositivos</option>
        <option value="100">100 dispositivos</option>
        <option value="all">Todos los dispositivos</option>
      </Select>
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
