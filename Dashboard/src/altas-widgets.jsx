import React, { useMemo } from 'react';
import { Clock3, Monitor, Users } from 'lucide-react';
import { DashboardWidgets, WidgetCard } from './dashboard-widgets.jsx';
import { Notice } from './components.jsx';
import { number } from './domain.mjs';
import { useSession } from './session.jsx';
import { ALTAS_WIDGET_CATALOG, ALTAS_DEFAULT_LAYOUT, PLATFORM_LABELS, buildAltasAnalytics } from './altas-analytics.mjs';

const LIST_KINDS = new Set(['ranking', 'platforms', 'types', 'departments', 'profiles']);
const widgetGroup = widget => LIST_KINDS.has(widget.kind) ? 'Listas de gestión de altas' : 'Indicadores de gestión de altas';

const TYPE_LABELS = { mobile: 'Móviles y tabletas', computers: 'Computadoras', printers: 'Impresoras', other: 'Otros / no identificados' };

function widgetTone(widget, stats) {
  if (widget.metric === 'expired') return stats.counts.expired > 0 ? 'danger' : 'success';
  if (widget.metric === 'expiring24') return stats.counts.expiring24 > 0 ? 'orange' : 'success';
  if (['expiring7', 'no-expiry'].includes(widget.metric)) return stats.counts[widget.metric] > 0 ? 'amber' : 'success';
  if (['active', 'valid'].includes(widget.metric)) return 'success';
  return catalogWidgetTone(widget);
}

function catalogWidgetTone(widget) {
  if (widget.kind === 'platform') return { android: 'success', ios: 'cyan', windows: 'blue', macos: 'purple', linux: 'amber', unknown: 'slate' }[widget.platform];
  if (widget.metric) return ({
    accounts: 'blue', temporary: 'purple', oficios: 'indigo', valid: 'success', expiring24: 'orange',
    expiring7: 'amber', expired: 'danger', 'no-expiry': 'slate', 'non-temporary': 'blue', active: 'teal',
    inactive: 'danger', 'unknown-status': 'slate', 'with-devices': 'teal', 'without-devices': 'amber',
    'multiple-devices': 'cyan', 'five-devices': 'indigo',
  })[widget.metric] || 'brand';
  if (widget.kind === 'ranking') return 'indigo';
  if (widget.kind === 'platforms') return 'cyan';
  if (widget.kind === 'types' || widget.kind === 'devices') return 'teal';
  if (widget.kind === 'departments' || widget.kind === 'recent') return 'blue';
  if (widget.kind === 'profiles') return 'purple';
  if (widget.kind === 'unassociated') return 'amber';
  return 'brand';
}

