import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Save, Server, Camera, Wifi, TriangleAlert } from 'lucide-react';
import { Badge, Button, DataTable, Dialog, Field, Metric, Notice, SearchField, Select, useListState } from './components.jsx';
import { InventoryTabs, PageHeading } from './pages.jsx';
import { useForm } from './forms.jsx';
import { dateTime, number, request } from './domain.mjs';

const comparisonLabels = { pending: 'Sin cotejar', matched: 'Identidad coincidente', changed: 'IP actual diferente', ambiguous: 'Identidad en conflicto', not_observed: 'Sin coincidencia en la consulta', unavailable: 'Cotejo incompleto' };
const sourceLabel = source => source ? `${source.file} · ${source.sheet || `Tabla ${source.table}`} · Fila ${source.row}` : 'Sin fuente documental';
const emptyCatalog = () => ({ assets: [], cabinets: [], observations: [], sources: [], structure: {}, revision: '' });
const demoCatalog = () => ({ ...emptyCatalog(), revision: 'demo', cabinets: [{ id: 'idf-1', name: 'IDF 1' }], assets: ['idf', 'ap', 'cctv'].map((dataset, i) => ({ id: `example-${i}`, dataset, name: ['Switch de ejemplo', 'AP de ejemplo', 'Cámara de ejemplo'][i], idf_id: 'idf-1', kind: 'equipment', version: 'demo:0', model: 'Modelo de ejemplo', serial: `EJEMPLO-${i}`, mac: '', documented_ip: '', location: 'Ubicación ficticia', issues: [], source: { file: 'Demostración', table: 1, row: i + 1 }, relocated: false, destination: '' })) });

