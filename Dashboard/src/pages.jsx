import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, ArrowUpDown, Building2, Camera, Check, CheckCircle2, Eye, Thermometer, ChevronDown, ChevronLeft, ChevronRight, Clock, Clock3, Copy, Download, FileText, Grid, HardDrive, Headset, Info, Laptop, Layers3, List, Monitor, Network, Package, Plus, Printer, Radio, RotateCcw, Router, Server, ShieldCheck, Smartphone, Users, Wifi, TriangleAlert, ExternalLink, RefreshCw, X, LogIn, LogOut, UserPlus, KeyRound, PlugZap, MapPin, MapPinOff, Calendar, CalendarDays, FilePlus, MessageSquare, Send } from 'lucide-react';
import { Badge, Button, DataTable, Dialog, Empty, Field, IconButton, Metric, Note, Notice, SearchField, Select, downloadCsv, downloadExcel, useListState } from './components.jsx';
import { dateTime, number, request, selectRows, segmentKey, deviceInSegment, getOverviewSegmentDevices, isMeztliSegment, paginate, formatDeviceType, formatLocation, getUtilizationTone, getUtilizationColor, statusNames, formatUptime, getSaturationStatus, getSaturationLabel, SUPPORT_EXPORT_COLUMNS, buildSupportSheets, getSupportSegments, normalizeText } from './domain.mjs';
import { useSession } from './session.jsx';

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
  const editSegments = () => { setDraft(principalKeys); setPreferenceError(''); setEditing(true); };
  const saveSegments = () => {
    try { localStorage.setItem(preferenceKey, JSON.stringify(draft)); }
    catch { setPreferenceError('No se pudo guardar la selección en este navegador. Habilita el almacenamiento e inténtalo de nuevo.'); return; }
    setChosen(draft); setAll(false); setEditing(false);
  };
  return <>
    <PageHeading eyebrow="Centro operativo" title="Dashboard Operativo" description="Métricas generales y estado de la infraestructura de red" updatedAt={data.updatedAt} />
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
        <dl className="segment-details segment-secondary"><div><dt><Monitor size={16} />{isMeztliSegment(segment) ? 'Concesiones DHCP' : 'Dispositivos en línea'}</dt><dd className="text-success"><strong>{isMeztliSegment(segment) ? number(segment.active_leases) : number(getOverviewSegmentDevices(devices, segment).filter(device => device.status === 'online').length)}</strong></dd></div><div><dt><Clock3 size={16} />{demo ? 'Promedio diario' : 'Duración de concesión'}</dt><dd>{demo ? number(segment.average) : segment.lease_time_seconds ? `${number(segment.lease_time_seconds)} s` : 'No informada'}</dd></div></dl>
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
  const accountsWithDevices = useMemo(
    () => snapshot.users.filter(user => Array.isArray(user.devices) && user.devices.length > 0).length,
    [snapshot.users]
  );
  const accountsCoverage = snapshot.users.length ? Math.round((accountsWithDevices / snapshot.users.length) * 100) : 0;

  const userColumns = [
    { key: 'username', label: 'Cuenta' },
    { key: 'fullName', label: 'Nombre' },
    { key: 'department', label: 'Departamento' },
    { key: 'position', label: 'Puesto' },
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
        description="Consulta de cuentas y dispositivos registrados en OmniVista. Esta pantalla no crea, aprueba ni modifica altas."
        updatedAt={snapshot.updatedAt}
      />

      <div className="altas-banner-strip">
        <div className="altas-badge-readonly">
          <Info size={14} aria-hidden="true" />
          <span>Modo solo consulta · OmniVista</span>
        </div>
        <p className="altas-readonly-desc">
          Consulta de cuentas y terminales en OmniVista con cotejo en FortiGate. Las altas y asignaciones se gestionan en las consolas centrales.
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
          icon={Users}
          label="Cuentas cotejadas"
          value={snapshot.loading ? '—' : number(snapshot.users.length)}
          caption={snapshot.sources.users?.complete ? 'Total recorrido en OmniVista' : 'Total no confirmado'}
        />
        <Metric
          icon={Monitor}
          tone="success"
          label="Dispositivos asociados"
          value={snapshot.loading ? '—' : number(deviceCount)}
          caption={snapshot.sources.company_properties?.complete ? `${number(snapshot.sources.company_properties?.unassociated || 0)} sin cuenta coincidente` : 'Cotejo parcial'}
        />
        <Metric
          icon={ShieldCheck}
          tone="gold"
          label="Cuentas con equipo"
          value={snapshot.loading ? '—' : number(accountsWithDevices)}
          caption={`${accountsCoverage}% con terminal vinculada`}
        />
        <Metric
          icon={Network}
          tone="info"
          label="Coincidencias FortiGate"
          value={snapshot.loading ? '—' : number(snapshot.sources.fortigate?.matches || 0)}
          caption={snapshot.sources.fortigate?.status === 200 ? 'MAC asociada encontrada en FortiGate' : 'Fuente no disponible'}
        />
      </div>

      <DataTable
        title="Cuentas de usuarios OmniVista"
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
    <Dialog open={Boolean(selectedUser)} title={`Dispositivos de ${selectedUser?.username || 'la cuenta'}`} onClose={() => setSelectedUser(null)} wide><p className="muted">Cotejo entre Company Property de OmniVista y el inventario observado por FortiGate.</p>{selectedUser?.devices?.length ? <div className="detail-list">{selectedUser.devices.map((device, index) => <article className="panel" key={`${device.deviceMac || device.id || index}`}><div className="flex items-center justify-between gap-3"><strong>{device.deviceName || device.deviceMac || 'Dispositivo sin nombre'}</strong><Badge status={device.forti?.status || device.status} /></div><dl className="detail-grid"><div><dt>MAC</dt><dd>{device.deviceMac || '—'}</dd></div><div><dt>Equipo OmniVista</dt><dd>{device.lastAccessDeviceName || '—'}</dd></div><div><dt>Categoría / familia</dt><dd>{[device.deviceCategory, device.deviceFamily].filter(Boolean).join(' · ') || '—'}</dd></div><div><dt>Sistema operativo</dt><dd>{device.deviceOS || '—'}</dd></div><div><dt>Cotejo</dt><dd>{device.cotejo}</dd></div>{device.forti && <><div><dt>FortiGate · IP</dt><dd>{device.forti.ip || '—'}</dd></div><div><dt>FortiGate · tipo / interfaz</dt><dd>{[device.forti.type, device.forti.interface].filter(Boolean).join(' · ') || '—'}</dd></div><div><dt>FortiGate · última detección</dt><dd>{device.forti.last_seen || '—'}</dd></div></>}</dl></article>)}</div> : <Empty title="Sin dispositivos asociados">OmniVista no tiene terminales asociadas a esta cuenta en la consulta actual.</Empty>}</Dialog>
      <Note title="Alcance de la consulta">La tabla principal contiene cuentas; los dispositivos aparecen al seleccionar “Ver”. La información FortiGate es una coincidencia por MAC (y no modifica ningún equipo).</Note>
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
  const rows = data.ips.map(r => ({ ...r, id: r.ip }));
  const [view, setView] = useState('matrix');
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
    <div className="toolbar ip-toolbar"><Select label="VLAN / Segmento" value={state.filters.vlan || ''} onChange={e => state.setFilter('vlan', e.target.value)}><option value="">Todos los segmentos</option>{options(rows.map(r => r.vlan))}</Select><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar IP, host, MAC o ubicación…" /><div className="ip-status-filters" aria-label="Filtrar por estado">{[['all', 'Todas'], ['available', 'Libres'], ['occupied', 'Ocupadas'], ['reserved', 'Reservadas']].map(([status, label]) => <button type="button" key={status} aria-pressed={(!state.filters.status && status === 'all') || state.filters.status === status} onClick={() => chooseStatus(status)}>{label} <b>{number(counts[status])}</b></button>)}</div><div className="ip-view-toggle" aria-label="Vista de direcciones"><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>☷ Lista</button><button type="button" aria-pressed={view === 'matrix'} onClick={() => setView('matrix')}>▦ Matriz</button></div></div>
    {view === 'matrix' ? <section className="ip-matrix" aria-label="Matriz de direcciones IP">{loading ? <div className="loading-state">Cargando direcciones IP…</div> : errors.ips ? <Notice title="No se pudieron cargar las direcciones" tone="warning" action={<Button onClick={refresh}>Reintentar</Button>}>{errors.ips}</Notice> : Object.entries(filteredBySegment).map(([segment, ips]) => <section key={segment} className="ip-segment"><div><h2>{segment}</h2><span>{ips.length} IPs</span></div><article>{ips.map(ip => <button key={ip.ip} type="button" className={`ip-cell ip-cell-${ip.status}`} onClick={() => openEditor('ip', ip)} title={`${ip.ip} · ${labelForStatus(ip.status)}${ip.hostname ? ` · ${ip.hostname}` : ''}`}><strong>{displayIp(ip.ip)}</strong><small><i />{labelForStatus(ip.status)}</small></button>)}</article></section>)}{!loading && !errors.ips && !filtered.length && <Empty title="Sin direcciones coincidentes">Modifica los filtros o busca otra dirección.</Empty>}</section> : <DataTable title="Direcciones IP" rows={rows} columns={columns} state={state} noun="direcciones" loading={loading} error={errors.ips} onRetry={refresh} />}
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
        <SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar por equipo, IP, MAC o fabricante…" />
        <Select label="Estado" value={state.filters.status || ''} onChange={e => state.setFilter('status', e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="online">En servicio</option>
          <option value="offline">Reservados fuera de línea</option>
        </Select>
        <Select label="Dispositivos por página" value={sizeChoice} onChange={e => state.setPageSize(e.target.value)}>
          <option value="25">25 dispositivos</option>
          <option value="50">50 dispositivos</option>
          <option value="100">100 dispositivos</option>
          <option value="all">Todos los dispositivos</option>
        </Select>
        {canExport && (
          <Button
            icon={Download}
            disabled={!devices.length}
            onClick={() => downloadCsv('Dispositivos-de-Red', columns, rows)}
          >
            Exportar
          </Button>
        )}
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

function getDaysDifference(start, end) {
  if (!start || !end) return 1;
  const d1 = new Date(start + 'T00:00:00');
  const d2 = new Date(end + 'T00:00:00');
  const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
  return Number.isFinite(diff) && diff > 0 ? diff : 1;
}

function addDaysToDate(dateStr, days) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function DateRangeCalendarPicker({ startDate, endDate, onSelectRange }) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = startDate ? new Date(startDate + 'T00:00:00') : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const firstDay = new Date(viewMonth.year, viewMonth.month, 1).getDay();
  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const adjustedFirstDay = (firstDay + 6) % 7;

  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: adjustedFirstDay }, (_, i) => i);

  const formatDayStr = day => {
    const m = String(viewMonth.month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${viewMonth.year}-${m}-${d}`;
  };

  const handleDayClick = day => {
    const clicked = formatDayStr(day);
    if (!startDate || (startDate && endDate && startDate !== endDate)) {
      onSelectRange(clicked, clicked);
    } else if (startDate && !endDate) {
      if (clicked < startDate) {
        onSelectRange(clicked, startDate);
      } else {
        onSelectRange(startDate, clicked);
      }
    } else {
      if (clicked < startDate) {
        onSelectRange(clicked, startDate);
      } else {
        onSelectRange(startDate, clicked);
      }
    }
  };

  const nextMonth = () => {
    setViewMonth(prev => prev.month === 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: prev.month + 1 });
  };
  const prevMonth = () => {
    setViewMonth(prev => prev.month === 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: prev.month - 1 });
  };

  const totalDays = getDaysDifference(startDate, endDate);

  return (
    <div className="meztli-calendar-picker panel">
      <div className="meztli-calendar-header">
        <IconButton label="Mes anterior" icon={ChevronLeft} onClick={prevMonth} />
        <strong>{monthNames[viewMonth.month]} {viewMonth.year}</strong>
        <IconButton label="Mes siguiente" icon={ChevronRight} onClick={nextMonth} />
      </div>

      <div className="meztli-calendar-weekdays">
        <span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span>
      </div>

      <div className="meztli-calendar-grid">
        {blanks.map(b => <div key={`b-${b}`} className="meztli-calendar-cell empty" />)}
        {daysArray.map(day => {
          const dateStr = formatDayStr(day);
          const isSelected = startDate && endDate && dateStr >= startDate && dateStr <= endDate;
          const isStart = dateStr === startDate;
          const isEnd = dateStr === endDate;
          const isToday = dateStr === todayStr;

          return (
            <button
              type="button"
              key={day}
              className={`meztli-calendar-cell ${isSelected ? 'selected' : ''} ${isStart ? 'range-start' : ''} ${isEnd ? 'range-end' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => handleDayClick(day)}
            >
              <span>{day}</span>
            </button>
          );
        })}
      </div>

      <div className="meztli-calendar-summary">
        <div className="meztli-calendar-badge">
          <CalendarDays size={14} aria-hidden="true" />
          <span>Vigencia en calendario: <strong>{totalDays} {totalDays === 1 ? 'día' : 'días'}</strong> ({startDate} al {endDate})</span>
        </div>
      </div>
    </div>
  );
}

