import { QUERY_TIMEOUT_MS } from './query-policy.mjs';
import React, { Children, useEffect, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ArrowRight, Building2, Camera, Check, CheckCircle2, CircleAlert, Clock3, EyeOff, FileText, Layers3, LayoutDashboard, Monitor, Network, Package, Plus, RefreshCw, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Wifi } from 'lucide-react';
import { Button, Empty, IconButton, Loading, Notice, SearchField } from './components.jsx';
import { dateTime, formatDeviceType, number, reportsFromData, request } from './domain.mjs';
import { useSession } from './session.jsx';
import { DEFAULT_WIDGET_LAYOUT, WIDGET_CATALOG, WIDGET_SIZES, expiringConcessions, networkPressure, sanitizeWidgetLayout, widgetAllowed } from './widgets-domain.mjs';

const WIDGET_VISUALS = {
  Dashboard: [Network, 'brand'], Dispositivos: [Monitor, 'blue'], 'Direcciones IP': [Layers3, 'teal'],
  'Registro IDF': [Building2, 'amber'], Bitácora: [FileText, 'purple'], FortiGate: [ShieldCheck, 'teal'],
  'Gestión de altas': [Clock3, 'amber'], 'Access Points': [Wifi, 'blue'], CCTV: [Camera, 'purple'], Soporte: [Package, 'brand'],
};

function WidgetWarning({ error, onRetry }) {
  return <div className="widget-warning" role="status">
    <CircleAlert size={15} aria-hidden="true" />
    <span title={error}>Actualización pendiente<span className="sr-only">: {error}. Los datos pueden estar desactualizados.</span></span>
    <button type="button" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" />Reintentar</button>
  </div>;
}

function Distribution({ values, label }) {
  const total = values.reduce((sum, item) => sum + item.value, 0);
  if (!total) return null;
  let position = 0;
  const gradient = values.filter(item => item.value > 0).map(item => {
    const start = position;
    position += item.value / total * 100;
    return `${item.color} ${start}% ${position}%`;
  }).join(',');
  return <div className="widget-distribution"><div className="widget-donut" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label={`${label}: ${values.map(item => `${item.label} ${number(item.value)}`).join(', ')}`}><div><strong>{number(total)}</strong><small>{label}</small></div></div><ul>{values.map(item => <li key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{number(item.value)}</strong></li>)}</ul></div>;
}

function BarRows({ rows, empty }) {
  return rows.length ? <ul className="widget-bar-rows">{rows.slice(0, 5).map(row => <li key={row.id}><div><strong>{row.title}</strong><span>{row.value}</span></div><div className="widget-bar-track"><i style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></div><small>{row.subtitle}</small></li>)}</ul> : <p className="widget-empty">{empty}</p>;
}

const REMOTE = {
  forti: '/api/forti/system/resources', expiring: '/api/altas/omnivista', aps: '/api/aps/omnivista',
  cctv: '/api/inventory/catalog', stock: '/api/support/inventory', 'support-log': '/api/support/movements',
};
const demoResponse = (id, data) => ({
  forti: { success: true, data: { cpu_percent: 18, memory_percent: 43, session_count: 1284 } },
  expiring: { success: true, data: { users: [{ username: 'ana.ejemplo', fullName: 'Ana · Ejemplo', description: 'Oficio', dateOfEffective: Date.now() + 4 * 3600000 }] } },
  aps: { aps: data.aps || [] },
  cctv: { assets: [{ id: 'demo-camera', dataset: 'cctv', issues: [], decommissioned: false }] },
  stock: { items: [{ id: 'toner', description: 'Tóner de ejemplo', quantity: 2, unit: 'piezas' }, { id: 'cable', description: 'Cable de ejemplo', quantity: 0, unit: 'piezas' }] },
  'support-log': { movements: [{ id: 'example', element: 'Tóner de ejemplo', quantity: 1, actor_name: 'Soporte · Ejemplo', date: new Date().toISOString() }] },
}[id]);

