import React, { useMemo } from 'react';
import { Users, UserRoundCheck, UserRoundX, UserRoundSearch, UserRoundPlus, UserRoundMinus, UsersRound, CalendarClock, CalendarCheck2, CalendarX2, CalendarDays, CalendarSearch, FileText, ShieldCheck, ShieldQuestion, Building2, Trophy, Layers3, Monitor, MonitorSmartphone, Smartphone, Laptop, Terminal, CircleHelp, Link2, Unlink, Network } from 'lucide-react';
import { DashboardWidgets, WidgetCard } from './dashboard-widgets.jsx';
import { Notice } from './components.jsx';
import { number } from './domain.mjs';
import { useSession } from './session.jsx';
import { ALTAS_WIDGET_CATALOG, ALTAS_DEFAULT_LAYOUT, PLATFORM_LABELS, buildAltasAnalytics, migrateAltasWidgetLayout } from './altas-analytics.mjs';

const LIST_KINDS = new Set(['ranking', 'platforms', 'types', 'departments', 'profiles', 'statuses']);
const widgetGroup = widget => LIST_KINDS.has(widget.kind) ? 'Listas de gestión de altas' : 'Indicadores de gestión de altas';

const TYPE_LABELS = { mobile: 'Móviles y tabletas', computers: 'Computadoras', printers: 'Impresoras', other: 'Otros / no identificados' };

function widgetTone(widget, stats) {
  if (widget.metric === 'inactive-by-crosscheck') return 'brand';
  if (widget.metric === 'activity-unverified') return 'slate';
  if (widget.metric === 'expired') return stats.counts.expired > 0 ? 'danger' : 'success';
  if (widget.metric === 'expiring24') return stats.counts.expiring24 > 0 ? 'orange' : 'success';
  if (['expiring7', 'no-expiry'].includes(widget.metric)) return stats.counts[widget.metric] > 0 ? 'amber' : 'success';
  if (['active', 'valid'].includes(widget.metric)) return 'success';
  return catalogWidgetTone(widget);
}

// One visual identity per indicator, shared by the catalog and placed cards.
const METRIC_ICONS = {
  accounts: Users, temporary: CalendarClock, oficios: FileText, valid: CalendarCheck2,
  expiring24: CalendarClock, expiring7: CalendarDays, expired: CalendarX2,
  'no-expiry': CalendarSearch, 'non-temporary': ShieldCheck,
  active: UserRoundCheck, inactive: UserRoundX, 'inactive-by-crosscheck': UserRoundMinus, 'activity-unverified': ShieldQuestion, 'unknown-status': UserRoundSearch,
  'with-devices': Link2, 'without-devices': UserRoundMinus,
  'multiple-devices': UsersRound, 'five-devices': Network,
};
const KIND_ICONS = { ranking: Trophy, platforms: Layers3, types: MonitorSmartphone,
  departments: Building2, profiles: ShieldCheck, devices: Network,
  unassociated: Unlink, recent: UserRoundPlus };
const PLATFORM_ICONS = { android: Smartphone, ios: Smartphone, windows: Monitor,
  macos: Laptop, linux: Terminal, unknown: CircleHelp };
function catalogWidgetIcon(widget) {
  return widget.kind === 'metric' ? METRIC_ICONS[widget.metric] || ShieldQuestion
    : widget.kind === 'platform' ? PLATFORM_ICONS[widget.platform] || Monitor
    : KIND_ICONS[widget.kind] || Users;
}
function catalogWidgetTone(widget) {
  if (widget.kind === 'statuses') return 'purple';
  if (['multiple-devices', 'with-devices', 'without-devices'].includes(widget.metric)) return 'blue';
  if (widget.metric === 'activity-unverified') return 'slate';
  if (widget.kind === 'ranking') return 'amber';
  if (['platform', 'platforms'].includes(widget.kind)) return 'blue';
  if (widget.kind === 'profiles') return 'purple';
  if (['departments', 'recent'].includes(widget.kind)) return 'teal';
  if (['types', 'devices', 'unassociated'].includes(widget.kind)) return 'cyan';
  if (['active', 'valid'].includes(widget.metric)) return 'success';
  if (widget.metric === 'expired') return 'danger';
  if (['expiring24', 'expiring7', 'no-expiry'].includes(widget.metric)) return 'orange';
  return widget.scope === 'oficios' ? 'purple' : 'brand';
}

