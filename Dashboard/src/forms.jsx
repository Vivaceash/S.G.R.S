import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Save, Trash2, FileText, UploadCloud, TriangleAlert, Check, X, MapPin, UserRound, Thermometer, CalendarDays, Home } from 'lucide-react';
import { Button, Field, Note, Notice } from './components.jsx';
import { PageHeading } from './pages.jsx';

export function useForm(initial, validate, onSave, onDirty, retrySafe = false) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const form = useRef(null);
  const lock = useRef(false);
  const change = (key, value) => { setValues(old => ({ ...old, [key]: value })); setErrors(old => ({ ...old, [key]: '' })); onDirty?.(true); };
  const submit = async event => {
    event.preventDefault();
    if (lock.current || uncertain || event.nativeEvent?.isComposing) return;
    const next = validate(values);
    setErrors(next);
    if (Object.keys(next).length) { requestAnimationFrame(() => form.current?.querySelector('[aria-invalid="true"]')?.focus()); return; }
    lock.current = true; setBusy(true); setError('');
    try { await onSave(values); onDirty?.(false); }
    catch (err) {
      const unknown = !retrySafe && (!err.status || err.status >= 500);
      setUncertain(unknown);
      setError(unknown ? 'No se pudo confirmar el resultado del guardado. Conserva estos datos y consulta el registro antes de volver a enviarlo; la solicitud pudo haberse procesado.' : err.message);
    } finally { lock.current = false; setBusy(false); }
  };
  const reset = () => { setValues(initial); setErrors({}); setError(''); onDirty?.(false); };
  return { values, errors, error, busy, uncertain, form, change, submit, reset };
}
const requiredErrors = (values, names) => Object.fromEntries(names.filter(key => !String(values[key] ?? '').trim()).map(key => [key, 'Completa este campo para continuar.']));