function AssetForm({ asset, cabinets, onSave, onDirty, onBusy, onCancel }) {
  const camera = asset.dataset === 'cctv';
  const form = useForm({ name: asset.name || '', idf_id: asset.idf_id || '', location: asset.location || '', rack: asset.rack || '', ports: asset.ports || '', notes: asset.notes || '', ...(camera ? { relocated: asset.relocated || false, destination: asset.destination || '' } : {}) }, values => {
    const errors = {};
    if (!values.name.trim()) errors.name = 'Indica una descripción del recurso.';
    if (camera && Boolean(values.destination.trim()) !== values.relocated) errors.destination = 'Indica el destino si la cámara fue reubicada; en caso contrario, deja el campo vacío.';
    return errors;
  }, onSave, onDirty);
  useEffect(() => { onBusy(form.busy); return () => onBusy(false); }, [form.busy, onBusy]);
  const field = (key, label) => <Field key={key} label={label} error={form.errors[key]} required={key === 'name'}><input value={form.values[key]} maxLength={240} onChange={e => form.change(key, e.target.value)} /></Field>;
  return <form noValidate ref={form.form} onSubmit={form.submit} aria-busy={form.busy}>
    <Notice title="Corrección del inventario físico">La fuente original se conserva. Las direcciones IP y el estado actual provienen del cotejo con las APIs.</Notice>
    {form.error && <Notice title={form.uncertain ? 'Guardado sin confirmar' : 'No se pudo guardar'} tone="danger">{form.error}</Notice>}
    <fieldset disabled={form.busy || form.uncertain}><div className="form-grid">
      {field('name', 'Descripción')}
      <Field label="Gabinete" error={form.errors.idf_id}><select value={form.values.idf_id} onChange={e => form.change('idf_id', e.target.value)}><option value="">Sin asignar</option>{cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      {field('location', 'Ubicación física')}{field('rack', 'Rack')}{field('ports', 'Puertos / Capacidad')}
      {camera && <><Field label="Reubicación"><select value={String(form.values.relocated)} onChange={e => form.change('relocated', e.target.value === 'true')}><option value="false">Sin reubicación confirmada</option><option value="true">Reubicada</option></select></Field>{field('destination', 'Destino de reubicación')}</>}
      <div className="col-span-full"><Field label="Notas de la corrección"><textarea className="resize-none" rows={3} maxLength={1000} value={form.values.notes} onChange={e => form.change('notes', e.target.value)} /></Field></div>
    </div></fieldset>
    <div className="form-actions"><Button onClick={onCancel} disabled={form.busy}>Cancelar</Button><Button type="submit" variant="primary" icon={Save} busy={form.busy} disabled={form.uncertain}>Guardar corrección</Button></div>
  </form>;
}

export function DocumentaryInventory({ route, demo, navigate, canWrite, canExport, mutate, notify, onDirty, openEditor, data }) {
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
  const generation = useRef(0);
  const state = useListState(`documentos-${route}`);
  const defaultDataset = route === 'cctv' ? 'cctv' : route === 'aps' ? 'ap' : 'idf';
  const dataset = route === 'cctv' && state.filters.dataset === 'cctv_original' ? 'cctv_original' : defaultDataset;
  useEffect(() => {
    setNetwork(null); setNetworkError('');
    if (demo) { setCatalog(demoCatalog()); setError(''); setLoading(false); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => controller.abort(), 12000);
    request('/api/inventory/catalog', { signal: controller.signal }).then(result => {
      if (active && !controller.signal.aborted) setCatalog(result);
    }).catch(e => { if (active) setError(e.name === 'AbortError' ? 'La consulta tardó demasiado. Vuelve a intentar.' : e.message); }).finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [demo, revision]);
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
  const rows = catalog.assets.filter(a => a.dataset === dataset).map(a => ({ ...a,
    idf: catalog.cabinets.find(c => c.id === a.idf_id)?.name || 'Sin asignar',
    kindLabel: a.kind === 'rack' ? 'Rack / Contenedor' : 'Equipo / Componente',
    comparison: comparisonLabels[network?.assets[a.id]?.comparison || 'pending'],
    current_ip: network?.assets[a.id]?.ip || '', status: network?.assets[a.id]?.status || 'unknown',
    relocation: a.destination && !a.relocated ? 'Por confirmar' : a.relocated ? 'Reubicada' : 'Sin reubicación',
    issuesText: (a.issues || []).join(' · '), sourceText: sourceLabel(a.source),
  }));
  const columns = [{ key: 'name', label: 'Recurso' }, { key: 'idf', label: 'Gabinete' },
    { key: 'location', label: 'Ubicación' }, { key: 'model', label: 'Modelo' },
    { key: 'documented_ip', label: 'IP documentada' }, { key: 'current_ip', label: 'IP observada en API' },
    { key: 'comparison', label: 'Cotejo' }, { key: 'status', label: 'Estado API', render: a => <Badge status={a.status} /> },
    { key: 'actions', label: 'Acciones', sortable: false, render: a => <Button onClick={() => setModal({ type: 'detail', asset: a })}>Ver ficha</Button> }];
  const save = async fields => {
    const asset = modal.asset;
    generation.current++; requestRef.current?.abort(); setChecking(false);
    const result = demo ? { asset: { ...asset, ...fields, documented: asset.documented || asset, corrected_at: new Date().toISOString() } } : await mutate('/api/inventory/asset', { id: asset.id, version: asset.version, fields });
    setCatalog(old => ({ ...old, assets: old.assets.map(a => a.id === asset.id ? result.asset : a) }));
    setNetwork(null); markDirty(false); setModal(null);
    notify(demo ? 'Corrección de ejemplo guardada en esta sesión.' : 'Corrección física guardada. La fuente original se conserva.');
  };
  const selected = modal?.asset;
  const title = route === 'cctv' ? 'Inventario CCTV' : route === 'aps' ? 'Inventario de access points' : 'Inventario documental de IDF';
  return <>
    <PageHeading eyebrow="Inventario físico y cotejo de red" title={title} description="Datos documentados, correcciones físicas y observaciones actuales de las APIs" updatedAt={catalog.imported_at} />
    <InventoryTabs current={route} navigate={navigate} />
    <Notice title="La documentación no acredita el estado actual">La IP y el estado observados se muestran solo cuando existe una coincidencia de identidad con las APIs. Un equipo sin coincidencia no se considera dado de baja.</Notice>
    <section className="metric-grid"><Metric icon={route === 'cctv' ? Camera : route === 'aps' ? Wifi : Server} label="Registros documentados" value={number(rows.length)} caption={dataset === 'cctv_original' ? 'catálogo histórico' : 'catálogo seleccionado'} /><Metric icon={Server} label="Racks / Contenedores" value={number(rows.filter(r => r.kind === 'rack').length)} caption="separados de los equipos" /><Metric icon={TriangleAlert} label="Con observaciones de datos" value={number(rows.filter(r => r.issues?.length).length)} caption="revisar en la ficha" /><Metric icon={RefreshCw} label="Identidades cotejadas" value={number(rows.filter(r => ['matched', 'changed'].includes(network?.assets[r.id]?.comparison)).length)} caption="en la consulta de APIs" /></section>
    <div className="toolbar">
      {route === 'cctv' && <Select label="Fuente CCTV" value={dataset} onChange={e => state.setFilter('dataset', e.target.value)}><option value="cctv">Actualizadas</option><option value="cctv_original">Originales</option></Select>}
      <Select label="Gabinete documental" value={state.filters.idf_id || ''} onChange={e => state.setFilter('idf_id', e.target.value)}><option value="">Todos los gabinetes</option>{catalog.cabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      {route === 'cctv' && dataset === 'cctv' && <Select label="Reubicación" value={state.filters.relocation || ''} onChange={e => state.setFilter('relocation', e.target.value)}><option value="">Todas</option><option>Reubicada</option><option>Por confirmar</option><option>Sin reubicación</option></Select>}
      <SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar descripción, serie, MAC o ubicación…" />
      <Button icon={RefreshCw} busy={loading} disabled={busy || checking} onClick={reload}>Actualizar catálogo</Button>
      <Button variant="primary" busy={checking} disabled={demo || loading || Boolean(error) || !catalog.assets.length} onClick={check}>Cotejar APIs</Button>
    </div>
    {networkError && <Notice title="No se pudo completar el cotejo" tone="warning">{networkError}</Notice>}
    {network && <Notice title={network.sources.every(s => s.available) ? 'Cotejo realizado' : 'Cotejo parcial · Fuentes no disponibles'} tone={network.sources.every(s => s.available) ? 'info' : 'warning'}>{network.sources.map(s => `${s.provider === 'forti' ? 'FortiGate' : 'OmniVista'}: ${s.available ? `${s.count} registros consultados` : 'no disponible'} · ${dateTime(s.observed_at)}`).join(' / ')}. {network.scope} {network.only_api.length} registros de API sin vínculo confirmado con el catálogo.</Notice>}
    <DataTable title={title} rows={rows} columns={columns} state={{ ...state, filters: { ...state.filters, ...(dataset === 'cctv_original' ? { relocation: '' } : {}) } }} loading={loading} error={error} onRetry={reload} exportable={canExport} />
    <Button disabled={loading || Boolean(error)} onClick={() => setModal({ type: 'sources' })}>Fuentes y discrepancias documentales</Button>
    {network?.only_api.length > 0 && <Button onClick={() => setModal({ type: 'unlinked' })}>Ver registros de API sin vínculo confirmado</Button>}
    <Dialog open={Boolean(modal)} onClose={close} title={modal?.type === 'edit' ? 'Corregir datos físicos' : modal?.type === 'unlinked' ? 'API sin vínculo confirmado' : modal?.type === 'sources' ? 'Fuentes documentales' : 'Ficha del recurso'} wide busy={busy}>
      {discard && <Notice title="¿Descartar los cambios sin guardar?" tone="warning" action={<><Button autoFocus onClick={() => setDiscard(false)}>Seguir editando</Button><Button variant="danger" onClick={() => { markDirty(false); setDiscard(false); setModal(null); }}>Descartar</Button></>}>La fuente original y las correcciones guardadas se conservan.</Notice>}
      {modal?.type === 'edit' && <AssetForm key={selected.id} asset={selected} cabinets={catalog.cabinets} onSave={save} onDirty={markDirty} onBusy={setBusy} onCancel={close} />}
      {modal?.type === 'detail' && <>
        <dl className="detail-grid">{Object.entries({ Descripción: selected.name, Gabinete: selected.idf, Tipo: selected.kindLabel, Rack: selected.rack, Ubicación: selected.location, Modelo: selected.model, Serie: selected.serial, MAC: selected.mac, Puertos: selected.ports, 'IP documentada': selected.documented_ip, 'IP observada en API': selected.current_ip, Cotejo: selected.comparison, 'Última corrección': selected.corrected_at ? dateTime(selected.corrected_at) : 'Sin correcciones', Reubicación: selected.dataset === 'cctv' ? selected.relocation : 'No aplica', Destino: selected.destination, Fuente: selected.sourceText }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || 'No informado'}</dd></div>)}</dl>
        {selected.issuesText && <Notice title="Observaciones de la fuente" tone="warning">{selected.issuesText}</Notice>}
        {selected.documented && selected.corrected_at && <Notice title="Valores originales conservados">Ubicación: {selected.documented.location || 'no informada'}. Gabinete: {selected.documented.idf_id || 'sin asignar'}. Destino: {selected.documented.destination || 'no informado'}.</Notice>}
        {(network?.assets[selected.id]?.observations || []).map((o, i) => <Notice key={i} title={`Observación de ${o.provider}`}>IP: {o.ip || 'no informada'} · Estado: {o.status} · Interfaz: {o.interface || 'no informada'} · {dateTime(o.observed_at)}</Notice>)}
        {catalog.observations.filter(o => o.idf_id === selected.idf_id).length > 0 && <><h3>Observaciones históricas del gabinete</h3><ul>{catalog.observations.filter(o => o.idf_id === selected.idf_id).map((o, i) => <li key={i}>{o.text}</li>)}</ul></>}
        <div className="form-actions">
          {data.idfs.some(c => c.id === selected.idf_id) && <Button onClick={() => { setModal(null); openEditor('qr', data.idfs.find(c => c.id === selected.idf_id)); }}>Código QR del gabinete</Button>}
          {canWrite && selected.dataset !== 'cctv_original' && <Button variant="primary" onClick={() => setModal({ type: 'edit', asset: selected })}>Corregir datos físicos</Button>}
        </div>
      </>}
      {modal?.type === 'unlinked' && <Unlinked rows={network?.only_api || []} canExport={canExport} />}
      {modal?.type === 'sources' && <Sources catalog={catalog} canExport={canExport && !demo} />}
    </Dialog>
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
  return <DataTable title="Registros de API sin vínculo confirmado" rows={rows} state={state} columns={[{ key: 'provider', label: 'API' }, { key: 'name', label: 'Equipo' }, { key: 'ip', label: 'IP observada' }, { key: 'mac', label: 'MAC' }, { key: 'model', label: 'Modelo' }]} toolbar={<SearchField value={state.query} onChange={state.setQuery} />} exportable={canExport} />;
}