function AnalyticsCard({ widget, stats, sources, loading, error, onFilter, onRefresh, updatedAt, demo }) {
  const Icon = ['platform', 'devices', 'types', 'platforms', 'ranking'].includes(widget.kind) ? Monitor : widget.scope === 'oficios' ? Clock3 : Users;
  let value;
  let filter;
  let rows;
  if (widget.kind === 'metric') { value = stats.counts[widget.metric]; filter = { id: widget.metric, label: widget.title }; }
  if (widget.kind === 'platform') { value = stats.platforms[widget.platform]; filter = { id: 'platform', value: widget.platform, label: widget.title }; }
  if (widget.kind === 'devices') { value = stats.deviceCount; filter = { id: 'with-devices', label: 'Cuentas con dispositivos asociados' }; }
  if (widget.kind === 'unassociated') value = sources.company_properties?.complete === true && Number.isFinite(sources.company_properties.unassociated) ? sources.company_properties.unassociated : null;
  if (widget.kind === 'recent') { value = stats.recent; filter = { id: 'recent', label: widget.title }; }
  if (widget.kind === 'ranking') rows = stats.ranking.slice(0, 8).map(user => ({ label: user.username, detail: user.fullName, count: user.count, filter: { id: 'username', value: user.username, label: `Cuenta ${user.username}` } }));
  if (widget.kind === 'platforms') rows = Object.entries(stats.platforms).filter(([, count]) => count > 0).map(([key, count]) => ({ label: PLATFORM_LABELS[key], count, filter: { id: 'platform', value: key, label: `Dispositivos ${PLATFORM_LABELS[key]}` } }));
  if (widget.kind === 'types') rows = Object.entries(stats.types).filter(([, count]) => count > 0).map(([key, count]) => ({ label: TYPE_LABELS[key], count, filter: { id: 'type', value: key, label: TYPE_LABELS[key] } }));
  if (['departments', 'profiles'].includes(widget.kind)) rows = stats[widget.kind].slice(0, 8).map(([key, count]) => ({ label: key || (widget.kind === 'departments' ? 'Sin departamento' : 'Sin perfil'), count, filter: { id: widget.kind === 'departments' ? 'department' : 'accessRoleProfile', value: key, label: key || (widget.kind === 'departments' ? 'Sin departamento' : 'Sin perfil') } }));
  const max = Math.max(1, ...(rows || []).map(row => row.count));
  if (rows) return <article className={`network-pressure altas-compact-list widget-tone-${loading || error ? 'slate' : widgetTone(widget, stats)}`} data-kind={widget.id} aria-label={widget.title} aria-busy={loading}>
    <div className="network-pressure-header"><h3>{widget.title}</h3></div>
    {loading ? <p className="widget-empty">Cargando…</p> : error ? <p className="widget-empty">Consulta no disponible.</p> : rows.length ? <div className="altas-compact-scroll" tabIndex={0} role="region" aria-label={`Listado de ${widget.title}`}><ol>
      {rows.map(row => <li key={row.filter.value}><button type="button" disabled={!onFilter} onClick={() => onFilter?.(row.filter)} aria-label={`Filtrar ${row.label}`} title={[row.label, row.detail].filter(Boolean).join(' · ')}>
        <span><strong>{row.label}</strong></span><span className="altas-compact-quantity"><i aria-hidden="true"><em style={{ width: `${row.count / max * 100}%` }} /></i><b>{number(row.count)}</b></span>
      </button></li>)}
    </ol></div> : <p className="widget-empty">Sin datos disponibles.</p>}
  </article>;
  return <WidgetCard title={widget.title} module="Gestión de altas" Icon={Icon} tone={loading || error ? 'slate' : widgetTone(widget, stats)} kind={widget.id} className={`altas-analytics-widget${rows ? ' altas-list-widget' : ''}`}  loading={loading} updatedAt={updatedAt} demo={demo} onRefresh={onRefresh} footerAction={filter && onFilter ? { label: 'Filtrar cuentas', onClick: () => onFilter(filter) } : null}>
      {
        filter ? <button type="button" className="altas-widget-value" disabled={loading || Boolean(error) || !onFilter} onClick={() => onFilter?.(filter)} aria-label={`Filtrar ${widget.title}`}><strong>{loading || error ? '—' : number(value)}</strong><span>{widget.description}</span>{onFilter && <small>Filtrar cuentas</small>}</button> :
        <div className="altas-widget-value"><strong>{loading || error || value == null ? '—' : number(value)}</strong><span>{value == null ? 'Requiere un catálogo de terminales completo.' : widget.description}</span></div>}
  </WidgetCard>;
}

export function AltasWidgets({ users, sources = {}, now, demo, loading, error, onFilter, onRefresh, updatedAt, canViewAll, canViewOficios }) {
  const session = useSession();
  const stats = useMemo(() => buildAltasAnalytics(users, now), [users, now]);
  const catalog = useMemo(() => ALTAS_WIDGET_CATALOG.filter(widget => widget.scope === 'all' ? canViewAll : canViewOficios).sort((a, b) => Number(LIST_KINDS.has(b.kind)) - Number(LIST_KINDS.has(a.kind))), [canViewAll, canViewOficios]);
  const allowed = new Set(catalog.map(widget => widget.id));
  const defaultLayout = ALTAS_DEFAULT_LAYOUT.filter(widget => allowed.has(widget.id));
  return <section className="altas-analytics" aria-label="Indicadores de gestión de altas">
    {(sources.users?.complete === false || sources.company_properties?.complete === false) && <Notice title="Consulta parcial" tone="warning">Los indicadores se calculan con los registros recibidos. Los dispositivos sin cuenta solo se muestran cuando la consulta de terminales está completa.</Notice>}
    <DashboardWidgets groupBy={widgetGroup} catalog={catalog} catalogTone={catalogWidgetTone} defaultLayout={defaultLayout} storagePrefix="sgrs:altas-widgets:v1" title="Indicadores de gestión de altas" personalizeLabel="Personalizar indicadores" demo={demo} userId={`${session.user?.id}:${session.user?.role}`}>
      {catalog.map(widget => <AnalyticsCard key={widget.id} data-widget-id={widget.id} widget={widget} stats={stats} sources={sources} loading={loading} error={error} onFilter={onFilter} onRefresh={onRefresh} updatedAt={updatedAt} demo={demo} />)}
    </DashboardWidgets>
  </section>;
}