export function EntryForm({ data, demo, idfId, save, navigate, onDirty, user, canRegister }) {
  const [clearAsked, setClearAsked] = useState(false);
  const [imageError, setImageError] = useState('');
  const [reading, setReading] = useState(false);
  const picker = useRef(null);
  const reader = useRef(null);
  const reportId = useRef(`IDF-${crypto.randomUUID()}`);
  useEffect(() => () => reader.current?.abort(), []);
  const f = useForm({ reportId: reportId.current, idf: idfId || '', actor: demo ? '' : user?.name || '', reason: '', temp: '', issue: false, description: '', evidence: null }, values => {
    const errors = requiredErrors(values, ['idf', 'actor', 'reason', 'temp']);
    if (!data.idfs.some(idf => idf.id === values.idf)) errors.idf = 'Selecciona un IDF del catálogo.';
    if (values.temp !== '' && (!Number.isFinite(Number(values.temp)) || Number(values.temp) < 10 || Number(values.temp) > 42)) errors.temp = 'Ingresa una temperatura entre 10 y 42 °C.';
    if (values.issue && !values.description.trim()) errors.description = 'Describe el inconveniente detectado.';
    return errors;
  }, save, onDirty);
  const pick = file => {
    if (!file || f.busy || !canRegister) return;
    setImageError('');
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) { setImageError('Selecciona una imagen PNG o JPG de hasta 10 MB.'); return; }
    reader.current?.abort(); const current = new FileReader(); reader.current = current; setReading(true);
    current.onload = () => { if (reader.current !== current) return; f.change('evidence', { name: file.name, type: file.type, size: file.size, data: String(current.result).split(',')[1] }); setReading(false); };
    current.onerror = () => { if (reader.current === current) { setReading(false); setImageError('No se pudo leer la imagen. Vuelve a seleccionarla.'); } };
    current.readAsDataURL(file);
  };
  return <><nav className="breadcrumb" aria-label="Ubicación"><Home size={13} aria-hidden="true" /><a href="#idf" onClick={e => { e.preventDefault(); navigate('idf'); }}>Registro IDF</a><span aria-hidden="true">›</span><span aria-current="page">Entrada a IDF</span></nav>
    <PageHeading headingId="idf-entry-title" eyebrow="Registro de entrada a IDFs" title="Registro de Entrada a IDF" description="Control de accesos físicos a cuartos de telecomunicaciones" />
    <form className="entry-form panel" noValidate ref={f.form} onSubmit={f.submit} aria-busy={f.busy}>
      <div className="form-heading"><span className="metric-icon metric-icon-brand"><FileText size={25} /></span><div><h2>Datos del registro</h2><p>Completa la información de la visita</p></div><span className="required-note">* Campos obligatorios</span></div>
      {f.error && <Notice title={f.uncertain ? 'Guardado sin confirmar' : 'No se pudo guardar'} tone="danger">{f.error}</Notice>}
      {!data.idfs.length && <Notice title="No hay un catálogo de IDFs disponible" tone="warning">Vuelve al registro IDF y actualiza la información para poder seleccionar un gabinete.</Notice>}
      {!canRegister && <Notice title="Solo consulta">Necesitas un perfil administrador para registrar una visita.</Notice>}
      <fieldset disabled={f.busy || f.uncertain || !canRegister}><div className="form-grid">
        <Field icon={MapPin} label="Seleccionar IDF" required error={f.errors.idf}><select value={f.values.idf} onChange={e => f.change('idf', e.target.value)}><option value="">Seleccione un IDF…</option>{data.idfs.map(idf => <option key={idf.id} value={idf.id}>{idf.name} · {idf.zone}</option>)}</select></Field>
        <Field icon={UserRound} label="Ingeniero responsable" required error={f.errors.actor}><input autoComplete="name" placeholder="Nombre completo" readOnly={!demo} maxLength={120} value={f.values.actor} onChange={e => f.change('actor', e.target.value)} /></Field>
        <div className="col-span-full entry-reason"><Field icon={FileText} label="Motivo de ingreso" required error={f.errors.reason} hint={`${f.values.reason.length}/500`}><textarea className="resize-none" rows={3} maxLength={500} placeholder="Descripción de la actividad a realizar…" value={f.values.reason} onChange={e => f.change('reason', e.target.value)} /></Field></div>
        <div className="entry-environment col-span-full"><Field icon={Thermometer} label="Temperatura" required error={f.errors.temp}><input type="number" step="0.5" min="10" max="42" inputMode="decimal" placeholder="22 °C" value={f.values.temp} onChange={e => f.change('temp', e.target.value)} /></Field>
        <Field icon={CalendarDays} label="Fecha y hora" hint="Automática al guardar"><input value={new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())} readOnly /></Field></div>
        <div className="col-span-full evidence-field"><span className="field-label">Evidencia fotográfica</span><input ref={picker} className="sr-only" tabIndex={-1} aria-label="Seleccionar evidencia fotográfica" type="file" accept="image/png,image/jpeg" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} /><button className="evidence-picker" type="button" disabled={reading} onClick={() => picker.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}><UploadCloud size={27} /><span>{reading ? 'Preparando imagen…' : 'Toca para seleccionar imágenes'}</span><small>PNG, JPG hasta 10 MB · Una por registro</small></button>
          {imageError && <small className="field-error" role="alert">{imageError}</small>}{f.values.evidence && <div className="evidence-selected" role="status"><FileText size={18} /><span>{f.values.evidence.name}<small>{Math.ceil(f.values.evidence.size / 1024)} KB · Se enviará al registrar</small></span><Button onClick={() => f.change('evidence', null)}>Quitar</Button></div>}
        </div>
        <div className="col-span-full"><label className="issue-toggle"><TriangleAlert size={26} /><span><strong>¿Se detectaron inconvenientes?</strong><small>Activa si se presentaron problemas durante la visita.</small></span><input type="checkbox" role="switch" checked={f.values.issue} onChange={e => f.change('issue', e.target.checked)} /><span className="switch-track" aria-hidden="true" /></label></div>
        {f.values.issue && <div className="col-span-full"><Field label="Descripción del inconveniente" required error={f.errors.description}><textarea className="resize-none" rows={3} maxLength={1000} value={f.values.description} onChange={e => f.change('description', e.target.value)} placeholder="Describe la incidencia y el equipo afectado…" /></Field></div>}
      </div></fieldset>
      {clearAsked && <Notice title="¿Descartar los datos del formulario?" tone="warning" action={<div className="flex gap-2"><Button onClick={() => setClearAsked(false)}>Seguir editando</Button><Button variant="danger" onClick={() => { reader.current?.abort(); reader.current = null; setReading(false); f.reset(); setImageError(''); setClearAsked(false); }}>Descartar</Button></div>}>Se eliminarán únicamente los datos que aún no has guardado.</Notice>}
      <div className="form-actions"><Button icon={Trash2} disabled={f.busy || f.uncertain || !canRegister} onClick={() => setClearAsked(true)}>Limpiar formulario</Button><Button type="submit" variant="primary" icon={Save} busy={f.busy} disabled={reading || f.uncertain || !data.idfs.length || !canRegister}>Registrar entrada</Button></div>
    </form><Note title="Nota">Todos los registros de entrada quedan almacenados en la bitácora del sistema. {demo ? 'En demostración, los cambios duran hasta recargar o cambiar al modo del sistema.' : 'El servidor registra la fecha y la identidad de la cuenta autenticada.'}</Note></>;
}
export function EditForm({ kind, row, data, save, cancel, onDirty }) {
  const isIp = kind === 'ip';
  const isStock = kind === 'stock';
  const isRequest = kind === 'request';
  const f = useForm(isIp ? { hostname: row?.hostname === '—' ? '' : row?.hostname || '', vlan: row?.vlan || '', status: row?.status === 'available' ? 'occupied' : row.status, notes: row?.notes || '' }
    : isStock ? { name: row?.name || '', category: row?.category || 'Equipos de red', quantity: row?.quantity ?? 0, available: row?.available ?? 0, idfId: row?.idfId || data.idfs[0]?.id || '' }
      : isRequest ? { name: '', username: '', position: '', area: '', device: 'Laptop', brand: '', network: data.segments[0]?.name || '', actor: '' }
        : { idfId: row?.idfId || '', name: row?.name || '', category: row?.category || 'Equipo de red', ru: row?.ru || '', brand: row?.brand || '', serial: row?.serial || '', mac: row?.mac || '', status: row?.status || 'online' }, values => {
    const errors = requiredErrors(values, isIp ? ['hostname'] : isStock ? ['name', 'category', 'idfId'] : isRequest ? ['name', 'username', 'area', 'network', 'actor'] : ['idfId', 'name', 'ru', 'brand']);
    if (isStock && (!Number.isInteger(Number(values.quantity)) || Number(values.quantity) < 0)) errors.quantity = 'Usa una cantidad entera mayor o igual a cero.';
    if (isStock && (!Number.isInteger(Number(values.available)) || Number(values.available) < 0 || Number(values.available) > Number(values.quantity))) errors.available = 'Las unidades disponibles deben estar entre cero y la existencia total.';
    return errors;
  }, save, onDirty);
  const field = (key, label, required = false, type = 'text') => <Field key={key} label={label} required={required} error={f.errors[key]}><input type={type} maxLength={type === 'text' ? 160 : undefined} value={f.values[key]} onChange={e => f.change(key, e.target.value)} /></Field>;
  return <form noValidate ref={f.form} onSubmit={f.submit} aria-busy={f.busy}>
    {f.error && <Notice title="Guardado sin completar" tone="danger">{f.error}</Notice>}
    <fieldset disabled={f.busy || f.uncertain}><div className="form-grid">
      {isIp ? <><div className="col-span-full"><Notice title={`Asignación de ${row.ip}`}>Este cambio actualiza el inventario local de direcciones. No modifica la configuración del firewall.</Notice></div>{field('hostname', 'Equipo / Hostname', true)}{field('vlan', 'Segmento')}<Field label="Estado"><select value={f.values.status} onChange={e => f.change('status', e.target.value)}><option value="occupied">Asignada</option><option value="reserved">Reservada</option></select></Field><div className="col-span-full"><Field label="Notas"><textarea className="resize-none" rows={3} value={f.values.notes} onChange={e => f.change('notes', e.target.value)} maxLength={1000} /></Field></div></>
        : isRequest ? <>{field('name', 'Nombre completo', true)}{field('username', 'Usuario', true)}{field('position', 'Puesto')}{field('area', 'Área', true)}{field('device', 'Dispositivo')}{field('brand', 'Marca')}<Field label="Red solicitada" required error={f.errors.network}><select value={f.values.network} onChange={e => f.change('network', e.target.value)}>{data.segments.map(s => <option key={s.id}>{s.name}</option>)}</select></Field>{field('actor', 'Responsable', true)}</>
          : <><Field label="IDF asignado" required error={f.errors.idfId}><select value={f.values.idfId} disabled={Boolean(row)} onChange={e => f.change('idfId', e.target.value)}><option value="">Selecciona un IDF…</option>{data.idfs.map(idf => <option key={idf.id} value={idf.id}>{idf.name}</option>)}</select></Field>{field('name', 'Recurso / Descripción', true)}{field('category', 'Categoría', true)}{isStock ? <>{field('quantity', 'Existencia total', true, 'number')}{field('available', 'Unidades disponibles', true, 'number')}</> : <>{field('ru', 'Nivel en rack (RU)', true)}{field('brand', 'Marca y modelo', true)}{field('serial', 'Número de serie')}{field('mac', 'Dirección MAC')}<Field label="Estado"><select value={f.values.status} onChange={e => f.change('status', e.target.value)}><option value="online">En servicio</option><option value="offline">Fuera de línea</option></select></Field></>}</>}
    </div></fieldset><div className="form-actions"><Button onClick={cancel} disabled={f.busy}>Cancelar</Button><Button type="submit" variant="primary" icon={Save} busy={f.busy} disabled={f.uncertain}>{row ? 'Guardar cambios' : isRequest ? 'Registrar solicitud de ejemplo' : 'Agregar recurso'}</Button></div>
  </form>;
}