function useWidgetQuery(id, demo, data) {
  const path = REMOTE[id];
  const demoAps = demo ? data.aps : null;
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState({ value: null, loading: Boolean(path), error: '', updatedAt: null });
  useEffect(() => {
    if (!path) return;
    if (demo) { setSnapshot({ value: demoResponse(id, data), loading: false, error: '', updatedAt: new Date().toISOString() }); return; }
    let alive = true;
    let controller;
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
      setSnapshot(old => ({ ...old, loading: true, error: '' }));
      try {
        const value = await request(path, { signal: controller.signal });
        if (value?.success === false) throw new Error(value.message || 'El servicio no confirmó la consulta.');
        const collection = id === 'expiring' ? value?.data?.users : id === 'aps' ? value?.aps : id === 'cctv' ? value?.assets : id === 'stock' ? value?.items : id === 'support-log' ? value?.movements : null;
        if ((id !== 'forti' && !Array.isArray(collection)) || (id === 'forti' && (!value?.data || typeof value.data !== 'object'))) throw new Error('El servicio devolvió un formato no reconocido.');
        if (alive) setSnapshot({ value, loading: false, error: '', updatedAt: new Date().toISOString() });
      } catch (error) {
        if (alive) setSnapshot(old => ({ ...old, loading: false, error: error.name === 'AbortError' ? 'La consulta tardó demasiado.' : error.message }));
      } finally { clearTimeout(timeout); pending = false; }
    };
    load();
    return () => { alive = false; controller?.abort(); };
  }, [id, path, demo, revision, data.updatedAt]);
  return { ...snapshot, retry: () => setRevision(value => value + 1) };
}

function Numbers({ values }) {
  return <dl className="widget-numbers">{values.map(([label, value, tone]) => <div key={label}><dt>{label}</dt><dd className={tone || ''}>{value == null ? '—' : number(value)}</dd></div>)}</dl>;
}
function Rows({ rows, empty }) {
  return rows.length ? <ul className="widget-rows">{rows.slice(0, 5).map((row, index) => <li key={row.id || index}><i className="widget-row-dot" aria-hidden="true" /><div><strong>{row.title}</strong><small>{row.subtitle}</small></div>{row.value != null && <span>{row.value}</span>}</li>)}</ul> : <div className="widget-empty"><CheckCircle2 size={25} aria-hidden="true" /><p>{empty}</p></div>;
}

export function WidgetCard({ title, module, Icon, tone, loading, updatedAt, demo, onRefresh, footerAction, children, className = '', kind }) {
  return <article className={`dashboard-data-widget widget-tone-${tone} ${className}`} data-kind={kind} aria-label={title} aria-busy={loading}>
    <header><span className="widget-heading-icon"><Icon size={21} strokeWidth={1.7} aria-hidden="true" /></span><div><span className="widget-module">{module}</span><h2>{title}</h2></div>{onRefresh && <IconButton icon={RefreshCw} label={`Actualizar ${title}`} disabled={loading} onClick={onRefresh} />}</header>
    <div className="widget-data-body">{children}</div>
    <footer><small>{demo ? 'Datos de demostración' : updatedAt ? `Actualizado ${dateTime(updatedAt)}` : 'Sin actualización'}</small>{footerAction && <button type="button" onClick={footerAction.onClick}>{footerAction.label}<ArrowRight size={14} aria-hidden="true" /></button>}</footer>
  </article>;
}