function AnalyticsCard({ widget, stats, sources, loading, error, onFilter, onRefresh, updatedAt, demo }) {
  const Icon = catalogWidgetIcon(widget);
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
  if (widget.kind === 'statuses') rows = [['active', 'Activas'], ['inactive', 'Inactivas'], ['unknown-status', 'Sin estado informado']].map(([id, label]) => ({ label, count: stats.counts[id], filter: { id, label } }));
  if (widget.kind === 'types') rows = Object.entries(stats.types).filter(([, count]) => count > 0).map(([key, count]) => ({ label: TYPE_LABELS[key], count, filter: { id: 'type', value: key, label: TYPE_LABELS[key] } }));
  if (['departments', 'profiles'].includes(widget.kind)) rows = stats[widget.kind].slice(0, 8).map(([key, count]) => ({ label: key || (widget.kind === 'departments' ? 'Sin departamento' : 'Sin perfil'), count, filter: { id: widget.kind === 'departments' ? 'department' : 'accessRoleProfile', value: key, label: key || (widget.kind === 'departments' ? 'Sin departamento' : 'Sin perfil') } }));
  const max = Math.max(1, ...(rows || []).map(row => row.count));
  if (rows) return <article className={`network-pressure altas-compact-list altas-list-${widget.kind} widget-tone-${loading || error ? 'slate' : widgetTone(widget, stats)}`} data-kind={widget.id} aria-label={widget.title} aria-busy={loading}>
    <div className="network-pressure-header"><span className="widget-heading-icon"><Icon size={21} strokeWidth={1.7} aria-hidden="true" /></span><h3>{widget.title}</h3></div>
    {loading ? <p className="widget-empty">Cargando…</p> : error ? <p className="widget-empty">Consulta no disponible.</p> : rows.length ? <div className="altas-compact-scroll" tabIndex={0} role="region" aria-label={`Listado de ${widget.title}`}><ol>
      {rows.map((row, index) => {
        const RowIcon = widget.kind === 'platforms' ? PLATFORM_ICONS[row.filter.value] || Monitor : widget.kind === 'types' ? MonitorSmartphone : widget.kind === 'departments' ? Building2 : ShieldCheck;
        return <li key={row.filter.value || row.filter.id}><button type="button" disabled={!onFilter} onClick={() => onFilter?.(row.filter)} aria-label={`Filtrar ${row.label}`} title={[row.label, row.detail].filter(Boolean).join(' · ')}>
        <span className="altas-row-label">{widget.kind === 'ranking' ? <em className={`altas-rank rank-${index + 1}`}>{String(index + 1).padStart(2, '0')}</em> : <span className="altas-row-symbol"><RowIcon size={15} aria-hidden="true" /></span>}<strong>{row.label}</strong></span><span className="altas-compact-quantity"><i aria-hidden="true"><em style={{ width: `${row.count / max * 100}%` }} /></i><b>{number(row.count)}</b></span>
      </button></li>; })}
    </ol></div> : <p className="widget-empty">Sin datos disponibles.</p>}
  </article>;
  return <WidgetCard title={widget.title} module="Gestión de altas" Icon={Icon} tone={loading || error ? 'slate' : widgetTone(widget, stats)} kind={widget.id} className="altas-analytics-widget" loading={loading} updatedAt={updatedAt} demo={demo} onRefresh={onRefresh} footerAction={filter && onFilter ? { label: 'Filtrar cuentas', onClick: () => onFilter(filter) } : null}>
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
    <DashboardWidgets migrateLayout={migrateAltasWidgetLayout} groupBy={widgetGroup} catalog={catalog} catalogTone={catalogWidgetTone} catalogIcon={catalogWidgetIcon} defaultLayout={defaultLayout} storagePrefix="sgrs:altas-widgets:v1" title="Indicadores de gestión de altas" personalizeLabel="Personalizar indicadores" demo={demo} userId={`${session.user?.id}:${session.user?.role}`}>
      {catalog.map(widget => <AnalyticsCard key={widget.id} data-widget-id={widget.id} widget={widget} stats={stats} sources={sources} loading={loading} error={error} onFilter={onFilter} onRefresh={onRefresh} updatedAt={updatedAt} demo={demo} />)}
    </DashboardWidgets>
  </section>;
}

