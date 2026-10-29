import React, { useEffect, useState } from 'react';
import { Network, RefreshCw } from 'lucide-react';
import { Button, DataTable, Dialog, Loading, Notice, SearchField, Select, useListState } from './components.jsx';
import { PageHeading } from './pages.jsx';
import { request } from './domain.mjs';

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/pass|secret|token|credential|authorization|psk|private.?key|api.?key/i.test(key)).map(([key, item]) => [key, clean(item)]));
  return value;
}
function display(value) {
  if (value == null || value === '') return 'No informado';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.map(display).join(' · ') || 'Sin elementos';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${display(item)}`).join(' · ');
  return String(value);
}
function rowsFrom(data, collection) {
  const value = collection ? data?.[collection] : data;
  if (value == null) throw new Error('La API no entregó la colección esperada.');
  if (Array.isArray(value)) return value.map((row, index) => ({ ...(row && typeof row === 'object' ? row : { value: row }), _key: index }));
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => ({ field: key, value: item, _key: key }));
  throw new Error('La API entregó un formato no compatible.');
}
export function useTelemetryCatalog(enabled) {
  const [state, setState] = useState({ modules: [], loading: false, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ modules: [], loading: false, error: '' }); return; }
    const controller = new AbortController(); let alive = true;
    setState(old => ({ ...old, loading: true, error: '' }));
    request('/api/admin/catalog', { signal: controller.signal }).then(value => {
      if (!Array.isArray(value.modules)) throw new Error('No se pudo interpretar el catálogo.');
      if (alive) setState({ modules: value.modules, loading: false, error: '' });
    }).catch(error => { if (alive) setState({ modules: [], loading: false, error: error.message }); });
    return () => { alive = false; controller.abort(); };
  }, [enabled, revision]);
  return { ...state, retry: () => setRevision(value => value + 1) };
}
export function TelemetryNav({ modules, route, navigate }) {
  return <nav className="main-nav" aria-label="Consultas de red">{modules.map(module => <a key={module.id} href={`#consulta/${module.id}`} aria-current={route === `consulta/${module.id}` ? 'page' : undefined} onClick={event => { if (!event.ctrlKey && !event.metaKey) { event.preventDefault(); navigate(`consulta/${module.id}`); } }}><Network size={20} aria-hidden="true" /><span>{module.title}</span></a>)}</nav>;
}
function ResourceTable({ resource }) {
  const state = useListState(`consulta-${resource.id}`);
  const [result, setResult] = useState({ rows: [], loading: true, error: '', updatedAt: null });
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setResult(old => ({ ...old, loading: true, error: '' }));
    request(resource.path, { signal: controller.signal }).then(response => {
      if (response.success === false || response.error) throw new Error('La API no pudo confirmar la consulta.');
      const rows = rowsFrom(clean(response.data), resource.collection);
      if (alive) setResult({ rows, loading: false, error: '', updatedAt: new Date().toISOString() });
    }).catch(error => { if (alive) setResult(old => ({ ...old, loading: false, error: error.message })); });
    return () => { alive = false; controller.abort(); };
  }, [resource.path, resource.collection, revision]);
  const fields = resource.columns.length ? resource.columns : result.rows.some(row => !('field' in row)) ? [{ key: '_key', label: 'Registro' }] : [{ key: 'field', label: 'Campo' }, { key: 'value', label: 'Información' }];
  const columns = fields.map(column => ({ ...column, value: row => display(row[column.key]), render: row => <span className="telemetry-value">{display(row[column.key])}</span> }));
  columns.push({ key: 'actions', label: 'Detalle', sortable: false, render: row => <Button onClick={() => setSelected(row)}>Ver campos</Button> });
  return <>
    <PageHeading eyebrow="Consulta de solo lectura" title={resource.title} description={resource.note} updatedAt={result.updatedAt}><Button icon={RefreshCw} busy={result.loading} onClick={() => setRevision(value => value + 1)}>Actualizar consulta</Button></PageHeading>
    <Notice title="Alcance de la información">Origen: {resource.path.startsWith('/api/admin/') ? 'Histórico local de métricas agregadas' : resource.path.startsWith('/api/forti/') ? 'FortiGate' : 'OmniVista'}. La búsqueda, ordenación y exportación abarcan únicamente los registros recibidos. No se realizan cambios en los equipos.</Notice>
    <DataTable title={resource.title} rows={result.rows} onRowClick={setSelected} columns={columns} state={state} rowKey="_key" loading={result.loading} error={result.error} onRetry={() => setRevision(value => value + 1)} exportable={!result.loading && !result.error} toolbar={<SearchField defer value={state.query} onChange={state.setQuery} label="Buscar en registros recibidos" placeholder="Buscar en esta consulta…" />} emptyText="El proveedor devolvió una colección vacía para esta consulta." />
    <Dialog open={Boolean(selected)} title={`Detalle · ${resource.title}`} onClose={() => setSelected(null)} wide><dl className="detail-grid">{selected && Object.entries(selected).filter(([key]) => key !== '_key').map(([key, value]) => <div key={key}><dt>{resource.columns.find(column => column.key === key)?.label || key}</dt><dd className="telemetry-detail-value">{display(value)}</dd></div>)}</dl></Dialog>
  </>;
}
export function TelemetryPage({ catalog, moduleId, resourceId, navigate }) {
  const module = catalog.modules.find(item => item.id === moduleId);
  const resource = module?.resources.find(item => item.id === resourceId) || module?.resources[0];
  useEffect(() => { document.title = `${module?.title || 'Consultas de red'} · Centro Operativo SGRS`; }, [module]);
  if (catalog.loading) return <Loading />;
  if (catalog.error) return <Notice title="No se pudo cargar la navegación" tone="danger" action={<Button onClick={catalog.retry}>Reintentar</Button>}>{catalog.error}</Notice>;
  if (!module) return <PageHeading eyebrow="Error 404" title="Consulta no encontrada" description="Selecciona una sección disponible en la navegación." />;
  return <><div className="telemetry-selector"><Select label={module.title} value={resource.id} onChange={event => navigate(`consulta/${module.id}?recurso=${encodeURIComponent(event.target.value)}`)}>{module.resources.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></div><ResourceTable key={`${module.id}-${resource.id}`} resource={resource} /></>;
}