function DataWidget({ id, data, loading, errors, demo, navigate, refresh }) {
  const remote = useWidgetQuery(id, demo, data);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (id !== 'expiring') return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [id]);
  const definition = WIDGET_CATALOG.find(widget => widget.id === id);
  const sharedError = ['devices', 'device-types', 'offline-devices'].includes(id) ? errors.devices : id === 'ips' ? errors.ips : ['incidents', 'recent-incidents'].includes(id) ? (errors.idfs || errors.reports) : id === 'audit' ? errors.audit : id === 'network-pressure' ? errors.segments : id === 'services' ? errors.health : '';
  const error = REMOTE[id] ? remote.error : sharedError;
  const busy = REMOTE[id] ? remote.loading : loading;
  const source = remote.value;
  let body;
  let target;
  if (id === 'devices') {
    const devices = data.devices || [];
    body = devices.length ? <Numbers values={[
      ['En línea', devices.filter(row => row.status === 'online').length, 'text-success'],
      ['Fuera de línea', devices.filter(row => row.status === 'offline').length, 'text-danger'],
      ['Sin estado', devices.filter(row => !['online', 'offline'].includes(row.status)).length],
    ]} /> : <p className="widget-empty">No se recibieron dispositivos.</p>;
    target = 'dispositivos';
  } else if (id === 'ips') {
    const ips = data.ips || [];
    body = ips.length ? <Numbers values={[
      ['Disponibles', ips.filter(row => row.status === 'available').length, 'text-success'],
      ['Ocupadas', ips.filter(row => row.status === 'occupied').length], ['Total', ips.length],
    ]} /> : <p className="widget-empty">No hay direcciones registradas.</p>;
    target = 'disponibilidad';
  } else if (id === 'incidents') {
    const records = reportsFromData(data.reports || {}, data.idfs || []).filter(row => row.status !== 'resolved');
    const groups = [...new Set(records.map(row => row.idfId))].map(idfId => ({ id: idfId, title: records.find(row => row.idfId === idfId).idf, value: records.filter(row => row.idfId === idfId).length, subtitle: 'Incidencias pendientes' })).sort((a, b) => b.value - a.value);
    body = <><p className="widget-highlight"><strong>{number(records.length)}</strong> incidencias abiertas</p><Rows rows={groups} empty="No hay incidencias abiertas en los IDF consultados." /></>;
    target = 'idf';
  } else if (id === 'audit') {
    const events = Array.isArray(data.audit) ? data.audit : [];
    body = <Rows rows={[...events].sort((a, b) => Number(b.created_at) - Number(a.created_at)).map(row => ({ id: row.id, title: row.target_label || row.action || 'Movimiento', subtitle: `${row.actor_name || row.actor || 'Sistema'} · ${dateTime(Number(row.created_at) < 1e12 ? Number(row.created_at) * 1000 : row.created_at)}` }))} empty="No hay movimientos registrados." />;
    target = 'bitacora';
  } else if (id === 'forti') {
    const metrics = source?.data || {};
    body = <><Numbers values={[
      ['CPU (%)', metrics.cpu_percent], ['Memoria (%)', metrics.memory_percent], ['Sesiones', metrics.session_count],
    ]} /><div className="widget-resource-meters">{[['CPU', metrics.cpu_percent], ['Memoria', metrics.memory_percent]].map(([label, value]) => value != null && Number.isFinite(Number(value)) ? <label key={label}><span>{label}<b>{number(value)}%</b></span><meter min="0" max="100" value={Math.max(0, Math.min(100, Number(value)))} aria-label={`${label} de FortiGate`} /></label> : null)}</div><p className="widget-caption">Los valores no reportados se muestran como —.</p></>;
    target = 'consulta/sistemas?recurso=resources';
  } else if (id === 'expiring') {
    body = <Rows rows={expiringConcessions(source?.data?.users || [], now).map(row => ({ id: row.username, title: row.username, subtitle: row.fullName || 'Cuenta por oficio', value: `${Math.max(1, Math.ceil(row.remaining / 3600000))} h` }))} empty="Sin concesiones por oficio que venzan en las próximas 72 horas." />;
    target = 'altas';
  } else if (id === 'aps') {
    const aps = source?.aps || [];
    body = aps.length ? <Numbers values={[
      ['En línea', aps.filter(row => row.status === 'online').length, 'text-success'],
      ['Fuera de línea', aps.filter(row => row.status === 'offline').length, 'text-danger'],
      ['Sin estado', aps.filter(row => !['online', 'offline'].includes(row.status)).length],
      ['Clientes', aps.reduce((sum, row) => sum + (Number(row.clients) || 0), 0)],
    ]} /> : <p className="widget-empty">No se recibieron access points.</p>;
    target = 'aps';
  } else if (id === 'cctv') {
    const cameras = (source?.assets || []).filter(row => row.dataset === 'cctv');
    body = cameras.length ? <Numbers values={[
      ['Documentadas', cameras.length], ['De baja', cameras.filter(row => row.decommissioned).length],
      ['Por revisar', cameras.filter(row => row.issues?.length).length, 'text-warning'],
    ]} /> : <p className="widget-empty">No hay cámaras en el catálogo actualizado.</p>;
    target = 'cctv';
  } else if (id === 'stock') {
    body = <><p className="widget-caption">Umbral de este widget: 5 unidades o menos.</p><Rows rows={(source?.items || []).filter(row => Number(row.quantity) <= 5).sort((a, b) => a.quantity - b.quantity).map(row => ({ id: row.id, title: row.description, subtitle: Number(row.quantity) === 0 ? 'Sin existencias · IDF 3' : 'Inventario de soporte · IDF 3', value: `${row.quantity} ${row.unit || 'unidades'}` }))} empty="No hay artículos con existencias bajas." /></>;
    target = 'soporte?vista=inventory';
  } else if (id === 'support-log') {
    body = <Rows rows={[...(source?.movements || [])].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).map(row => ({ id: row.id, title: row.element, subtitle: `${row.actor_name || row.actor || 'Sin responsable'} · ${dateTime(row.date)}`, value: row.quantity == null ? null : `${row.quantity} ${row.unit || 'unidades'}` }))} empty="Aún no hay retiros registrados." />;
    target = 'soporte?vista=log';
  } else if (id === 'network-pressure') {
    body = <BarRows rows={networkPressure(data.segments || []).map(row => ({ id: row.id || row.interface, title: row.name || row.interface || 'Red', percent: row.occupiedPercent, value: `${number(row.occupiedPercent)}%`, subtitle: `${number(row.active_leases)} de ${number(row.capacity)} direcciones asignadas` }))} empty="No hay datos confirmados de capacidad DHCP." />;
    target = 'resumen';
  } else if (id === 'device-types') {
    const groups = new Map();
    (data.devices || []).forEach(row => { const type = formatDeviceType(row); groups.set(type, (groups.get(type) || 0) + 1); });
    const total = (data.devices || []).length;
    body = <BarRows rows={[...groups].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ id: type, title: type, percent: total ? count / total * 100 : 0, value: number(count), subtitle: `${number(total ? count / total * 100 : 0)}% del inventario consultado` }))} empty="No se recibieron dispositivos para clasificar." />;
    target = 'dispositivos';
  } else if (id === 'offline-devices') {
    const offline = (data.devices || []).filter(row => row.status === 'offline');
    body = <><p className="widget-highlight"><strong>{number(offline.length)}</strong> equipos fuera de línea</p><Rows rows={offline.map(row => ({ id: row.id || row.mac, title: row.name || row.hostname || 'Equipo sin nombre', subtitle: row.ip || 'IP no reportada', value: 'Fuera de línea' }))} empty="No hay equipos reportados fuera de línea." /></>;
    target = 'dispositivos';
  } else if (id === 'recent-incidents') {
    body = <Rows rows={reportsFromData(data.reports || {}, data.idfs || []).map(row => ({ id: row.key, title: row.description || 'Reporte sin descripción', subtitle: `${row.idf} · ${row.date ? dateTime(row.date) : 'Fecha no informada'}`, value: row.status === 'resolved' ? 'Resuelta' : 'Pendiente' }))} empty="No hay incidencias registradas en los IDF consultados." />;
    target = 'idf';
  } else if (id === 'services') {
    body = <div className="widget-service-status">{[['FortiGate', data.health?.forti], ['OmniVista', data.health?.omni]].map(([name, status]) => <div key={name}><span className="widget-service-icon"><Activity size={18} /></span><div><strong>{name}</strong><small>Última comprobación</small></div><span className={`widget-status-chip ${status === true ? 'is-online' : status === false ? 'is-offline' : ''}`}><i />{status === true ? 'Responde' : status === false ? 'Sin conexión' : 'Sin confirmar'}</span></div>)}</div>;
  }
  const session = useSession();
  if (['incidents', 'recent-incidents'].includes(id) && !session.canViewPage('idf')) target = 'bitacora-idf';
  const [WidgetIcon, tone] = WIDGET_VISUALS[definition.module] || [LayoutDashboard, 'brand'];
  let distribution;
  if (id === 'devices' || id === 'aps') {
    const rows = id === 'devices' ? data.devices || [] : source?.aps || [];
    distribution = <Distribution label="equipos" values={[
      { label: 'En línea', value: rows.filter(row => row.status === 'online').length, color: '#168467' },
      { label: 'Fuera de línea', value: rows.filter(row => row.status === 'offline').length, color: '#b72d53' },
      { label: 'Sin estado', value: rows.filter(row => !['online', 'offline'].includes(row.status)).length, color: '#a9b2c0' },
    ]} />;
  } else if (id === 'ips') {
    distribution = <Distribution label="direcciones" values={[
      { label: 'Disponibles', value: (data.ips || []).filter(row => row.status === 'available').length, color: '#168467' },
      { label: 'Ocupadas', value: (data.ips || []).filter(row => row.status === 'occupied').length, color: '#b72d53' },
      { label: 'Otros estados', value: (data.ips || []).filter(row => !['available', 'occupied'].includes(row.status)).length, color: '#a9b2c0' },
    ]} />;
  }
  const updatedAt = REMOTE[id] ? remote.updatedAt : data.updatedAt;
  return <WidgetCard title={definition.title} module={definition.module} Icon={WidgetIcon} tone={tone} kind={id} loading={busy} updatedAt={updatedAt} demo={demo} onRefresh={REMOTE[id] ? remote.retry : refresh} footerAction={target && (id !== 'forti' || session.can('traffic.read')) ? { label: 'Ver detalle', onClick: () => navigate(target) } : null}>
    {busy ? <Loading /> : error ? <WidgetWarning error={error} onRetry={REMOTE[id] ? remote.retry : refresh} /> : distribution ? <>{distribution}{id === 'aps' && <Numbers values={[['Clientes conectados', (source?.aps || []).reduce((sum, row) => sum + (Number(row.clients) || 0), 0)]]} />}</> : body}
  </WidgetCard>;
}

