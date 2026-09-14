import React, { useEffect, useId, useRef, useState } from 'react';
import { Search, X, ChevronLeft, ChevronRight, ArrowDownUp, Download, Info, RefreshCw, LoaderCircle, Eye, EyeOff } from 'lucide-react';
import { makeCsv, number, paginate, selectRows, statusNames, statusTone } from './domain.mjs';

export function Button({ children, icon: Icon, variant = 'secondary', busy = false, className = '', ...props }) {
  return <button type="button" {...props} disabled={props.disabled || busy} aria-busy={busy || undefined} className={`button button-${variant} ${className}`}>
    {busy ? <LoaderCircle size={18} className="spinner" aria-hidden="true" /> : Icon && <Icon size={18} aria-hidden="true" />}{children}
  </button>;
}
export function IconButton({ icon: Icon, label, onClick, ...props }) {
  return <button type="button" {...props} onClick={onClick} className={`icon-button ${props.className || ''}`} aria-label={label} title={label}><Icon size={20} aria-hidden="true" /></button>;
}
export function Badge({ status, children }) {
  return <span className={`badge badge-${statusTone(status)}`}><span className="badge-dot" aria-hidden="true" />{children || statusNames[status] || status || 'Sin verificar'}</span>;
}
export function SearchField({ value, onChange, placeholder = 'Buscar…', label = 'Buscar registros' }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <div className="search-field"><Search size={19} aria-hidden="true" />
    <input ref={ref} type="search" value={draft} aria-label={label} placeholder={placeholder}
      onChange={e => { setDraft(e.target.value); if (!e.nativeEvent.isComposing) onChange(e.target.value); }}
      onCompositionEnd={e => onChange(e.currentTarget.value)} />
    {draft && <IconButton icon={X} label="Limpiar búsqueda" onClick={() => { setDraft(''); onChange(''); ref.current?.focus(); }} />}
  </div>;
}
export function Select({ label, children, className = '', ...props }) {
  const id = useId();
  return <div className={`select-field ${className}`}><label htmlFor={id}>{label}</label><select id={id} {...props}>{children}</select></div>;
}
export function Field({ label, error, hint, children, required = false, icon: Icon }) {
  const id = useId();
  const control = React.cloneElement(children, { id, required, 'aria-invalid': Boolean(error), 'aria-describedby': `${id}-help` });
  return <div className="field"><label htmlFor={id}>{label}{required && <span className="required"> *</span>}</label>
    {Icon ? <div className="field-with-icon"><Icon size={18} aria-hidden="true" />{control}</div> : control}
    <small id={`${id}-help`} className={`field-help ${error ? 'field-error' : ''}`}>{error || hint || '\u00a0'}</small>
  </div>;
}
export function SecretInput({ label = 'contraseña', ...props }) {
  const [visible, setVisible] = useState(false);
  return <div className="secret-input"><input {...props} type={visible ? 'text' : 'password'} spellCheck={false} /><IconButton icon={visible ? EyeOff : Eye} label={`${visible ? 'Ocultar' : 'Mostrar'} ${label}`} aria-pressed={visible} disabled={props.disabled} onClick={() => setVisible(!visible)} /></div>;
}
export function Notice({ title, children, tone = 'info', action }) {
  return <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : undefined}><Info size={22} aria-hidden="true" /><div><strong>{title}</strong><p>{children}</p></div>{action}</div>;
}
export function Note({ title = 'Nota operativa', children }) {
  return <footer className="operational-note"><Info size={32} strokeWidth={1.5} aria-hidden="true" /><div><strong>{title}</strong><p>{children}</p></div><blockquote>“La tecnología al servicio de la salud y del bienestar de las y los trabajadores del Estado.”<cite>— ISSSTE</cite></blockquote></footer>;
}
export function Metric({ icon: Icon, label, value, caption, tone = 'brand', children }) {
  return <article className="metric"><div className={`metric-icon metric-icon-${tone}`}><Icon size={28} strokeWidth={1.6} aria-hidden="true" /></div><div className="min-w-0"><p className="metric-label">{label}</p><strong className="metric-value">{value}</strong><p className="metric-caption">{caption}</p>{children}</div></article>;
}
export function Dialog({ open, onClose, title, children, footer, wide = false, busy = false }) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open) { if (dialog.open) dialog.close(); return; }
    const trigger = document.activeElement;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = previous; if (trigger?.isConnected) trigger.focus(); };
  }, [open]);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onCloseRef.current(); }}>
    <div className="dialog-header"><h2 id={titleId}>{title}</h2><IconButton icon={X} label="Cerrar diálogo" disabled={busy} onClick={onClose} /></div>
    <div className="dialog-body">{children}</div>{footer && <div className="dialog-footer">{footer}</div>}
  </dialog>;
}
export function Empty({ title = 'Aún no hay registros', children = 'Los registros aparecerán aquí cuando estén disponibles.', action }) {
  return <div className="empty-state"><Search size={30} strokeWidth={1.4} aria-hidden="true" /><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Loading() {
  return <div className="loading-state" role="status"><LoaderCircle className="spinner" size={26} aria-hidden="true" />Consultando información…</div>;
}
export function useListState(id) {
  const read = () => { const p = new URLSearchParams(location.search); return { page: Number(p.get(`${id}.page`)) || 1, pageSize: p.get(`${id}.size`) || '', sort: p.get(`${id}.sort`) || '', asc: p.get(`${id}.order`) !== 'desc', filters: Object.fromEntries([...p].filter(([k]) => k.startsWith(`${id}.filter.`)).map(([k, v]) => [k.slice(`${id}.filter.`.length), v])) }; };
  const [state, setState] = useState(read);
  const [query, setQuery] = useState('');
  useEffect(() => { const restore = () => setState(read()); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore); }, [id]);
  const update = patch => setState(prev => {
    const next = { ...prev, ...patch };
    const url = new URL(location.href);
    for (const k of [...url.searchParams.keys()]) if (k.startsWith(`${id}.`)) url.searchParams.delete(k);
    if (next.page > 1) url.searchParams.set(`${id}.page`, next.page);
    if (next.pageSize) url.searchParams.set(`${id}.size`, next.pageSize);
    if (next.sort) { url.searchParams.set(`${id}.sort`, next.sort); url.searchParams.set(`${id}.order`, next.asc ? 'asc' : 'desc'); }
    for (const [k, v] of Object.entries(next.filters)) if (v) url.searchParams.set(`${id}.filter.${k}`, v);
    history.replaceState(null, '', url);
    return next;
  });
  return { ...state, query, setQuery: q => { setQuery(q); update({ page: 1 }); }, setPage: page => update({ page }), setPageSize: pageSize => update({ pageSize, page: 1 }), setFilter: (key, value) => update({ page: 1, filters: { ...state.filters, [key]: value } }), setSort: sort => update({ sort, asc: sort === state.sort ? !state.asc : true }), reset: () => { setQuery(''); update({ page: 1, filters: {} }); } };
}
export function downloadCsv(name, columns, rows) {
  const url = URL.createObjectURL(new Blob([makeCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `${name}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DataTable({ title, rows, columns, state, noun = 'registros', pageSize = 10, toolbar, exportable = false, loading = false, error, onRetry, emptyText, rowKey = 'id' }) {
  const visible = selectRows(rows, state.query, state.filters, state.sort, state.asc);
  const page = paginate(visible, state.page, pageSize);
  useEffect(() => { if (!loading && !error && page.current !== state.page) state.setPage(page.current); }, [page.current, state.page, loading, error]);
  return <section className="table-panel" aria-label={title}>
    {(toolbar || exportable) && <div className="table-panel-heading"><div>{toolbar}</div>{exportable && <Button icon={Download} onClick={() => downloadCsv(title, columns.filter(c => c.key !== 'actions'), visible)} disabled={!visible.length}>Exportar consulta</Button>}</div>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${title}. Desplázate para ver todas las columnas.`}>
      <table><caption className="sr-only">{title}</caption><thead><tr>{columns.map(column => <th key={column.key} scope="col" aria-sort={state.sort === column.key ? state.asc ? 'ascending' : 'descending' : undefined}>
        {column.sortable === false ? column.label : <button type="button" className="sort-button" onClick={() => state.setSort(column.key)}>{column.label}<ArrowDownUp size={13} aria-hidden="true" /></button>}
      </th>)}</tr></thead><tbody>{!loading && !error && page.rows.map((row, index) => <tr key={row[rowKey] || index}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : String(row[column.key] ?? '—')}</td>)}</tr>)}</tbody></table>
      {loading ? <Loading /> : error ? <Empty title="No se pudo cargar la información" action={<Button icon={RefreshCw} onClick={onRetry}>Volver a intentar</Button>}>{error}</Empty> : !visible.length && <Empty title={rows.length ? 'No se encontraron resultados' : 'Aún no hay registros'} action={rows.length ? <Button onClick={state.reset}>Limpiar filtros</Button> : null}>{rows.length ? 'Prueba otra búsqueda o elimina los filtros activos.' : emptyText}</Empty>}
    </div>
    <div className="table-footer"><span role="status">{visible.length ? `Mostrando ${(page.current - 1) * pageSize + 1}–${Math.min(page.current * pageSize, page.total)} de ${number(page.total)} ${noun}` : `0 ${noun}`}</span>
      <nav className="pagination" aria-label={`Paginación de ${title}`}><IconButton icon={ChevronLeft} label="Página anterior" disabled={page.current <= 1} onClick={() => state.setPage(page.current - 1)} />
        {Array.from({ length: Math.min(5, page.pages) }, (_, i) => Math.min(Math.max(1, page.current - 2), Math.max(1, page.pages - 4)) + i).map(p => <button type="button" key={p} className={p === page.current ? 'current' : ''} aria-label={`Página ${p}`} aria-current={p === page.current ? 'page' : undefined} onClick={() => state.setPage(p)}>{p}</button>)}
        <IconButton icon={ChevronRight} label="Página siguiente" disabled={page.current >= page.pages} onClick={() => state.setPage(page.current + 1)} />
      </nav></div>
  </section>;
}