function MeztliDerechohabientesSubmodule({ demo, notify, user, canSupervise }) {
  const state = useListState('meztli-derechohabientes');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  // Modals
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [attendingTicket, setAttendingTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [followUpError, setFollowUpError] = useState('');
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [reportingTicket, setReportingTicket] = useState(null);
  const [problemMessage, setProblemMessage] = useState('');
  const [problemError, setProblemError] = useState('');
  const [problemBusy, setProblemBusy] = useState(false);

  // Form states for creating new ticket
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [patientName, setPatientName] = useState('');
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(() => addDaysToDate(todayStr, 2));
  const [department, setDepartment] = useState('Trabajo Social');
  const [customDepartment, setCustomDepartment] = useState('');
  const [roomBed, setRoomBed] = useState('');
  const [notes, setNotes] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // Attend modal states
  const [attendStatus, setAttendStatus] = useState('attended');
  const [attendNotes, setAttendNotes] = useState('');
  const [attendBusy, setAttendBusy] = useState(false);

  // Atender es una facultad técnica, definida por el submódulo Supervisión.
  // El rol por sí solo nunca debe elevar privilegios.
  const canAttend = Boolean(canSupervise);

  useEffect(() => {
    if (demo) {
      setTickets([
        {
          id: 'dh-demo-1',
          folio: 'DH-2026-0001',
          patient_name: 'María Elena Morales Gómez',
          start_date: '2026-10-07',
          end_date: '2026-10-10',
          entry_time: '08:00',
          exit_time: '18:00',
          department: 'Trabajo Social',
          room_bed: 'Cama 204 (Hospitalización)',
          notes: 'Paciente requiere conectividad temporal para teleconsulta con médicos familiares y seguimiento clínico.',
          requested_by: 'Lic. Silvia Cruz (Trabajo Social)',
          status: 'pending',
          attended_by: '',
          attended_at: null,
          response_notes: '',
          created_at: Math.floor(Date.now() / 1000) - 3600 * 3,
        },
        {
          id: 'dh-demo-2',
          folio: 'DH-2026-0002',
          patient_name: 'Roberto Carlos Hernández Ramos',
          start_date: '2026-10-06',
          end_date: '2026-10-08',
          entry_time: '07:30',
          exit_time: '15:00',
          department: 'Admisión / Urgencias',
          room_bed: 'Observación Urgencias Cama 08',
          notes: 'Alta temporal de acompañante para comunicación de estatus médico.',
          requested_by: 'Lic. Fernando Soto (Admisión)',
          status: 'attended',
          attended_by: 'operador.redes',
          attended_at: Math.floor(Date.now() / 1000) - 3600 * 20,
          response_notes: 'Alta autorizada en SSID-Meztli. Vigencia configurada hasta el 08/10.',
          created_at: Math.floor(Date.now() / 1000) - 3600 * 24,
        },
        {
          id: 'dh-demo-3',
          folio: 'DH-2026-0003',
          patient_name: 'Guadalupe Estrada Ruiz',
          start_date: '2026-10-05',
          end_date: '2026-10-12',
          entry_time: '09:00',
          exit_time: '20:00',
          department: 'Oncología Médica',
          room_bed: 'Habitación 312',
          notes: 'Paciente en tratamiento prolongado, requiere conexión estable para equipo de monitoreo personal.',
          requested_by: 'Dra. Laura Jiménez (Oncología)',
          status: 'in_progress',
          attended_by: 'admin.demo',
          attended_at: null,
          response_notes: 'En revisión de cobertura de AP Meztli en el área de hospitalización.',
          created_at: Math.floor(Date.now() / 1000) - 3600 * 48,
        },
      ]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError('');

    request('/api/meztli/derechohabientes', { signal: controller.signal })
      .then(res => {
        if (alive && res?.items) {
          setTickets(res.items);
        }
      })
      .catch(err => {
        if (alive && err.name !== 'AbortError') {
          setError(err.message || 'No se pudieron consultar las altas de derechohabientes.');
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [demo, revision]);

  useEffect(() => {
    if (!selectedTicket) {
      setMessages([]);
      setFollowUp('');
      setFollowUpError('');
      return;
    }
    if (demo) {
      setMessages(selectedTicket.status === 'attended' ? [{
        id: `message-${selectedTicket.id}`,
        body: 'El acceso fue habilitado. Si se pierde la conexión, responde aquí para que NOC vuelva a atender el caso.',
        author_name: 'NOC / TI',
        created_at: selectedTicket.updated_at || selectedTicket.created_at,
      }] : []);
      return;
    }
    const controller = new AbortController();
    setMessagesLoading(true);
    request(`/api/meztli/derechohabientes/${encodeURIComponent(selectedTicket.id)}/messages`, { signal: controller.signal })
      .then(result => setMessages(Array.isArray(result?.items) ? result.items : []))
      .catch(error => { if (error.name !== 'AbortError') setFollowUpError('No se pudo cargar el seguimiento del ticket.'); })
      .finally(() => setMessagesLoading(false));
    return () => controller.abort();
  }, [demo, selectedTicket?.id]);

  const handleCreateSubmit = async e => {
    e.preventDefault();
    setFormError('');
    if (patientName.trim().length < 3) {
      setFormError('Escribe el nombre completo del paciente (mínimo 3 letras).');
      return;
    }
    if (!startDate || !endDate) {
      setFormError('Indica la fecha de inicio y de fin.');
      return;
    }
    if (endDate < startDate) {
      setFormError('La fecha de salida no puede ser anterior a la de ingreso.');
      return;
    }
    const effectiveDept = department === 'Otro' ? customDepartment.trim() : department;
    const payload = {
      patient_name: patientName.trim(),
      start_date: startDate,
      end_date: endDate,
      department: effectiveDept,
      room_bed: roomBed.trim(),
      notes: notes.trim(),
    };

    setFormBusy(true);
    try {
      if (demo) {
        const newTicket = {
          ...payload,
          id: `dh-demo-${Date.now()}`,
          folio: `DH-2026-${String(tickets.length + 1).padStart(4, '0')}`,
          status: 'pending',
          attended_by: '',
          attended_at: null,
          response_notes: '',
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        };
        setTickets(prev => [newTicket, ...prev]);
        notify?.(`Alta de paciente registrada con folio ${newTicket.folio} (modo demostración).`);
      } else {
        const res = await request('/api/meztli/derechohabientes', { body: payload });
        if (res?.item) {
          setTickets(prev => [res.item, ...prev]);
        } else {
          setRevision(r => r + 1);
        }
        notify?.('Solicitud de alta de derechohabiente registrada y enviada a TI/NOC.');
      }
      setIsCreating(false);
      setPatientName('');
      setNotes('');
      setRoomBed('');
    } catch (err) {
      setFormError(err.message || 'No se pudo guardar la solicitud.');
    } finally {
      setFormBusy(false);
    }
  };

  const handleAttendSubmit = async e => {
    e.preventDefault();
    if (!attendingTicket) return;
    setAttendBusy(true);
    try {
      if (demo) {
        const updated = {
          ...attendingTicket,
          status: attendStatus,
          attended_by: user?.name || user?.username || 'operador',
          attended_at: Math.floor(Date.now() / 1000),
          response_notes: attendNotes.trim(),
          updated_at: Math.floor(Date.now() / 1000),
        };
        setTickets(prev => prev.map(t => t.id === attendingTicket.id ? updated : t));
        notify?.(`Ticket ${attendingTicket.folio} actualizado como ${attendStatus === 'attended' ? 'Atendido' : attendStatus === 'in_progress' ? 'En atención' : 'Cancelado'}.`);
      } else {
        const res = await request('/api/meztli/derechohabientes/status', {
          body: {
            id: attendingTicket.id,
            status: attendStatus,
            response_notes: attendNotes.trim(),
          }
        });
        if (res?.item) {
          setTickets(prev => prev.map(t => t.id === attendingTicket.id ? res.item : t));
        } else {
          setRevision(r => r + 1);
        }
        notify?.(`Ticket ${attendingTicket.folio} actualizado exitosamente.`);
      }
      setAttendingTicket(null);
      setAttendNotes('');
    } catch (err) {
      notify?.(`Error al actualizar ticket: ${err.message}`);
    } finally {
      setAttendBusy(false);
    }
  };

  const sendFollowUp = async (ticket, message) => {
    if (demo) {
        const savedMessage = {
          id: `message-${Date.now()}`,
          body: message.trim(),
          author_name: user?.name || user?.username || 'Solicitante',
          created_at: Math.floor(Date.now() / 1000),
        };
        return { message: savedMessage, item: { ...ticket, status: 'pending', updated_at: savedMessage.created_at } };
    }
    return request('/api/meztli/derechohabientes/messages', {
      body: { id: ticket.id, message: message.trim() },
    });
  };

  const applyFollowUp = result => {
      setMessages(previous => [...previous, result.message]);
      setTickets(previous => previous.map(ticket => ticket.id === result.item.id ? result.item : ticket));
      setSelectedTicket(current => current?.id === result.item.id ? result.item : current);
  };

  const submitFollowUp = async () => {
    if (!selectedTicket || followUp.trim().length < 3) {
      setFollowUpError('Describe la desconexión o el seguimiento requerido.');
      return;
    }
    setFollowUpBusy(true);
    setFollowUpError('');
    try {
      const result = await sendFollowUp(selectedTicket, followUp);
      applyFollowUp(result);
      setFollowUp('');
      notify?.(`Seguimiento enviado. El ticket ${result.item.folio} volvió a Pendiente para NOC.`);
    } catch (error) {
      setFollowUpError(error.message || 'No se pudo enviar el seguimiento.');
    } finally {
      setFollowUpBusy(false);
    }
  };

  const submitProblemReport = async event => {
    event.preventDefault();
    if (!reportingTicket || problemMessage.trim().length < 3) {
      setProblemError('Describe la desconexión o el problema de conectividad.');
      return;
    }
    setProblemBusy(true);
    setProblemError('');
    try {
      const result = await sendFollowUp(reportingTicket, problemMessage);
      applyFollowUp(result);
      setReportingTicket(null);
      setProblemMessage('');
      notify?.(`Problema notificado. El ticket ${result.item.folio} volvió a Pendiente para TI / NOC.`);
    } catch (error) {
      setProblemError(error.message || 'No se pudo enviar el reporte.');
    } finally {
      setProblemBusy(false);
    }
  };

  const statusLabel = s => {
    if (s === 'attended') return 'Atendido';
    if (s === 'in_progress') return 'En atención';
    if (s === 'cancelled') return 'Cancelado';
    return 'Pendiente';
  };

  const activeTickets = tickets.filter(ticket => ['pending', 'in_progress', 'attended'].includes(ticket.status));
  const pendingCount = activeTickets.filter(t => t.status === 'pending').length;
  const inProgressCount = activeTickets.filter(t => t.status === 'in_progress').length;

  const columns = [
    {
      key: 'folio',
      label: 'Folio',
      render: r => <span className="network-tag font-mono font-semibold">{r.folio}</span>,
    },
    {
      key: 'patient',
      label: 'Paciente derechohabiente',
      render: r => (
        <div className="cell-detail">
          <strong>{r.patient_name}</strong>
          <small>{[r.department, r.room_bed].filter(Boolean).join(' · ')}</small>
        </div>
      ),
    },
    {
      key: 'dates',
      label: 'Período y vigencia',
      render: r => (
        <div className="cell-detail">
          <strong>{r.start_date} al {r.end_date}</strong>
          <small className="meztli-dh-duration-tag">
            <Clock size={11} aria-hidden="true" /> {getDaysDifference(r.start_date, r.end_date)} días vigentes
          </small>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Estado',
      render: r => (
        <Badge status={r.status === 'attended' ? 'online' : r.status === 'in_progress' ? 'warning' : r.status === 'pending' ? 'pending' : 'offline'}>
          {statusLabel(r.status)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Acciones',
      sortable: false,
      render: r => (
        <div className="meztli-ticket-actions">
          <Button icon={Eye} onClick={() => setSelectedTicket(r)}>
            Detalle
          </Button>
          {!canAttend && (
            <Button
              className="meztli-report-problem"
              icon={MessageSquare}
              onClick={() => {
                setProblemError('');
                setProblemMessage('');
                setReportingTicket(r);
              }}
            >
              Notificar problema
            </Button>
          )}
          {canAttend && (
            <Button
              variant={r.status === 'pending' ? 'primary' : 'secondary'}
              icon={CheckCircle2}
              onClick={() => {
                setAttendingTicket(r);
                setAttendStatus(r.status === 'pending' ? 'attended' : r.status);
                setAttendNotes(r.response_notes || 'Acceso a red SSID-Meztli autorizado conforme a vigencia.');
              }}
            >
              Atender
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeading
        eyebrow="Gestión Meztli · Módulo para Áreas Externas"
        title="Alta Derechohabientes"
        description="Registro y tickets directos de pacientes para alta de conectividad en la red inalámbrica Meztli."
      />

      <section className="metric-grid meztli-metrics meztli-dh-metrics">
        <Metric
          icon={Clock3}
          tone="warning"
          label="Pendientes de atención"
          value={number(pendingCount)}
          caption={pendingCount ? 'tickets directos sin procesar' : 'sin tickets directos por atender'}
        />
        <Metric
          icon={Radio}
          tone="info"
          label="En atención técnica"
          value={number(inProgressCount)}
          caption="en revisión de cobertura o acceso"
        />
        <aside className="meztli-new-request" aria-label="Nueva solicitud">
          <span>Gestión de acceso</span>
          <strong>¿Nuevo paciente?</strong>
          <small>Registra una alta directa para que TI / NOC la atienda.</small>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setFormError('');
              setIsCreating(true);
            }}
          >
            Nueva alta
          </Button>
        </aside>
      </section>

      <DataTable
        title="Solicitudes y tickets de derechohabientes"
        className="meztli-dh-table"
        rows={activeTickets}
        columns={columns}
        state={state}
        pageSize={20}
        noun="solicitudes de alta"
        loading={loading}
        error={error}
        onRetry={() => setRevision(r => r + 1)}
        rowClassName={ticket => ticket.status === 'pending' ? 'meztli-ticket-pending' : ''}
        toolbar={
          <div className="toolbar meztli-table-toolbar">
            <SearchField
              value={state.query}
              onChange={state.setQuery}
              placeholder="Buscar por paciente, folio o área…"
            />
          </div>
        }
        emptyText={activeTickets.length === 0 ? 'No hay solicitudes activas de derechohabientes.' : 'No se encontraron solicitudes activas con esa búsqueda.'}
      />

      {/* Modal: Crear nueva alta */}
      <Dialog
        open={isCreating}
        onClose={() => !formBusy && setIsCreating(false)}
        title="Nueva alta de derechohabiente (Ticket directo a TI/NOC)"
        wide
      >
        <form className="meztli-dh-create-form" noValidate onSubmit={handleCreateSubmit}>
          {formError && <Notice title="Revisa los campos" tone="danger">{formError}</Notice>}

          <div className="form-grid">
            <div className="col-span-full">
              <Field label="Nombre completo del paciente" required>
                <input
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  placeholder="Ej. María Elena Morales Gómez"
                  required
                  autoFocus
                />
              </Field>
            </div>

            <Field label="Departamento solicitante" required>
              <select value={department} onChange={e => setDepartment(e.target.value)}>
                <option value="Trabajo Social">Trabajo Social</option>
                <option value="Admisión / Urgencias">Admisión / Urgencias</option>
                <option value="Hospitalización">Hospitalización</option>
                <option value="Medicina Interna">Medicina Interna</option>
                <option value="Oncología Médica">Oncología Médica</option>
                <option value="Pediatría">Pediatría</option>
                <option value="Consulta Externa">Consulta Externa</option>
                <option value="Otro">Otro (especificar)</option>
              </select>
            </Field>

            {department === 'Otro' ? (
              <Field label="Especificar área / servicio" required>
                <input
                  value={customDepartment}
                  onChange={e => setCustomDepartment(e.target.value)}
                  placeholder="Ej. Cardiología"
                  required
                />
              </Field>
            ) : (
              <Field label="Cama / Habitación / Ubicación">
                <input
                  value={roomBed}
                  onChange={e => setRoomBed(e.target.value)}
                  placeholder="Ej. Cama 204 o Pabellón B"
                />
              </Field>
            )}

            <div className="col-span-full meztli-dh-stay">
              <h4 style={{ margin: '4px 0 7px', fontSize: '13px', fontWeight: 650 }}>
                Período de estancia y vigencia (Calendario)
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '6px' }}>
                <Field label="Fecha de inicio (De qué día)" required>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Fecha de término (A qué día)" required>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    required
                  />
                </Field>
              </div>

            </div>

            <div className="col-span-full meztli-dh-bottom-layout">
              <div className="meztli-dh-calendar-column">
                <DateRangeCalendarPicker
                  startDate={startDate}
                  endDate={endDate}
                  onSelectRange={(start, end) => {
                    setStartDate(start);
                    setEndDate(end);
                  }}
                />
              </div>
              <div className="meztli-dh-notes-column">
                <Field label="Mensaje directo / Observaciones para TI y Redes">
                  <textarea
                    rows={1}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Ej. Paciente en estancia programada requiere acceso para expediente familiar y teleconsulta..."
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: '12px' }}>
            <Button disabled={formBusy} onClick={() => setIsCreating(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" icon={Send} busy={formBusy}>
              Enviar solicitud de alta
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Modal: Atender ticket */}
      <Dialog
        open={Boolean(attendingTicket)}
        onClose={() => !attendBusy && setAttendingTicket(null)}
        title={attendingTicket ? `Atender solicitud ${attendingTicket.folio}` : 'Atender solicitud'}
      >
        {attendingTicket && (
          <form noValidate onSubmit={handleAttendSubmit}>
            <Notice title={`Paciente: ${attendingTicket.patient_name}`} tone="info">
              Área: <strong>{attendingTicket.department}</strong> {attendingTicket.room_bed ? `(${attendingTicket.room_bed})` : ''} · Vigencia: <strong>{attendingTicket.start_date} al {attendingTicket.end_date}</strong>
            </Notice>

            {attendingTicket.notes && (
              <div style={{ margin: '14px 0', padding: '12px', background: 'var(--surface-muted)', borderRadius: '8px', fontSize: '13px' }}>
                <strong style={{ display: 'block', marginBottom: '4px' }}>Mensaje del solicitante:</strong>
                <span>{attendingTicket.notes}</span>
              </div>
            )}

            <div className="form-grid">
              <div className="col-span-full">
                <Field label="Estado de atención a asignar" required>
                  <select value={attendStatus} onChange={e => setAttendStatus(e.target.value)}>
                    <option value="attended">Atendido (Acceso habilitado en red Meztli)</option>
                    <option value="in_progress">En atención técnica (Revisando cobertura)</option>
                    <option value="pending">Dejar como Pendiente</option>
                  </select>
                </Field>
              </div>

              <div className="col-span-full">
                <Field label="Nota de respuesta técnica para el solicitante" hint="Este mensaje quedará registrado en la bitácora del ticket.">
                  <textarea
                    rows={3}
                    value={attendNotes}
                    onChange={e => setAttendNotes(e.target.value)}
                    placeholder="Ej. Conexión autorizada en red inalámbrica Meztli. Vigencia configurada."
                  />
                </Field>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: '20px' }}>
              <Button disabled={attendBusy} onClick={() => setAttendingTicket(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" icon={CheckCircle2} busy={attendBusy}>
                Guardar atención de ticket
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Modal: Detalle de ticket */}
      <Dialog
        open={Boolean(selectedTicket)}
        onClose={() => setSelectedTicket(null)}
        title={selectedTicket ? `Ficha de Alta · ${selectedTicket.folio}` : 'Detalle'}
      >
        {selectedTicket && (
          <div className="detail-grid">
            <div className="cell-detail">
              <small>Folio Institucional</small>
              <strong className="font-mono">{selectedTicket.folio}</strong>
            </div>
            <div className="cell-detail">
              <small>Estado</small>
              <Badge status={selectedTicket.status === 'attended' ? 'online' : selectedTicket.status === 'in_progress' ? 'warning' : selectedTicket.status === 'pending' ? 'review' : 'offline'}>
                {statusLabel(selectedTicket.status)}
              </Badge>
            </div>
            <div className="cell-detail">
              <small>Paciente Derechohabiente</small>
              <strong>{selectedTicket.patient_name}</strong>
            </div>
            <div className="cell-detail">
              <small>Departamento / Servicio</small>
              <strong>{[selectedTicket.department, selectedTicket.room_bed].filter(Boolean).join(' · ')}</strong>
            </div>
            <div className="cell-detail">
              <small>Vigencia (Calendario)</small>
              <strong>{selectedTicket.start_date} al {selectedTicket.end_date} ({getDaysDifference(selectedTicket.start_date, selectedTicket.end_date)} días)</strong>
            </div>
            <div className="cell-detail">
              <small>Fecha de solicitud</small>
              <span>{selectedTicket.created_at ? dateTime(new Date(selectedTicket.created_at * 1000).toISOString()) : 'Reciente'}</span>
            </div>

            {selectedTicket.notes && (
              <div className="col-span-full" style={{ padding: '10px', background: 'var(--surface-muted)', borderRadius: '6px' }}>
                <small className="text-muted" style={{ display: 'block', marginBottom: '3px' }}>Mensaje directo del solicitante:</small>
                <p style={{ margin: 0, fontSize: '13px' }}>{selectedTicket.notes}</p>
              </div>
            )}

            <section className="meztli-ticket-thread col-span-full" aria-label="Seguimiento del ticket">
              <div className="meztli-ticket-thread-heading">
                <div>
                  <small>CONVERSACIÓN OPERATIVA</small>
                  <h3>Seguimiento con TI / NOC</h3>
                </div>
                <span>{selectedTicket.status === 'pending' ? 'Requiere atención' : 'Puedes reportar una nueva desconexión'}</span>
              </div>
              {messagesLoading ? <p className="text-muted text-sm">Cargando seguimiento…</p> : (
                <div className="meztli-ticket-messages">
                  {messages.length ? messages.map(message => (
                    <article key={message.id} className="meztli-ticket-message">
                      <strong>{message.author_name}</strong>
                      <p>{message.body}</p>
                      <small>{message.created_at ? dateTime(new Date(message.created_at * 1000).toISOString()) : 'Ahora'}</small>
                    </article>
                  )) : <p className="text-muted text-sm">Aún no hay mensajes. Reporta aquí si el acceso se vuelve a desconectar.</p>}
                </div>
              )}
              <label className="meztli-followup-field">
                <span>Reportar nueva desconexión o solicitar seguimiento</span>
                <textarea
                  rows={2}
                  value={followUp}
                  onChange={event => setFollowUp(event.target.value)}
                  placeholder="Ej. El paciente se desconectó de la red Meztli y requiere una nueva revisión en la habitación."
                  disabled={selectedTicket.status === 'cancelled' || followUpBusy}
                />
              </label>
              {followUpError && <p className="field-error">{followUpError}</p>}
              <Button
                variant="primary"
                icon={Send}
                busy={followUpBusy}
                disabled={selectedTicket.status === 'cancelled'}
                onClick={submitFollowUp}
              >
                Enviar a TI / NOC y reabrir ticket
              </Button>
            </section>

            {selectedTicket.attended_by && (
              <div className="col-span-full" style={{ padding: '10px', background: 'var(--surface-muted)', borderRadius: '6px', borderLeft: '3px solid var(--color-success, #10b981)' }}>
                <small className="text-muted" style={{ display: 'block', marginBottom: '3px' }}>
                  Atendido por <strong>{selectedTicket.attended_by}</strong> {selectedTicket.attended_at ? `el ${dateTime(new Date(selectedTicket.attended_at * 1000).toISOString())}` : ''}:
                </small>
                <p style={{ margin: 0, fontSize: '13px' }}>{selectedTicket.response_notes || 'Acceso procesado y autorizado.'}</p>
              </div>
            )}

            <div className="form-actions col-span-full" style={{ marginTop: '14px' }}>
              <Button onClick={() => setSelectedTicket(null)}>Cerrar</Button>
              {canAttend && selectedTicket.status !== 'attended' && (
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  onClick={() => {
                    setAttendingTicket(selectedTicket);
                    setAttendStatus('attended');
                    setAttendNotes(selectedTicket.response_notes || 'Acceso a red SSID-Meztli autorizado.');
                    setSelectedTicket(null);
                  }}
                >
                  Atender solicitud
                </Button>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(reportingTicket)}
        onClose={() => !problemBusy && setReportingTicket(null)}
        title="Notificar problema de conexión"
      >
        {reportingTicket && (
          <form className="meztli-problem-form" noValidate onSubmit={submitProblemReport}>
            <div className="meztli-problem-ticket">
              <MessageSquare size={21} aria-hidden="true" />
              <div>
                <strong>{reportingTicket.patient_name}</strong>
                <span>{reportingTicket.folio} · Describe el problema para TI / NOC.</span>
              </div>
            </div>
            <Field label="¿Qué ocurrió con la conexión?" required error={problemError}>
              <textarea
                rows={5}
                autoFocus
                value={problemMessage}
                onChange={event => setProblemMessage(event.target.value)}
                placeholder="Ej. El paciente se desconectó de la red Meztli y requiere una nueva revisión en la habitación."
                disabled={problemBusy}
              />
            </Field>
            <div className="form-actions meztli-problem-actions">
              <Button disabled={problemBusy} onClick={() => setReportingTicket(null)}>Cancelar</Button>
              <Button type="submit" variant="primary" icon={Send} busy={problemBusy}>Enviar a TI / NOC</Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

export function MeztliManagement({ data, openEditor, loading, errors, refresh, canExport, notify, demo }) {
  const { canViewSubmodule, user } = useSession() || {};
  const canSupervise = canViewSubmodule ? canViewSubmodule('gestion-meztli', 'supervision') : true;
  const canDerechohabientes = canViewSubmodule ? canViewSubmodule('gestion-meztli', 'derechohabientes') : true;

  const [activeTab, setActiveTab] = useState(() => (!canSupervise && canDerechohabientes ? 'derechohabientes' : 'supervision'));

  const currentTab = !canSupervise && canDerechohabientes
    ? 'derechohabientes'
    : (canSupervise && !canDerechohabientes ? 'supervision' : activeTab);

  const state = useListState('gestion-meztli');
  const [admissionFilter, setAdmissionFilter] = useState('all');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState('');
  const directLeases = Array.isArray(data.meztliLeases) ? data.meztliLeases : [];
  const meztliSegment = data.segments.find(segment => normalizeText(`${segment.name || ''} ${segment.interface || ''} ${segment.vlan || ''}`).includes('meztli') || /\b94\b/.test(String(segment.vlan || '')));
  const looksLikeMeztli = device => normalizeText([device.interface, device.vlan, device.ssid, device.network, device.omnivista?.ssid, device.omnivista?.profile].filter(Boolean).join(' ')).includes('meztli') || /\b94\b/.test(String(device.vlan || ''));
  const belongsToMeztli = device => (meztliSegment && deviceInSegment(device, meztliSegment)) || looksLikeMeztli(device);
  const meztliDevices = data.devices.filter(belongsToMeztli);
  const directMeztliLeases = directLeases.filter(lease => normalizeText(lease.interface).includes('meztli'));

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
    {canSupervise && canDerechohabientes && (
      <nav className="inventory-tabs meztli-tabs" role="tablist" aria-label="Secciones de Gestión Meztli">
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === 'supervision'}
          className={currentTab === 'supervision' ? 'active' : ''}
          onClick={() => setActiveTab('supervision')}
        >
          <Wifi size={15} aria-hidden="true" />
          Supervisión de conexiones ({number(connected.length)})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === 'derechohabientes'}
          className={currentTab === 'derechohabientes' ? 'active' : ''}
          onClick={() => setActiveTab('derechohabientes')}
        >
          <Users size={15} aria-hidden="true" />
          Alta derechohabientes
        </button>
      </nav>
    )}

    {currentTab === 'derechohabientes' ? (
      <MeztliDerechohabientesSubmodule
        demo={demo}
        notify={notify}
        user={user}
        canSupervise={canSupervise}
      />
    ) : (
      <>
        <PageHeading eyebrow="Supervisión de red inalámbrica" title="Gestión Meztli" description="Dispositivos conectados a Meztli sin reserva DHCP" updatedAt={data.updatedAt} />
        {unmanaged.length > 0 && <Notice title="Aviso: conexiones no admitidas detectadas">Hay <strong>{number(unmanaged.length)} dispositivo{unmanaged.length === 1 ? '' : 's'}</strong> conectado{unmanaged.length === 1 ? '' : 's'} a <strong>SSID-Meztli</strong> sin reserva DHCP. Revísalos antes de realizar una acción en la red.</Notice>}
        <section className="metric-grid meztli-metrics meztli-supervision-metrics"><Metric icon={Wifi} label="Conectados a Meztli" value={number(connected.length)} caption="actividad detectada en este momento" /><Metric icon={ShieldCheck} tone="success" label="Con reserva DHCP" value={number(reserved.length)} caption="autorizados para permanecer conectados" ><span className="meztli-reservation-mark"><ShieldCheck size={12} /> Reserva activa</span></Metric><Metric icon={TriangleAlert} tone="danger" label="No deberían estar conectados" value={number(unmanaged.length)} caption="sin reserva DHCP · requieren revisión" /></section>
        <DataTable title="Conexiones de SSID-Meztli" rows={rows} columns={columns} state={state} pageSize={25} noun={admissionFilter === 'not-admitted' ? 'dispositivos por revisar' : 'dispositivos'} toolbar={<div className="toolbar meztli-table-toolbar"><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar dispositivo, IP o MAC…" /><Select label="Admisión" value={admissionFilter} onChange={event => setAdmissionFilter(event.target.value)}><option value="not-admitted">No admitidos</option><option value="admitted">Admitidos (reserva DHCP)</option><option value="all">Todos</option></Select><Select label="Tipo de dispositivo" value={deviceTypeFilter} onChange={event => setDeviceTypeFilter(event.target.value)}><option value="">Todos los tipos</option>{options(allRows.map(row => row.deviceType))}</Select></div>} exportable={canExport} loading={loading} error={errors.meztliLeases || errors.devices} onRetry={refresh} onRowClick={row => openEditor('device-detail', row)} emptyText={connected.length ? admissionFilter === 'not-admitted' ? 'Todos los dispositivos conectados a Meztli tienen una reserva DHCP.' : 'No hay dispositivos que coincidan con los filtros seleccionados.' : 'FortiGate no devolvió concesiones DHCP activas para SSID-Meztli.'} />
        <Note title="Alcance de Gestión Meztli">La vista es de supervisión: no modifica reservas DHCP ni desconecta equipos. Abre un registro para revisar sus datos técnicos antes de realizar cualquier acción en la red.</Note>
      </>
    )}
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
}) {
  const state = useListState(idfView ? 'reportes-idf' : 'bitacora');
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => {
    if (filterIdf) {
      state.setFilter('idf', filterIdf);
    }
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
        <div className="audit-cell-group">
          <span className="audit-idf-tag">
            <Building2 size={13} aria-hidden="true" />
            <b>{r.idf || 'IDF'}</b>
          </span>
          <span className="audit-folio-pill" title={r.id}>
            {r.id}
          </span>
          {r.device && <small className="audit-device-subtext">{r.device}</small>}
        </div>
      ),
    },
    {
      key: 'title',
      label: 'Actividad e incidencia',
      value: r => `${r.title || ''} ${r.description || ''}`,
      render: r => (
        <div className="audit-activity-content">
          <strong>{r.title || 'Inspección técnica'}</strong>
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
                <Thermometer size={12} aria-hidden="true" />
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
                  openEditor('report-detail', r);
                }}
                title="Ver fotografía adjunta"
              >
                <Camera size={12} aria-hidden="true" />
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
            onClick={() => openEditor('report-detail', r)}
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
      {!idfView && (
        <PageHeading
          eyebrow="Trazabilidad operativa · Cuartos de telecomunicaciones"
          title="Bitácora de Visitas e Incidencias en IDF"
          description="Historial de inspecciones, bitácora de visitas técnicas, telemetría y resolución de incidencias en IDFs"
          updatedAt={data.updatedAt}
        />
      )}



      {!idfView && (
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
        title={idfView ? 'Reportes enviados desde móvil' : 'Bitácora institucional de visitas a IDFs'}
        className="audit-table"
        rows={enrichedRecords}
        rowKey="key"
        columns={columns}
        state={state}
        noun="registros"
        exportable={false}
        loading={loading}
        error={errors.reports || errors.idfs}
        onRetry={refresh}
        onRowClick={row => openEditor('report-detail', row)}
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
  const [pageSizeChoice, setPageSizeChoice] = useState('25');
  const [currentPage, setCurrentPage] = useState(1);

  const segmentDevices = getOverviewSegmentDevices(devices, segment);
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
          <span className="network-tag">{isMeztliSegment(segment) ? `${number(segmentDevices.length)} clientes DHCP` : `${number(segmentDevices.length)} dispositivos (${number(onlineCount)} en línea)`}</span>
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

export function SupportDashboard({ data, navigate, openEditor, loading, errors, refresh }) {
  const [networkQuery, setNetworkQuery] = useState('');
  const [computerQuery, setComputerQuery] = useState('');
  const [printerQuery, setPrinterQuery] = useState('');
  const [computerSort, setComputerSort] = useState('standard');

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
          <Button icon={RefreshCw} busy={loading} onClick={refresh}>Actualizar</Button>
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
                        <span className="support-uptime-badge" title={`Tiempo continuo conectado: ${formatUptime(pc.uptime_seconds)}`}>
                          <Clock size={12} aria-hidden="true" />
                          <span>Conectado: {formatUptime(pc.uptime_seconds)}</span>
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
        <Badge tone={r.categoryTone}>
          {r.categoryLabel}
        </Badge>
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

      <section className="audit-kpi-grid" aria-label="Indicadores globales de la bitácora">
        {auditKpis.map(({ id, label, value, caption, icon: Icon, tone, pct, isActive, onClick }) => (
          <button
            key={id}
            type="button"
            className={`audit-kpi audit-kpi-${tone} ${isActive ? 'is-active' : ''}`}
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
