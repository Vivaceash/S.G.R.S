import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Save, Server, Camera, Wifi, TriangleAlert, Users, MapPin, Trash2, Power, Download } from 'lucide-react';
import { Badge, Button, DataTable, Dialog, Field, Loading, Metric, Notice, SearchField, Select, downloadCsv, useListState } from './components.jsx';
import { PageHeading } from './pages.jsx';
import { useForm } from './forms.jsx';
import { dateTime, number, request, selectRows } from './domain.mjs';
import { useSession } from './session.jsx';
import { normalizeInventoryCatalog } from './inventory-data.mjs';
import plantaBaja from './assets/visuals/PLANTA_BAJA_FINAL.png';
import piso1 from './assets/visuals/PISO1_FINAL.png';
import piso2 from './assets/visuals/PISO2_FINAL.png';
import piso3 from './assets/visuals/PISO3_FINAL.png';

const comparisonLabels = { pending: 'Sin cotejar', matched: 'Identidad coincidente', changed: 'IP actual diferente', ambiguous: 'Identidad en conflicto', not_observed: 'Sin coincidencia en la consulta', unavailable: 'Cotejo incompleto' };
const sourceLabel = source => source ? `${source.file} · ${source.sheet || `Tabla ${source.table}`} · Fila ${source.row}` : 'Sin fuente documental';
const emptyCatalog = () => ({ assets: [], cabinets: [], observations: [], sources: [], structure: {}, revision: '' });
const demoCatalog = () => ({ ...emptyCatalog(), revision: 'demo', cabinets: [{ id: 'idf-1', name: 'IDF 1' }], assets: ['idf', 'ap', 'cctv'].map((dataset, i) => ({ id: `example-${i}`, dataset, name: ['Switch de ejemplo', 'AP de ejemplo', 'Cámara de ejemplo'][i], idf_id: 'idf-1', kind: 'equipment', version: 'demo:0', model: 'Modelo de ejemplo', serial: `EJEMPLO-${i}`, mac: '', documented_ip: '', location: 'Ubicación ficticia', issues: [], source: { file: 'Demostración', table: 1, row: i + 1 }, relocated: false, destination: '' })) });
const floorPlans = [
  { id: 'planta-baja', label: 'Planta baja', image: plantaBaja, ratio: 1439 / 1093, shiftX: 0, shiftY: 0 },
  { id: 'piso-1', label: 'Piso 1', image: piso1, ratio: 1442 / 1091, shiftX: -3, shiftY: -3 },
  { id: 'piso-2', label: 'Piso 2', image: piso2, ratio: 1419 / 1109, shiftX: -0.2, shiftY: -0.3 },
  { id: 'piso-3', label: 'Piso 3', image: piso3, ratio: 1426 / 1103, shiftX: -0.2, shiftY: -0.3 },
];
const normalizeApIdentity = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function PhysicalApMap({ aps, positions, setPositions, canWrite, demo, notify }) {
  const [floorId, setFloorId] = useState('planta-baja');
  const [placing, setPlacing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [idfFilter, setIdfFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const floor = floorPlans.find(item => item.id === floorId) || floorPlans[0];
  // Todos los niveles comparten un lienzo 1.30:1. Se conserva la proporción
  // original y se recorta solo el excedente mínimo del borde, evitando que cada
  // plano se perciba más grande o pequeño al cambiar de nivel.
  const fittedImage = floor.ratio >= 1.3
    ? { left: (100 - (floor.ratio / 1.3) * 100) / 2, top: 0, width: (floor.ratio / 1.3) * 100, height: 100 }
    : { left: 0, top: (100 - (1.3 / floor.ratio) * 100) / 2, width: 100, height: (1.3 / floor.ratio) * 100 };
  const apIndex = useMemo(() => {
    const result = new Map();
    for (const ap of aps) {
      if (!result.has(ap.id)) result.set(ap.id, ap);
      for (const key of [normalizeApIdentity(ap.mac), normalizeApIdentity(ap.serial)]) if (key && !result.has(key)) result.set(key, ap);
    }
    return result;
  }, [aps]);
  const apForPosition = position => apIndex.get(position.ap_id) || apIndex.get(position.ap_mac) || apIndex.get(position.ap_serial);
  const positionedIds = new Set(positions.map(position => position.ap_id));
  const availableAps = aps.filter(ap => !positionedIds.has(ap.id));
  const idfOptions = [...new Set(aps.map(ap => ap.idf_tag || ap.location?.split('->')[0]?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es-MX', { numeric: true }));
  const filteredAps = availableAps.filter(ap => (!idfFilter || (ap.idf_tag || ap.location?.split('->')[0]?.trim()) === idfFilter) && (!statusFilter || ap.status === statusFilter));
  const visible = positions.filter(position => position.floor_id === floor.id);
  const selected = positions.find(position => position.ap_id === selectedId) || null;
  const offline = positions.filter(position => apForPosition(position)?.status === 'offline').length;

  const savePosition = async (ap, x, y) => {
    const next = { ap_id: ap.id, ap_mac: normalizeApIdentity(ap.mac), ap_serial: normalizeApIdentity(ap.serial), floor_id: floor.id, x, y, label: ap.name };
    setSaving(true); setError('');
    try {
      if (demo) {
        setPositions(old => [...old.filter(position => position.ap_id !== ap.id), { ...next, updated_at: new Date().toISOString() }]);
      } else {
        const result = await request('/api/aps/map/save', { body: next });
        setPositions(old => [...old.filter(position => position.ap_id !== ap.id), result.position]);
      }
      setSelectedId(ap.id); setPlacing(null); notify(`Ubicación de ${ap.name} guardada en ${floor.label}.`);
    } catch (err) { setError(err.message || 'No se pudo guardar la ubicación del AP.'); }
    finally { setSaving(false); }
  };
  const onPlanClick = event => {
    if (!placing || saving) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = ((event.clientX - rect.left) / rect.width) * 100 - floor.shiftX;
    const rawY = ((event.clientY - rect.top) / rect.height) * 100 - floor.shiftY;
    const x = ((rawX - fittedImage.left) / fittedImage.width) * 100;
    const y = ((rawY - fittedImage.top) / fittedImage.height) * 100;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    savePosition(placing, x, y);
  };
  const remove = async position => {
    setSaving(true); setError('');
    try {
      if (demo) setPositions(old => old.filter(item => item.ap_id !== position.ap_id));
      else await request('/api/aps/map/remove', { body: { ap_id: position.ap_id } });
      setPositions(old => old.filter(item => item.ap_id !== position.ap_id)); setSelectedId(null); notify('AP retirado del plano.');
    } catch (err) { setError(err.message || 'No se pudo retirar el AP del plano.'); }
    finally { setSaving(false); }
  };

  return <>
    <PageHeading eyebrow="Red inalámbrica institucional · Ubicación física" title="Mapa interactivo de Access Points" description="Coloca los AP detectados por OmniVista sobre cada plano. Los marcadores cambian de color automáticamente con el estado en vivo." />
    {error && <Notice title="Mapa sin actualizar" tone="danger">{error}</Notice>}
    {offline > 0 && <Notice title={`${offline} AP(s) ubicados fuera de servicio`} tone="danger">Los marcadores rojos indican la ubicación física de los equipos reportados como Down por OmniVista.</Notice>}
    <section className="ap-map-layout">
      <aside className="ap-map-sidebar">
        <h2>Niveles del edificio</h2>
        <div className="ap-map-floors" role="tablist" aria-label="Planos del edificio">{floorPlans.map(item => <button key={item.id} type="button" role="tab" aria-selected={floor.id === item.id} className={floor.id === item.id ? 'active' : ''} onClick={() => { setFloorId(item.id); setPlacing(null); }}>{item.label}<small>{positions.filter(position => position.floor_id === item.id).length} AP</small></button>)}</div>
        {canWrite && <div className="ap-map-import"><h3>Clasificar AP para colocar</h3><p>Filtra por ubicación o estado antes de seleccionar el equipo que ubicarás en el plano.</p><label className="ap-map-filter"><span>Ubicación / IDF</span><select value={idfFilter} onChange={event => { setIdfFilter(event.target.value); setPlacing(null); }}><option value="">Todos los IDF</option>{idfOptions.map(idf => <option key={idf} value={idf}>{idf}</option>)}</select></label><label className="ap-map-filter"><span>Estado en vivo</span><select value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPlacing(null); }}><option value="">Todos los estados</option><option value="online">En servicio (Up)</option><option value="offline">Fuera de servicio (Down)</option></select></label><h3 className="ap-map-import-title">Importar AP al plano</h3><select value={placing?.id || ''} disabled={saving || !filteredAps.length} onChange={event => setPlacing(aps.find(ap => ap.id === event.target.value) || null)}><option value="">{filteredAps.length ? 'Selecciona un Access Point' : 'Sin AP pendientes con este filtro'}</option>{filteredAps.map(ap => <option key={ap.id} value={ap.id}>{ap.name} · {ap.ip}</option>)}</select>{placing && <p className="ap-map-placement"><MapPin size={16} /> Haz clic en el plano para colocar <strong>{placing.name}</strong>.</p>}</div>}
        {!canWrite && <Notice title="Solo consulta">Tu perfil puede ver el mapa y el estado, pero no modificar ubicaciones.</Notice>}
        <div className="ap-map-legend"><span><i className="online" /> En servicio</span><span><i className="offline" /> Fuera de servicio</span><span><i className="unknown" /> Sin estado</span></div>
      </aside>
      <section className={`ap-floor-plan ${placing ? 'is-placing' : ''}`} aria-label={`Plano de ${floor.label}`} onClick={onPlanClick}>
        <img src={floor.image} alt={`Plano arquitectónico de ${floor.label}`} style={{ '--ap-map-shift-x': `${floor.shiftX}%`, '--ap-map-shift-y': `${floor.shiftY}%` }} />
        {visible.map(position => { const ap = apForPosition(position); const status = ap?.status || 'unknown'; return <button key={position.ap_id} type="button" className={`ap-map-marker ${status} ${selectedId === position.ap_id ? 'selected' : ''}`} style={{ left: `${floor.shiftX + fittedImage.left + (position.x / 100) * fittedImage.width}%`, top: `${floor.shiftY + fittedImage.top + (position.y / 100) * fittedImage.height}%` }} onClick={event => { event.stopPropagation(); setSelectedId(position.ap_id); setPlacing(null); }} aria-label={`${ap?.name || position.label || 'AP'}: ${status === 'offline' ? 'fuera de servicio' : status === 'online' ? 'en servicio' : 'sin estado'}`} title={ap?.name || position.label || 'Access Point'}><span className="ap-map-ap-icon" aria-hidden="true"><Wifi size={16} strokeWidth={2.3} /></span></button>; })}
        {placing && <div className="ap-map-click-hint">Haz clic para colocar: {placing.name}</div>}
      </section>
      <aside className="ap-map-details">{selected ? (() => { const ap = apForPosition(selected); return <><h2>{ap?.name || selected.label || 'Access Point'}</h2><Badge status={ap?.status || 'unknown'}>{ap?.status === 'offline' ? 'Fuera de servicio' : ap?.status === 'online' ? 'En servicio' : 'Sin estado actual'}</Badge><dl><div><dt>IP</dt><dd>{ap?.ip || 'No encontrada'}</dd></div><div><dt>MAC</dt><dd className="font-mono">{ap?.mac || 'No encontrada'}</dd></div><div><dt>Ubicación / IDF</dt><dd>{ap?.idf_tag || ap?.location?.split('->')[0]?.trim() || 'No informada'}</dd></div><div><dt>Modelo</dt><dd>{ap?.model || 'No informado'}</dd></div><div><dt>Ubicación OmniVista</dt><dd>{ap?.location || 'No encontrada'}</dd></div><div><dt>Clientes</dt><dd>{number(ap?.clients || 0)}</dd></div></dl>{canWrite && <div className="ap-map-actions"><Button onClick={() => { setFloorId(selected.floor_id); setPlacing(ap || null); }} disabled={!ap || saving}>Reubicar</Button><Button variant="danger" icon={Trash2} onClick={() => remove(selected)} busy={saving}>Retirar</Button></div>}</> })() : <><h2>Marcadores del plano</h2><p>Selecciona un marcador para consultar sus datos, o importa un AP para situarlo en este nivel.</p></>}</aside>
    </section>
  </>;
}

function AssetForm({ asset, cabinets, onSave, onDirty, onBusy, onCancel }) {
  const camera = asset.dataset === 'cctv';
  const form = useForm({ name: asset.name || '', idf_id: asset.idf_id || '', location: asset.location || '', rack: asset.rack || '', ports: asset.ports || '', notes: asset.notes || '', ...(camera ? { relocated: asset.relocated || false, destination: asset.destination || '', decommissioned: asset.decommissioned || false } : {}) }, values => {
    const errors = {};
    if (!values.name.trim()) errors.name = 'Indica una descripción del recurso.';
    if (camera && Boolean(values.destination.trim()) !== values.relocated) errors.destination = 'Indica el destino si la cámara fue reubicada; en caso contrario, deja el campo vacío.';
    return errors;
  }, onSave, onDirty);
  useEffect(() => { onBusy(form.busy); return () => onBusy(false); }, [form.busy, onBusy]);
  const field = (key, label, className = '') => <div className={className}><Field key={key} label={label} error={form.errors[key]} required={key === 'name'}><input value={form.values[key]} maxLength={240} onChange={e => form.change(key, e.target.value)} /></Field></div>;
  return <form noValidate ref={form.form} onSubmit={form.submit} aria-busy={form.busy} className="asset-form-container">
    <div className="asset-form-hero">
      <div>
        <span className="asset-form-hero-badge">{camera ? 'CCTV · Cámara' : 'Dispositivo de Red'}</span>
        <div className="asset-form-hero-title">Ajuste de Atributos Físicos y Ubicación</div>
        <p className="asset-form-hero-desc">La fuente documental original se preserva como respaldo histórico. Los cambios actualizan el registro activo en catálogo.</p>
      </div>
    </div>
    {form.error && <Notice title={form.uncertain ? 'Guardado sin confirmar' : 'No se pudo guardar'} tone="danger">{form.error}</Notice>}
    <fieldset disabled={form.busy || form.uncertain} style={{ border: 0, padding: 0, margin: 0 }}>
      <div style={{ display: 'grid', gap: '16px' }}>
        <div className="asset-form-card">
          <div className="asset-form-card-header">
            <Server size={17} strokeWidth={2} />
            <h3>Identificación y Ubicación</h3>
          </div>
          <div className="asset-form-grid">
            {field('name', 'Descripción / Nombre', 'col-span-full')}
            <Field label="Gabinete / IDF" error={form.errors.idf_id}>
              <select value={form.values.idf_id} onChange={e => form.change('idf_id', e.target.value)}>
                <option value="">Sin asignar</option>
                {cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            {field('location', 'Ubicación física')}
            {!camera && <>
              {field('rack', 'Rack')}
              {field('ports', 'Puertos / Capacidad')}
            </>}
          </div>
        </div>

        {camera && (
          <div className="asset-form-card">
            <div className="asset-form-card-header">
              <Camera size={17} strokeWidth={2} />
              <h3>Estado Operativo y Reubicación</h3>
            </div>
            <div className="asset-form-grid">
              <Field label="Estado en inventario">
                <select value={String(form.values.decommissioned)} onChange={e => form.change('decommissioned', e.target.value === 'true')}>
                  <option value="false">Activa en inventario</option>
                  <option value="true">Retirada / Desactivada</option>
                </select>
              </Field>
              <Field label="Condición de reubicación">
                <select value={String(form.values.relocated)} onChange={e => {
                  const isRelocated = e.target.value === 'true';
                  form.change('relocated', isRelocated);
                  if (!isRelocated) form.change('destination', '');
                }}>
                  <option value="false">En ubicación asignada</option>
                  <option value="true">Reubicada físicamente</option>
                </select>
              </Field>
              {form.values.relocated && (
                <div className="col-span-full">
                  {field('destination', 'Destino o nueva ubicación física')}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="asset-form-card">
          <div className="asset-form-card-header">
            <MapPin size={17} strokeWidth={2} />
            <h3>Observaciones Técnicas y Bitácora</h3>
          </div>
          <div className="asset-form-grid">
            <div className="col-span-full">
              <Field label="Notas de la corrección">
                <textarea className="resize-none" rows={3} maxLength={1000} placeholder="Detalles de la verificación física o motivo de la actualización..." value={form.values.notes} onChange={e => form.change('notes', e.target.value)} />
              </Field>
            </div>
          </div>
        </div>
      </div>
    </fieldset>
    <div className="form-actions" style={{ marginTop: '4px' }}>
      <Button onClick={onCancel} disabled={form.busy}>Cancelar</Button>
      <Button type="submit" variant="primary" icon={Save} busy={form.busy} disabled={form.uncertain}>Guardar corrección</Button>
    </div>
  </form>;
}

export function DocumentaryInventory({ route, demo, navigate, canWrite, canExport, canViewActivity, mutate, notify, onDirty, openEditor, data }) {
  const { canViewSubmodule } = useSession();
  const apLive = canViewSubmodule('aps', 'live');
  const apDocumentary = canViewSubmodule('aps', 'documentary');
  const apMap = canViewSubmodule('aps', 'map');
  const cctvUpdated = canViewSubmodule('cctv', 'updated');
  const cctvOriginal = canViewSubmodule('cctv', 'original');
  const [catalog, setCatalog] = useState(emptyCatalog);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [network, setNetwork] = useState(null);
  const [checking, setChecking] = useState(false);
  const [networkError, setNetworkError] = useState('');
  const [modal, setModal] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(null);
  const catalogController = useRef(null);
  const cameraWriteLock = useRef(false);
  const [pendingCamera, setPendingCamera] = useState(null);
  const generation = useRef(0);
  const state = useListState(`documentos-${route}`);
  const defaultDataset = route === 'cctv' ? 'cctv' : route === 'aps' ? 'ap' : 'idf';
  const dataset = route === 'cctv' && ((state.filters.dataset === 'cctv_original' && cctvOriginal) || !cctvUpdated) ? 'cctv_original' : defaultDataset;

  // Estado y telemetría en vivo para Access Points vía OmniVista
  const [activeTab, setActiveTab] = useState('omnivista');
  const visibleActiveTab = (activeTab === 'omnivista' && apLive) || (activeTab === 'documentary' && apDocumentary) || (activeTab === 'map' && apMap)
    ? activeTab : apLive ? 'omnivista' : apDocumentary ? 'documentary' : 'map';
  const [omniAps, setOmniAps] = useState([]);
  const [omniSummary, setOmniSummary] = useState({ total: 0, online: 0, offline: 0, clients: 0 });
  const [omniLoading, setOmniLoading] = useState(false);
  const [omniError, setOmniError] = useState('');
  const [omniRevision, setOmniRevision] = useState(0);
  const [omniUpdatedAt, setOmniUpdatedAt] = useState(null);
  const [selectedAp, setSelectedAp] = useState(null);
  const [mapPositions, setMapPositions] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState('');
  const omniState = useListState('omnivista-aps');
  const demoAps = demo ? data?.aps : null;

  // Compatibilidad con URLs abiertas antes de retirar el estado Warning.
  // Sin esta limpieza, un filtro guardado en la URL dejaría la tabla vacía.
  useEffect(() => {
    if (route === 'aps' && ['warning', 'unknown'].includes(omniState.filters.status)) {
      omniState.setFilter('status', '');
    }
  }, [route, omniState.filters.status]);

  useEffect(() => {
    if (route !== 'aps' || !apLive) return;
    if (demo) {
      const demoList = data?.aps || [];
      setOmniAps(demoList);
      setOmniSummary({
        total: demoList.length,
        online: demoList.filter(a => a.status !== 'offline').length,
        offline: demoList.filter(a => a.status === 'offline').length,
        clients: demoList.reduce((acc, a) => acc + (a.clients || 0), 0),
      });
      setOmniLoading(false);
      setOmniUpdatedAt(data?.updatedAt || new Date().toISOString());
      return;
    }

    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const fetchOmniAps = async () => {
      setOmniLoading(true);
      setOmniError('');
      try {
        const res = await request('/api/aps/omnivista', { signal: controller.signal });
        if (!active) return;
        const aps = res.aps || [];
        setOmniAps(aps);
        setOmniSummary(res.summary || {
          total: aps.length,
          online: aps.filter(a => a.status !== 'offline').length,
          offline: aps.filter(a => a.status === 'offline').length,
          clients: aps.reduce((acc, a) => acc + (a.clients || 0), 0),
        });
        setOmniUpdatedAt(new Date().toISOString());
        setOmniError('');
      } catch (err) {
        if (active) {
          setOmniError(err.name === 'AbortError' ? 'La consulta a OmniVista tardó demasiado.' : err.message);
        }
      } finally {
        clearTimeout(timeout);
        if (active) setOmniLoading(false);
      }
    };

    fetchOmniAps();

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [route, demo, demoAps, omniRevision, apLive]);
  useEffect(() => {
    if (route !== 'aps' || visibleActiveTab !== 'map') return;
    if (demo) { setMapLoading(false); setMapError(''); return; }
    let active = true;
    setMapLoading(true); setMapError('');
    request('/api/aps/map').then(result => {
      if (active) setMapPositions(Array.isArray(result.positions) ? result.positions : []);
    }).catch(err => { if (active) setMapError(err.message || 'No se pudieron cargar las ubicaciones del mapa.'); })
      .finally(() => { if (active) setMapLoading(false); });
    return () => { active = false; };
  }, [route, visibleActiveTab, demo]);
  useEffect(() => {
    setNetwork(null); setNetworkError('');
    if (demo) { setCatalog(demoCatalog()); setError(''); setLoading(false); return; }
    if (route === 'aps' && visibleActiveTab !== 'documentary') { setLoading(false); return; }
    const controller = new AbortController(); let active = true;
    catalogController.current = controller;
    setLoading(true); setError('');
    // Allow the backend's 15-second provider timeout to return its diagnosis.
    // Settle the UI here as well: abort alone depends on fetch rejecting.
    const timer = setTimeout(() => {
      if (!active) return;
      controller.abort();
      setError('La consulta al inventario tardó demasiado. Vuelve a intentar; si persiste, revisa la conexión de API Inventarios.');
      setLoading(false);
    }, 25000);
    request('/api/inventory/catalog', { signal: controller.signal }).then(result => {
      if (active && !controller.signal.aborted) setCatalog(normalizeInventoryCatalog(result));
    }).catch(e => { if (active && !controller.signal.aborted) setError(e.message || 'No se pudo consultar API Inventarios.'); }).finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [demo, revision, route, visibleActiveTab]);
  useEffect(() => () => { generation.current++; requestRef.current?.abort(); }, []);
  const markDirty = value => { setDirty(value); onDirty(value); };
  const close = () => { if (busy) return; if (dirty) setDiscard(true); else setModal(null); };
  const reload = () => { generation.current++; requestRef.current?.abort(); setChecking(false); setRevision(v => v + 1); };
  const check = async () => {
    if (demo) return;
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const version = ++generation.current;
    setChecking(true); setNetwork(null); setNetworkError('');
    const timer = setTimeout(() => controller.abort(), 14000);
    try {
      const result = await request('/api/inventory/reconcile', { signal: controller.signal });
      if (version !== generation.current) return;
      if (result.revision !== catalog.revision) { setNetworkError('El catálogo documental cambió. Actualiza la consulta antes de cotejar.'); return; }
      setNetwork(result);
    } catch (e) { if (version === generation.current) setNetworkError(e.name === 'AbortError' ? 'El cotejo tardó demasiado. Puedes volver a intentar.' : e.message); }
    finally { clearTimeout(timer); if (version === generation.current) setChecking(false); }
  };
  const cabinetNames = useMemo(() => new Map(catalog.cabinets.map(c => [c.id, c.name])), [catalog.cabinets]);
  const rows = useMemo(() => catalog.assets.filter(a => a.dataset === dataset).map(a => ({ ...a,
    idf: cabinetNames.get(a.idf_id) || 'Sin asignar',
    kindLabel: a.kind === 'rack' ? 'Rack / Contenedor' : 'Equipo / Componente',
    comparison: comparisonLabels[network?.assets[a.id]?.comparison || 'pending'],
    current_ip: network?.assets[a.id]?.ip || '', status: network?.assets[a.id]?.status || 'unknown',
    relocation: a.destination && !a.relocated ? 'Por confirmar' : a.relocated ? 'Reubicada' : 'Sin reubicación',
    lifecycle: a.decommissioned ? 'Retirada / desactivada' : 'Activa',
    issuesText: (a.issues || []).join(' · '), sourceText: sourceLabel(a.source),
  })), [catalog.assets, dataset, cabinetNames, network]);
  const toggleCamera = async asset => {
    if (cameraWriteLock.current) return;
    cameraWriteLock.current = true;
    setPendingCamera(asset.id);
    catalogController.current?.abort();
    const next = !asset.decommissioned;
    generation.current++; requestRef.current?.abort(); setChecking(false);
    try {
      const result = demo
        ? { asset: { ...asset, decommissioned: next, documented: asset.documented || asset, corrected_at: new Date().toISOString() } }
        : await mutate('/api/inventory/asset', { id: asset.id, version: asset.version, fields: { decommissioned: next } });
      if (result.asset?.id !== asset.id || (!demo && typeof result.asset.version !== 'string')) throw new Error('No se pudo confirmar la cámara actualizada. Recarga el catálogo.');
      normalizeInventoryCatalog({ ...catalog, assets: [result.asset] });
      setCatalog(old => ({ ...old, assets: old.assets.map(a => a.id === asset.id ? result.asset : a) }));
      setModal(current => current?.type === 'detail' && current.asset.id === asset.id ? { ...current, asset: { ...current.asset, ...result.asset, lifecycle: next ? 'Retirada / desactivada' : 'Activa' } } : current);
      setNetwork(null);
      notify(next ? 'Cámara marcada como retirada / desactivada.' : 'Cámara marcada como activa en inventario.');
    } catch (err) { notify(err.message || 'No se pudo actualizar el estado de la cámara.'); }
    finally { cameraWriteLock.current = false; setPendingCamera(null); }
  };
  const allColumns = [{ key: 'name', label: 'Recurso' }, { key: 'idf', label: route === 'cctv' ? 'Ubicación del IDF' : 'Gabinete' },
    { key: 'location', label: 'Ubicación' }, { key: 'model', label: 'Modelo' },
    { key: 'documented_ip', label: 'IP documentada' }, { key: 'current_ip', label: 'IP observada en API' },
    { key: 'comparison', label: 'Cotejo' }, { key: 'status', label: 'Estado API', render: a => <Badge status={a.status} /> },
    ...(route === 'cctv' ? [{ key: 'lifecycle', label: 'Inventario', render: a => <span className={a.decommissioned ? 'camera-state is-decommissioned' : 'camera-state'}><i />{a.lifecycle}</span> }] : []),
    { key: 'actions', label: 'Acciones', sortable: false, render: a => <div className="camera-actions"><Button onClick={() => setModal({ type: 'detail', asset: a })}>Ver ficha</Button>{route === 'cctv' && canWrite && a.dataset !== 'cctv_original' && <button type="button" disabled={Boolean(pendingCamera)} className={`camera-power ${a.decommissioned ? 'is-on' : ''}`} onClick={() => toggleCamera(a)} aria-label={a.decommissioned ? `Activar ${a.name}` : `Marcar ${a.name} como retirada`} title={a.decommissioned ? 'Reactivar en inventario' : 'Marcar como retirada / desactivada'}><Power size={15} /></button>}</div> }];
  const columns = route === 'cctv'
    ? allColumns.filter(column => ['name', 'idf', 'location', 'model', 'documented_ip', 'lifecycle', 'actions'].includes(column.key))
    : allColumns;
  const tableFilters = useMemo(() => ({ ...state.filters, dataset, ...(dataset === 'cctv_original' ? { relocation: '', decommissioned: '' } : {}) }), [state.filters, dataset]);
  const exportRows = useMemo(() => selectRows(rows, state.query, tableFilters, state.sort, state.asc), [rows, state.query, tableFilters, state.sort, state.asc]);

  const idfOptions = Array.from(new Set(omniAps.map(a => a.idf_tag).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const modelOptions = Array.from(new Set(omniAps.map(a => a.model).filter(Boolean))).sort();
  const omniColumns = [
    { key: 'name', label: 'Punto de Acceso' },
    { key: 'status', label: 'Estado', render: a => <Badge status={a.status}>{a.status === 'online' ? 'Up' : 'Down'}</Badge> },
    { key: 'location', label: 'Ubicación / Conexión' },
    { key: 'model', label: 'Modelo' },
    { key: 'ip', label: 'Dirección IP' },
    { key: 'mac', label: 'MAC' },
    { key: 'serial', label: 'N.º Serie' },
    { key: 'clients', label: 'Clientes', render: a => <strong>{number(a.clients)}</strong> },
    { key: 'actions', label: 'Acciones', sortable: false, render: a => <Button onClick={() => setSelectedAp(a)}>Ver detalles</Button> },
  ];
  const save = async fields => {
    const asset = modal.asset;
    catalogController.current?.abort();
    generation.current++; requestRef.current?.abort(); setChecking(false);
    const result = demo ? { asset: { ...asset, ...fields, documented: asset.documented || asset, corrected_at: new Date().toISOString() } } : await mutate('/api/inventory/asset', { id: asset.id, version: asset.version, fields });
    if (result.asset?.id !== asset.id || (!demo && typeof result.asset.version !== 'string')) throw new Error('No se pudo confirmar la cámara actualizada. Recarga el catálogo.');
    normalizeInventoryCatalog({ ...catalog, assets: [result.asset] });
    setCatalog(old => ({ ...old, assets: old.assets.map(a => a.id === asset.id ? result.asset : a) }));
    setNetwork(null); markDirty(false); setModal(null);
    notify(demo ? 'Corrección de ejemplo guardada en esta sesión.' : 'Corrección física guardada. La fuente original se conserva.');
  };
  const selected = modal?.asset;
  const title = route === 'cctv' ? 'Inventario CCTV' : route === 'aps' ? 'Inventario de access points' : 'Inventario documental de IDF';
  return <>
    {route === 'aps' && (
      <nav className="inventory-tabs" role="tablist" aria-label="Modo de consulta de Access Points">
        {apLive && <button
          type="button"
          role="tab"
          aria-selected={visibleActiveTab === 'omnivista'}
          className={visibleActiveTab === 'omnivista' ? 'active' : ''}
          onClick={() => setActiveTab('omnivista')}
        >
          <Wifi size={15} aria-hidden="true" />
          En vivo (OmniVista) · {omniLoading && !omniAps.length ? '…' : number(omniSummary.total || omniAps.length)}
        </button>}
        {apDocumentary && <button
          type="button"
          role="tab"
          aria-selected={visibleActiveTab === 'documentary'}
          className={visibleActiveTab === 'documentary' ? 'active' : ''}
          onClick={() => setActiveTab('documentary')}
        >
          <Server size={15} aria-hidden="true" />
          Catálogo documental · {number(rows.length)}
        </button>}
        {apMap && <button
          type="button"
          role="tab"
          aria-selected={visibleActiveTab === 'map'}
          className={visibleActiveTab === 'map' ? 'active' : ''}
          onClick={() => setActiveTab('map')}
        >
          <MapPin size={15} aria-hidden="true" />
          Mapa físico · {number(mapPositions.length)}
        </button>}
      </nav>
    )}
    {route === 'cctv' && (
      <nav className="inventory-tabs" role="tablist" aria-label="Fuente del inventario CCTV">
        {cctvUpdated && <button type="button" role="tab" aria-selected={dataset === 'cctv'} className={dataset === 'cctv' ? 'active' : ''} onClick={() => state.setFilter('dataset', 'cctv')}>
          <Camera size={15} aria-hidden="true" /> Actualizadas · {number(catalog.assets.filter(asset => asset.dataset === 'cctv').length)}
        </button>}
        {cctvOriginal && <button type="button" role="tab" aria-selected={dataset === 'cctv_original'} className={dataset === 'cctv_original' ? 'active' : ''} onClick={() => state.setFilter('dataset', 'cctv_original')}>
          <Server size={15} aria-hidden="true" /> Originales · {number(catalog.assets.filter(asset => asset.dataset === 'cctv_original').length)}
        </button>}
      </nav>
    )}

    {route === 'aps' && visibleActiveTab === 'omnivista' ? (
      <>
        <PageHeading
          eyebrow="Red inalámbrica institucional · Monitoreo"
          title="Puntos de Acceso en Vivo (OmniVista)"
          description="Dispositivos inalámbricos monitoreados en tiempo real con sincronización automática cada 15 s. Detecta caídas de enlace, clientes conectados y canales de radio."
          updatedAt={omniUpdatedAt}
        />
        {omniError && <Notice title="No se pudo consultar OmniVista" tone="danger" action={<Button onClick={() => setOmniRevision(r => r + 1)}>Reintentar</Button>}>{omniError}</Notice>}
        {omniSummary.offline > 0 && (
          <Notice title={`${omniSummary.offline} Access Point(s) fuera de servicio detectado(s)`} tone="danger">
            OmniVista reporta equipos sin enlace activo o desconectados. Puedes filtrar por estado &quot;Fuera de servicio (Down)&quot; para identificar su ubicación física y puerto de switch/IDF.
          </Notice>
        )}
        <section className="metric-grid module-summary-cards">
          <Metric icon={Wifi} label="Access Points monitoreados" value={omniLoading && !omniAps.length ? '…' : number(omniSummary.total)} caption="detectados en OmniVista" />
          <Metric icon={Wifi} tone="success" label="En servicio (Up)" value={omniLoading && !omniAps.length ? '…' : number(omniSummary.online)} caption="transmitiendo en la red" />
          <Metric icon={TriangleAlert} tone={omniSummary.offline > 0 ? 'danger' : 'neutral'} label="Fuera de servicio (Down)" value={omniLoading && !omniAps.length ? '…' : number(omniSummary.offline)} caption={omniSummary.offline > 0 ? 'requiere revisión física' : 'sin caídas reportadas'} />
          <Metric icon={Users} tone="info" label="Clientes inalámbricos" value={omniLoading && !omniAps.length ? '…' : number(omniSummary.clients)} caption="dispositivos WiFi activos" />
        </section>
        <DataTable
          title="Puntos de acceso en red (OmniVista)"
          rows={omniAps}
          columns={omniColumns}
          state={omniState}
          noun="access points"
          toolbar={<div className="toolbar compact ap-toolbar">
            <Select label="Estado en vivo" value={omniState.filters.status || ''} onChange={e => omniState.setFilter('status', e.target.value)}>
              <option value="">Todos los estados</option>
              <option value="online">En servicio (Up)</option>
              <option value="offline">Fuera de servicio (Down)</option>
            </Select>
            {idfOptions.length > 1 && (
              <Select label="Gabinete / Switch" value={omniState.filters.idf_tag || ''} onChange={e => omniState.setFilter('idf_tag', e.target.value)}>
                <option value="">Todas las ubicaciones</option>
                {idfOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </Select>
            )}
            {modelOptions.length > 1 && (
              <Select label="Modelo" value={omniState.filters.model || ''} onChange={e => omniState.setFilter('model', e.target.value)}>
                <option value="">Todos los modelos</option>
                {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            )}
            <SearchField defer value={omniState.query} onChange={omniState.setQuery} placeholder="Buscar AP, IP, MAC, serie o ubicación…" />
          </div>}
          loading={omniLoading}
          error={omniError}
          onRetry={() => setOmniRevision(r => r + 1)}
          exportable={canExport}
          emptyText="OmniVista no devolvió puntos de acceso en esta consulta."
        />
        {selectedAp && (
          <Dialog open={Boolean(selectedAp)} onClose={() => setSelectedAp(null)} title={`Ficha técnica · ${selectedAp.name}`} wide>
            <dl className="detail-grid">
              <div><dt>Nombre de AP</dt><dd><strong>{selectedAp.name}</strong></dd></div>
              <div><dt>Estado de enlace</dt><dd><Badge status={selectedAp.status}>{selectedAp.status === 'online' ? 'Up' : 'Down'}</Badge></dd></div>
              <div><dt>Modelo</dt><dd>{selectedAp.model}</dd></div>
              <div><dt>Versión de firmware</dt><dd>{selectedAp.version || '—'}</dd></div>
              <div><dt>Dirección IP</dt><dd className="font-mono">{selectedAp.ip}</dd></div>
              <div><dt>Dirección MAC</dt><dd className="font-mono">{selectedAp.mac}</dd></div>
              <div><dt>Número de Serie</dt><dd className="font-mono">{selectedAp.serial}</dd></div>
              <div><dt>Ubicación / Switch conectado</dt><dd>{selectedAp.location}</dd></div>
              <div><dt>Clientes WiFi conectados</dt><dd><strong>{number(selectedAp.clients)}</strong> dispositivos</dd></div>
              <div><dt>Última respuesta registrada</dt><dd>{selectedAp.last_seen ? dateTime(selectedAp.last_seen) : 'Sin fecha reciente'}</dd></div>
            </dl>
            {Array.isArray(selectedAp.channels) && selectedAp.channels.length > 0 && (
              <div style={{ marginTop: '18px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: 'var(--color-brand)' }}>Canales y frecuencias de radio</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {selectedAp.channels.map((ch, idx) => (
                    <span key={idx} className="network-tag">{ch}</span>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(selectedAp.ssids) && selectedAp.ssids.length > 0 && (
              <div style={{ marginTop: '18px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: 'var(--color-brand)' }}>Redes inalámbricas (SSIDs) activas</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {selectedAp.ssids.map((ssid, idx) => (
                    <span key={idx} className="badge badge-neutral">{ssid}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="form-actions" style={{ marginTop: '20px' }}>
              <Button onClick={() => setSelectedAp(null)}>Cerrar ficha</Button>
            </div>
          </Dialog>
        )}
      </>
    ) : route === 'aps' && visibleActiveTab === 'map' ? (
      mapLoading ? <Loading /> : <><PhysicalApMap aps={omniAps} positions={mapPositions} setPositions={setMapPositions} canWrite={canWrite} demo={demo} notify={notify} />{mapError && <Notice title="No se pudieron cargar las ubicaciones" tone="danger" action={<Button onClick={() => setActiveTab('omnivista')}>Volver a la consulta en vivo</Button>}>{mapError}</Notice>}</>
    ) : (
      <>
        <PageHeading eyebrow={route === 'cctv' ? 'Inventario físico y cámaras' : 'Inventario físico y cotejo de red'} title={title} description={route === 'cctv' ? 'Datos documentados, estado operativo y correcciones físicas del sistema de videovigilancia' : 'Datos documentados, correcciones físicas y observaciones actuales de las APIs'} updatedAt={catalog.imported_at} />
        {route !== 'cctv' && <Notice title="La documentación no acredita el estado actual">La IP y el estado observados se muestran solo cuando existe una coincidencia de identidad con las APIs. Un equipo sin coincidencia no se considera dado de baja.</Notice>}
        {route === 'cctv' ? <section className="metric-grid module-summary-cards"><Metric icon={Camera} label="Cámaras documentadas" value={loading || error ? '—' : number(rows.length)} caption={dataset === 'cctv_original' ? 'catálogo histórico' : 'catálogo seleccionado'} /><Metric icon={Camera} tone="success" label="Cámaras activas" value={loading || error ? '—' : number(rows.filter(row => !row.decommissioned).length)} caption="disponibles en inventario" /><Metric icon={Power} tone={rows.some(row => row.decommissioned) ? 'danger' : 'neutral'} label="Retiradas / desactivadas" value={loading || error ? '—' : number(rows.filter(row => row.decommissioned).length)} caption="fuera de operación" /><Metric icon={MapPin} tone="info" label="Cámaras reubicadas" value={loading || error ? '—' : number(rows.filter(row => row.relocated).length)} caption="con destino documentado" /></section> : <section className={`metric-grid ${route === 'aps' ? 'module-summary-cards' : ''}`}><Metric icon={route === 'aps' ? Wifi : Server} label="Registros documentados" value={number(rows.length)} caption="catálogo seleccionado" /><Metric icon={Server} label="Racks / Contenedores" value={number(rows.filter(r => r.kind === 'rack').length)} caption="separados de los equipos" /><Metric icon={TriangleAlert} tone={route === 'aps' ? 'warning' : 'brand'} label="Con observaciones de datos" value={number(rows.filter(r => r.issues?.length).length)} caption="revisar en la ficha" /><Metric icon={RefreshCw} tone={route === 'aps' ? 'success' : 'brand'} label="Identidades cotejadas" value={number(rows.filter(r => ['matched', 'changed'].includes(network?.assets[r.id]?.comparison)).length)} caption="en la consulta de APIs" /></section>}
        <div className="toolbar">
          <Select label="Gabinete documental" value={state.filters.idf_id || ''} onChange={e => state.setFilter('idf_id', e.target.value)}><option value="">Todos los gabinetes</option>{catalog.cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          {route === 'cctv' && dataset === 'cctv' && <Select label="Reubicación" value={state.filters.relocation || ''} onChange={e => state.setFilter('relocation', e.target.value)}><option value="">Todas</option><option>Reubicada</option><option>Por confirmar</option><option>Sin reubicación</option></Select>}
          {route === 'cctv' && dataset === 'cctv' && <button type="button" className={`camera-retired-filter ${state.filters.decommissioned === 'true' ? 'is-active' : ''}`} aria-pressed={state.filters.decommissioned === 'true'} onClick={() => state.setFilter('decommissioned', state.filters.decommissioned === 'true' ? '' : 'true')}><Power size={15} />Retiradas <b>{rows.filter(row => row.decommissioned).length}</b></button>}
          <SearchField defer value={state.query} onChange={state.setQuery} placeholder="Buscar descripción, serie, MAC o ubicación…" />
          {route === 'cctv' ? <Button icon={Download} disabled={!canExport || loading || Boolean(error) || !exportRows.length} onClick={() => downloadCsv(title, columns.filter(column => column.key !== 'actions'), exportRows)}>Exportar consulta</Button> : <Button variant="primary" busy={checking} disabled={demo || loading || Boolean(error) || !catalog.assets.length} onClick={check}>Cotejar APIs</Button>}
        </div>
        {networkError && <Notice title="No se pudo completar el cotejo" tone="warning">{networkError}</Notice>}
        {network && <Notice title={network.sources.every(s => s.available) ? 'Cotejo realizado' : 'Cotejo parcial · Fuentes no disponibles'} tone={network.sources.every(s => s.available) ? 'info' : 'warning'}>{network.sources.map(s => `${s.provider === 'forti' ? 'FortiGate' : 'OmniVista'}: ${s.available ? `${s.count} registros consultados` : 'no disponible'} · ${dateTime(s.observed_at)}`).join(' / ')}. {network.scope} {network.only_api.length} registros de API sin vínculo confirmado con el catálogo.</Notice>}
        <DataTable title={title} className={route === 'cctv' ? 'cctv-table' : ''} rows={rows} columns={columns} state={{ ...state, filters: tableFilters }} rowClassName={route === 'cctv' ? row => row.decommissioned ? 'camera-row-decommissioned' : '' : undefined} loading={loading} error={error} onRetry={reload} exportable={route !== 'cctv' && canExport} />
        <Button disabled={loading || Boolean(error)} onClick={() => setModal({ type: 'sources' })}>Fuentes y discrepancias documentales</Button>
        {network?.only_api.length > 0 && <Button onClick={() => setModal({ type: 'unlinked' })}>Ver registros de API sin vínculo confirmado</Button>}
        <Dialog open={Boolean(modal)} onClose={close} title={modal?.type === 'edit' ? 'Corregir datos físicos' : modal?.type === 'unlinked' ? 'API sin vínculo confirmado' : modal?.type === 'sources' ? 'Fuentes documentales' : 'Ficha del recurso'} wide busy={busy}>
          {discard && <Notice title="¿Descartar los cambios sin guardar?" tone="warning" action={<><Button autoFocus onClick={() => setDiscard(false)}>Seguir editando</Button><Button variant="danger" onClick={() => { markDirty(false); setDiscard(false); setModal(null); }}>Descartar</Button></>}>La fuente original y las correcciones guardadas se conservan.</Notice>}
          {modal?.type === 'edit' && <AssetForm key={selected.id} asset={selected} cabinets={catalog.cabinets} onSave={save} onDirty={markDirty} onBusy={setBusy} onCancel={close} />}
          {modal?.type === 'detail' && <div className="detail-view-container">
            <div className="detail-view-header">
              <div className="detail-view-header-title">
                <strong>{selected.name || 'Recurso sin descripción'}</strong>
                <small>{selected.dataset === 'cctv' ? 'CCTV · Cámara de videovigilancia' : selected.kindLabel || 'Dispositivo de red'} · {selected.idf || 'Gabinete no asignado'}</small>
              </div>
              <Badge status={selected.dataset === 'cctv' ? (selected.decommissioned ? 'offline' : 'online') : (selected.comparison === 'matched' ? 'online' : 'unknown')}>
                {selected.dataset === 'cctv' ? (selected.decommissioned ? 'Retirada' : 'Activa') : selected.comparison}
              </Badge>
            </div>
            <dl className="detail-grid">{Object.entries({
              Gabinete: selected.idf,
              Tipo: selected.kindLabel,
              ...(selected.dataset === 'cctv' ? {} : { Rack: selected.rack, Puertos: selected.ports }),
              Ubicación: selected.location,
              Modelo: selected.model,
              Serie: selected.serial,
              MAC: selected.mac,
              'IP documentada': selected.documented_ip,
              'IP observada en API': selected.current_ip,
              Cotejo: selected.comparison,
              'Última corrección': selected.corrected_at ? dateTime(selected.corrected_at) : 'Sin correcciones',
              Estado: selected.dataset === 'cctv' ? selected.lifecycle : 'No aplica',
              Reubicación: selected.dataset === 'cctv' ? selected.relocation : 'No aplica',
              Destino: selected.destination,
              Fuente: selected.sourceText
            }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd className={['MAC', 'Serie', 'IP documentada', 'IP observada en API'].includes(key) ? 'font-mono' : ''}>{value || 'No informado'}</dd></div>)}</dl>
            {selected.issuesText && <Notice title="Observaciones de la fuente" tone="warning">{selected.issuesText}</Notice>}
            {selected.documented && selected.corrected_at && <Notice title="Valores originales conservados">Ubicación: {selected.documented.location || 'no informada'}. Gabinete: {selected.documented.idf_id || 'sin asignar'}. Destino: {selected.documented.destination || 'no informado'}.</Notice>}
            {(network?.assets[selected.id]?.observations || []).map((o, i) => <Notice key={i} title={`Observación de ${o.provider}`}>IP: {o.ip || 'no informada'} · Estado: {o.status} · Interfaz: {o.interface || 'no informada'} · {dateTime(o.observed_at)}</Notice>)}
            {catalog.observations.filter(o => o.idf_id === selected.idf_id).length > 0 && <div className="detail-history-box"><h3>Observaciones históricas del gabinete</h3><ul>{catalog.observations.filter(o => o.idf_id === selected.idf_id).map((o, i) => <li key={i}>{o.text}</li>)}</ul></div>}
            <div className="form-actions" style={{ marginTop: '8px' }}>
              {canViewActivity && data.idfs.some(c => c.id === selected.idf_id) && <Button onClick={() => { setModal(null); openEditor('qr', data.idfs.find(c => c.id === selected.idf_id)); }}>Código QR del gabinete</Button>}
              {canWrite && selected.dataset === 'cctv' && <Button icon={Power} busy={pendingCamera === selected.id} disabled={Boolean(pendingCamera)} variant={selected.decommissioned ? 'primary' : 'danger'} onClick={() => toggleCamera(selected)}>{selected.decommissioned ? 'Activar en inventario' : 'Marcar como retirada'}</Button>}
              {canWrite && selected.dataset !== 'cctv_original' && <Button variant="primary" onClick={() => setModal({ type: 'edit', asset: selected })}>Corregir datos físicos</Button>}
            </div>
          </div>}
          {modal?.type === 'unlinked' && <Unlinked rows={network?.only_api || []} canExport={canExport} />}
          {modal?.type === 'sources' && <Sources catalog={catalog} canExport={canExport && !demo} />}
        </Dialog>
      </>
    )}
  </>;
}

function Sources({ catalog, canExport }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const download = async source => {
    if (busy) return;
    setBusy(source.sha256); setError('');
    const current = new AbortController(); controller.current = current;
    const timer = setTimeout(() => current.abort(), 15000);
    try {
      const response = await fetch(`/api/inventory/documents/${source.sha256}`, { credentials: 'same-origin', signal: current.signal });
      if (response.status === 401) window.dispatchEvent(new Event('sgrs-session-expired'));
      if (!response.ok) throw new Error('No se pudo descargar el documento. Puede haber cambiado o no estar disponible en el servidor.');
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = source.file; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.name === 'AbortError' ? 'La descarga tardó demasiado. Vuelve a intentar.' : e.message); }
    finally { clearTimeout(timer); setBusy(''); }
  };
  const documentedCameras = catalog.assets.filter(a => a.dataset === 'cctv').length;
  const structureTotal = catalog.structure?.camera_counts?.reduce((sum, r) => sum + r.installed, 0);
  return <>
    <Notice title="Documentos históricos">El cotejo de red da prioridad a las APIs. El catálogo físico conserva la procedencia y las correcciones por separado. PACS e IDF 13 no se han fusionado.</Notice>
    {structureTotal != null && <Notice title="Conteos CCTV por conciliar" tone="warning">El libro de estructura registra {structureTotal} cámaras y el catálogo actualizado contiene {documentedCameras}. Esta diferencia documental no acredita faltantes físicos.</Notice>}
    {error && <Notice title="Descarga no completada" tone="danger">{error}</Notice>}
    <ul className="detail-list">{catalog.sources.map(s => <li key={s.sha256}><span>{s.file}</span>{canExport && s.file !== 'Estructura.xlsm' && <Button busy={busy === s.sha256} disabled={Boolean(busy)} onClick={() => download(s)}>Descargar original</Button>}</li>)}</ul>
    <p className="muted">El libro de estructura se limita a resúmenes permitidos; no se publica el archivo con datos de acceso.</p>
    {(catalog.structure?.camera_counts || []).map(c => <p key={c.site}>{c.site === 'MDF' || c.site === 'CASETA' ? c.site : `IDF ${c.site}`}: {c.installed} cámaras registradas en el libro de estructura.</p>)}
  </>;
}

function Unlinked({ rows, canExport }) {
  const state = useListState('api-sin-vinculo');
  return <DataTable title="Registros de API sin vínculo confirmado" rows={rows} state={state} columns={[{ key: 'provider', label: 'API' }, { key: 'name', label: 'Equipo' }, { key: 'ip', label: 'IP observada' }, { key: 'mac', label: 'MAC' }, { key: 'model', label: 'Modelo' }]} toolbar={<SearchField defer value={state.query} onChange={state.setQuery} />} exportable={canExport} />;
}