export function DashboardWidgets({ children, data, demo, userId, loading, errors = {}, navigate, refresh, catalog: customCatalog, catalogTone, catalogIcon, defaultLayout = DEFAULT_WIDGET_LAYOUT, storagePrefix = 'sgrs:dashboard-widgets:v1', title = 'Tu dashboard', personalizeLabel = 'Personalizar dashboard', quickHide = false, groupBy, migrateLayout }) {
  const session = useSession();
  const key = `${storagePrefix}:${demo ? 'demo:' : ''}${userId}`;
  const catalog = customCatalog || WIDGET_CATALOG.filter(widget => widgetAllowed(widget.id, session));
  const allowed = new Set(catalog.map(widget => widget.id));
  const [layout, setLayout] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(key)); return sanitizeWidgetLayout(migrateLayout ? migrateLayout(saved) : saved, catalog) ?? defaultLayout; }
    catch { return defaultLayout; }
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const displayed = (editing ? draft : layout).filter(widget => allowed.has(widget.id));
  const groups = groupBy ? [...new Set(catalog.map(groupBy))].map(group => ({ group, widgets: displayed.filter(widget => groupBy(catalog.find(item => item.id === widget.id)) === group) })).filter(group => group.widgets.length) : [{ group: '', widgets: displayed }];
  const slots = Object.fromEntries(Children.toArray(children).filter(React.isValidElement).map(child => [child.props['data-widget-id'], child]));
  const start = () => { setDraft(layout.filter(widget => allowed.has(widget.id))); setEditing(true); setQuery(''); setMessage(''); setSaveError(''); };
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      setLayout(draft); setEditing(false); setSaveError(''); setMessage('Diseño guardado para tu usuario en este navegador.');
    } catch { setSaveError('No se pudo guardar en este navegador. Tu vista previa sigue disponible; vuelve a intentar o cancela.'); }
  };
  const move = (id, neighborId) => setDraft(current => {
    const index = current.findIndex(widget => widget.id === id);
    const target = current.findIndex(widget => widget.id === neighborId);
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const hide = id => {
    const next = layout.filter(widget => widget.id !== id);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setLayout(next); setSaveError(''); setMessage('Widget oculto. Puedes volver a agregarlo desde el catálogo.');
    } catch { setSaveError('No se pudo guardar el cambio en este navegador.'); }
  };
  return <div className="dashboard-customization">
    <div className="dashboard-customize-bar">
      <div>
        <LayoutDashboard size={19} aria-hidden="true" />
        <span>
          {editing ? (customCatalog ? `Vista previa · ${title}` : 'Vista previa de tu dashboard') : title}
          <small>{editing ? 'Ajusta los widgets y guarda al terminar.' : 'Organiza la información que necesitas según tus prioridades operativas.'}</small>
        </span>
      </div>
      <Button icon={Settings2} variant="secondary" onClick={start} disabled={editing}>{personalizeLabel}</Button>
    </div>
    {message && <p className="widget-save-message" role="status"><Check size={16} aria-hidden="true" />{message}</p>}
    {saveError && !editing && <Notice tone="danger" title="No se pudo ocultar el widget">{saveError}</Notice>}
    {editing && <section className="widget-editor" aria-label="Personalizar widgets">
      <div className="widget-editor-heading">
        <div>
          <h2><SlidersHorizontal size={18} aria-hidden="true" /> {customCatalog ? `Personalizar ${title.toLowerCase()}` : 'Personalizar widgets del dashboard'}</h2>
          <p>Elige información de tus módulos para configurar tu tablero. El diseño se guarda en este navegador.</p>
        </div>
        <Button icon={RotateCcw} onClick={() => { setDraft(defaultLayout.filter(widget => allowed.has(widget.id))); setSaveError(''); }}>Restablecer diseño</Button>
      </div>
      <SearchField defer value={query} onChange={setQuery} label="Buscar widgets" placeholder="Buscar por widget o módulo…" />
      <div className="widget-catalog">{catalog.filter(widget => `${widget.title} ${widget.module}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))).map(widget => {
        const added = draft.some(item => item.id === widget.id);
        const [ModuleIcon, moduleTone] = WIDGET_VISUALS[widget.module] || [LayoutDashboard, 'brand'];
        const CatalogIcon = catalogIcon?.(widget) || ModuleIcon;
        const tone = catalogTone?.(widget) || moduleTone;
        return <article key={widget.id} data-widget-id={widget.id} className={`widget-tone-${tone} ${added ? 'is-added' : ''}`}>
          <div className="widget-catalog-label">
            <div className="widget-catalog-title-group">
              <span className="widget-heading-icon"><CatalogIcon size={18} strokeWidth={2} aria-hidden="true" /></span>
              <strong className="widget-catalog-card-title">{widget.title}</strong>
            </div>
            <span className="widget-module">{widget.module}</span>
          </div>
          <h3>{widget.title}</h3>
          <p className="widget-catalog-desc">{widget.description}</p>
          <Button
            icon={added ? Trash2 : Plus}
            variant={added ? 'secondary' : 'primary'}
            aria-label={`${added ? 'Quitar del diseño' : 'Agregar'} ${widget.title}`}
            onClick={() => setDraft(current => added ? current.filter(item => item.id !== widget.id) : [...current, { id: widget.id, size: widget.size }])}
          >
            {added ? 'Quitar widget' : 'Agregar widget'}
          </Button>
        </article>;
      })}</div>
      {saveError && <Notice tone="danger" title="Diseño sin guardar">{saveError}</Notice>}
      <div className="widget-editor-actions">
        <span><strong>{draft.length}</strong> widgets seleccionados · Vista previa debajo</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={() => { setEditing(false); setSaveError(''); }}>Cancelar</Button>
          <Button variant="primary" onClick={save}>Guardar diseño</Button>
        </div>
      </div>
    </section>}
    {groups.map(({ group, widgets }) => <div key={group} className="dashboard-widget-grid" data-widget-group={group || undefined} aria-label={group || (editing ? 'Vista previa del diseño' : 'Widgets del dashboard')}>{widgets.map((widget, index) => {
      const definition = catalog.find(item => item.id === widget.id);
      const slotError = widget.id === 'metrics' ? (errors.ips || errors.devices || errors.segments) : ['segments', 'network'].includes(widget.id) ? errors.segments : '';
      return <section key={widget.id} className={`dashboard-widget-cell widget-span-${widget.size}`} data-widget={widget.id} style={{ '--widget-span': widget.size }}>
        {quickHide && !editing && <IconButton icon={EyeOff} label={`Ocultar ${definition.title}`} className="widget-hide-control" onClick={() => hide(widget.id)} />}
        {editing && <div className="widget-placement">
          <span className="widget-placement-title">
            <SlidersHorizontal size={14} aria-hidden="true" />
            <strong>{definition.title}</strong>
          </span>
          <div>
            <label className="widget-size-label">
              <span className="sr-only">Ancho de {definition.title}</span>
              <select aria-label={`Ancho de ${definition.title}`} value={widget.size} onChange={event => setDraft(current => current.map(item => item.id === widget.id ? { ...item, size: Number(event.target.value) } : item))}>
                {WIDGET_SIZES.filter(size => size.value >= definition.min).map(size => <option key={size.value} value={size.value}>{size.label}</option>)}
              </select>
            </label>
            <IconButton icon={ArrowUp} label={`Subir ${definition.title}`} disabled={index === 0} onClick={() => move(widget.id, widgets[index - 1].id)} />
            <IconButton icon={ArrowDown} label={`Bajar ${definition.title}`} disabled={index === widgets.length - 1} onClick={() => move(widget.id, widgets[index + 1].id)} />
            <IconButton icon={Trash2} label={`Quitar ${definition.title}`} onClick={() => setDraft(current => current.filter(item => item.id !== widget.id))} />
          </div>
        </div>}
        {slots[widget.id] && slotError && <WidgetWarning error={slotError} onRetry={refresh} />}
        {slots[widget.id] || <DataWidget id={widget.id} data={data} demo={demo} loading={loading} errors={errors} navigate={navigate} refresh={refresh} />}
      </section>;
    })}</div>)}
    {!displayed.length && <Empty title="Tu dashboard está listo para personalizar" action={!editing && <Button icon={Plus} onClick={start}>Agregar widgets</Button>}>Agrega información de tus módulos desde el catálogo.</Empty>}
  </div>;
}
