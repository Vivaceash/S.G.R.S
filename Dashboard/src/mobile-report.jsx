import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CheckCircle2, MapPin, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { Button, Field, Loading, Notice } from './components.jsx';

const params = () => {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.split('?')[1] || '');
  for (const [key, value] of fragment) if (!query.has(key)) query.set(key, value);
  return query;
};
const imagePayload = file => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024) return reject(new Error('La evidencia debe ser PNG o JPG y no superar 10 MB.'));
  const reader = new FileReader();
  reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data: String(reader.result).split(',')[1] });
  reader.onerror = () => reject(new Error('No se pudo leer la evidencia.'));
  reader.readAsDataURL(file);
});
const reportId = () => {
  if (globalThis.crypto?.randomUUID) return `IDF-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes); else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `IDF-${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};
const validateReport = values => {
  const errors = {};
  if (values.actor.trim().length < 2) errors.actor = 'Indica tu nombre completo (al menos 2 caracteres).';
  if (values.temp === '' || !Number.isFinite(Number(values.temp)) || Number(values.temp) < 10 || Number(values.temp) > 42) errors.temp = 'Ingresa una temperatura entre 10 y 42 °C.';
  if (!values.description.trim()) errors.description = 'Describe la incidencia.';
  return errors;
};

export function MobileReport() {
  const query = useRef(params()).current;
  const idf = query.get('idf') || '';
  const token = query.get('token') || '';
  const isDemo = token.startsWith('demo-') || new URLSearchParams(location.search).get('demo') === '1';
  const [context, setContext] = useState(null);
  const [supportUser, setSupportUser] = useState(null);
  const [sessionUser, setSessionUser] = useState(null);
  const [supportCsrf, setSupportCsrf] = useState('');
  const sessionRequest = useRef(0);
  const [sessionChecked, setSessionChecked] = useState(isDemo);
  const [sessionError, setSessionError] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [values, setValues] = useState({ actor: '', temp: '', description: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const submissionId = useRef(null);

  const loadContext = () => {
    setError('');
    if (isDemo) {
      const num = idf.replace(/^idf-?/i, '') || '1';
      const name = num === '13' ? 'Servidores PACS' : `IDF ${num.padStart(2, '0')}`;
      const zone = ['Planta baja', 'Primer piso', 'Segundo piso'][Number(num) % 3] || 'Planta baja';
      setContext({ idf: { id: idf || 'idf-1', name, zone: `${zone} (Modo demostración)` } });
      return () => {};
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    fetch(`/api/mobile-report?idf=${encodeURIComponent(idf)}&token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo abrir este reporte. Revisa la conexión e inténtalo de nuevo.');
      return body;
    }).then(setContext).catch(problem => {
      setError(problem.name === 'AbortError'
        ? 'La conexión tardó demasiado. Verifica que el teléfono esté en la red institucional y vuelve a intentar.'
        : problem.message);
    }).finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  };

  useEffect(() => loadContext(), [idf, token]);
  const checkSession = () => {
    if (isDemo) return;
    const request = ++sessionRequest.current;
    setSessionError('');
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('No se pudo comprobar la sesión.'); return response.json(); })
      .then(session => {
        if (request !== sessionRequest.current) return;
        setSessionUser(session.user || null);
        setSupportUser(session.user?.role === 'soporte' ? session.user : null);
        setSupportCsrf(session.user?.role === 'soporte' ? session.csrf : '');
      }).catch(problem => { if (request === sessionRequest.current) setSessionError(problem.message || 'No se pudo comprobar la sesión.'); })
      .finally(() => { if (request === sessionRequest.current) setSessionChecked(true); });
  };
  useEffect(() => {
    checkSession();
    const refreshOnReturn = () => { if (document.visibilityState === 'visible') checkSession(); };
    window.addEventListener('pageshow', checkSession);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('pageshow', checkSession);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [isDemo, idf, token]);

  const update = key => event => {
    setValues(old => ({ ...old, [key]: event.target.value }));
    setFieldErrors(old => ({ ...old, [key]: undefined }));
    setError('');
  };
  const validateField = key => () => setFieldErrors(old => ({ ...old, [key]: validateReport(values)[key] }));

  const submit = async event => {
    event.preventDefault();
    if (!context || busy) return;
    const invalid = validateReport(values);
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) {
      setError('Corrige los campos marcados antes de enviar el reporte.');
      event.currentTarget.elements.namedItem(Object.keys(invalid)[0])?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (isDemo) {
        await new Promise(r => setTimeout(r, 400));
        setSent(true);
        return;
      }
      const evidence = await imagePayload(file);
      submissionId.current ||= reportId();
      const response = await fetch('/api/mobile-report', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          idf_id: idf,
          token,
          actor: values.actor.trim(),
          evidence,
          incident: {
            id: submissionId.current,
            temp: Number(values.temp),
            status: 'open',
            description: values.description.trim()
          }
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo enviar el reporte. Inténtalo nuevamente.');
      if (body.status !== 'success' || body.incident?.id !== submissionId.current) throw new Error('El servidor no confirmó el guardado. Vuelve a enviar el reporte.');
      setSent(true);
    } catch (problem) {
      setError(['TimeoutError', 'AbortError'].includes(problem.name) ? 'El servidor tardó demasiado en confirmar. Revisa la conexión y vuelve a enviar el reporte.' : problem.message || 'No se pudo enviar el reporte.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !context) return (
    <main className="mobile-report-page">
      <section className="mobile-report-card panel mobile-error">
        <TriangleAlert size={38} />
        <Notice title="No pudimos abrir este registro" tone="danger">{error}</Notice>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Button icon={RefreshCw} onClick={loadContext}>Reintentar</Button>
          <Button variant="secondary" icon={ArrowLeft} onClick={() => { location.hash = '#idf'; }}>Volver al sistema</Button>
        </div>
      </section>
    </main>
  );

  if (!context || !sessionChecked) return (
    <main className="mobile-report-page">
      <Loading label="Abriendo registro móvil…" />
    </main>
  );

  if (sessionError) return <main className="mobile-report-page"><section className="mobile-report-card panel"><Notice title="No se pudo verificar tu cuenta" tone="danger">{sessionError}</Notice><Button icon={RefreshCw} onClick={checkSession}>Reintentar</Button></section></main>;

  if (supportUser) return <SupportMobileMovement context={context} idf={idf} token={token} user={supportUser} csrf={supportCsrf} />;

  if (sent) return (
    <main className="mobile-report-page">
      <section className="mobile-report-card panel mobile-success" role="status" aria-live="polite">
        <CheckCircle2 size={52} />
        <p className="eyebrow">Registro enviado</p>
        <h1>Reporte guardado correctamente</h1>
        <p>La incidencia de <strong>{context.idf.name}</strong> ya aparece en la bitácora para su seguimiento.</p>
        <div style={{ marginTop: 20 }}>
          <Button variant="primary" icon={ArrowLeft} onClick={() => { location.hash = '#bitacora'; }}>Ver en Bitácora</Button>
        </div>
      </section>
    </main>
  );

  return (
    <main className="mobile-report-page">
      <section className="mobile-report-card panel">
        <header className="mobile-report-hero mobile-report-hero-compact">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mobile-report-label">REPORTE DE INCIDENCIA</span>
            <button
              type="button"
              onClick={() => { location.hash = '#idf'; }}
              style={{ background: 'transparent', border: 'none', color: '#f9d99f', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <ArrowLeft size={14} /> Dashboard
            </button>
          </div>
          <h1>{context.idf.name}</h1>
          <p><MapPin size={15} /> {context.idf.zone || 'IDF de comunicaciones'}</p>
        </header>
        <form className="mobile-report-form" onSubmit={submit} noValidate aria-busy={busy}>
          {error && <Notice title="Revisa el reporte" tone="danger">{error}</Notice>}
          {!isDemo && !sessionUser && <div className="mobile-support-entry"><strong>¿Eres de soporte?</strong><p>Inicia sesión en otra pestaña y vuelve aquí para abrir el registro de retiro del mismo IDF.</p><div><Button type="button" variant="secondary" onClick={() => window.open(`${location.origin}${location.pathname}#soporte`, '_blank', 'noopener')}>Abrir sesión de soporte</Button><Button type="button" onClick={checkSession}>Ya inicié sesión</Button></div></div>}
          <div className="mobile-report-summary">
            <span><i /> Alerta nueva</span>
            <small>Se enviará a Bitácora</small>
          </div>
          <Field label="Nombre completo" required error={fieldErrors.actor}>
            <input name="actor" autoComplete="name" placeholder="Tu nombre" value={values.actor} onChange={update('actor')} onBlur={validateField('actor')} maxLength={120} />
          </Field>
          <Field label="Temperatura (°C)" required error={fieldErrors.temp} hint="Entre 10 y 42 °C; puedes usar decimales.">
            <input name="temp" type="number" inputMode="decimal" min="10" max="42" step="any" value={values.temp} onChange={update('temp')} onBlur={validateField('temp')} placeholder="Ej. 22" />
          </Field>
          <Field label="Descripción de la incidencia" required error={fieldErrors.description} hint={`${values.description.length}/1000`}>
            <textarea name="description" rows={3} value={values.description} onChange={update('description')} onBlur={validateField('description')} maxLength={1000} placeholder="Equipo afectado y problema observado…" />
          </Field>
          <label className={`mobile-evidence ${file ? 'has-file' : ''}`}>
            <Camera size={21} />
            <span><strong>{file ? file.name : 'Añadir foto (opcional)'}</strong></span>
            <input className="sr-only" type="file" accept="image/png,image/jpeg" capture="environment" onChange={event => setFile(event.target.files?.[0] || null)} />
          </label>
          <div className="mobile-submit-area">
            <Button type="submit" variant="primary" icon={Send} busy={busy} className="w-full mobile-submit">Enviar reporte</Button>
          </div>
        </form>
      </section>
    </main>
  );
}

function SupportMobileMovement({ context, idf, token, user, csrf }) {
  const [actorName, setActorName] = useState('');
  const [inventory, setInventory] = useState([]);
  const [inventoryError, setInventoryError] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [identifier, setIdentifier] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const id = useRef(null);
  useEffect(() => {
    let active = true;
    fetch('/api/support/inventory', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo cargar el inventario.'); return body; })
      .then(body => { if (active) setInventory(body.items || []); })
      .catch(problem => { if (active) setInventoryError(problem.message); });
    return () => { active = false; };
  }, []);
  const matches = inventory.filter(item => item.description.toLocaleLowerCase('es-MX').includes(itemSearch.toLocaleLowerCase('es-MX')));
  const selectedItem = inventory.find(item => item.id === itemId);
  const submit = async event => {
    event.preventDefault();
    if (actorName.trim().length < 2 || actorName.trim().length > 120) { setError('Indica el nombre completo de quien realiza el registro.'); return; }
    if (!selectedItem) { setError('Selecciona un artículo del inventario IDF 3.'); return; }
    const taken = Number(quantity);
    if (!Number.isSafeInteger(taken) || taken < 1 || taken > selectedItem.quantity) { setError(`Indica una cantidad entre 1 y ${selectedItem.quantity}.`); return; }
    if (!identifier.trim()) { setError('Indica el número de identificación del artículo.'); return; }
    setBusy(true); setError('');
    try {
      const evidence = await imagePayload(file);
      id.current ||= reportId().slice(4);
      const response = await fetch('/api/support/movements', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ id: id.current, idf_id: idf, token, actor_name: actorName.trim(), inventory_item_id: itemId, quantity: taken, identifier: identifier.trim(), notes: notes.trim(), evidence })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo guardar el movimiento.');
      setSent(true);
    } catch (problem) { setError(problem.message); } finally { setBusy(false); }
  };
  return <main className="mobile-report-page"><section className="mobile-report-card panel">
    <header className="mobile-report-hero mobile-report-hero-compact"><span className="mobile-report-label">BITÁCORA DE SOPORTE</span><h1>{context.idf.name}</h1><p><MapPin size={15} /> {context.idf.zone || 'IDF de comunicaciones'}</p></header>
    {sent ? <div className="mobile-success" role="status"><CheckCircle2 size={42} /><h2>Retiro registrado</h2><p>El movimiento de {actorName.trim()} ya está en la bitácora de soporte.</p><Button onClick={() => { location.href = `${location.origin}${location.pathname}#soporte`; }}>Ver Dashboard de soporte</Button></div> :
    <form className="mobile-report-form" onSubmit={submit} noValidate aria-busy={busy}>
      {error && <Notice title="Revisa el registro" tone="danger">{error}</Notice>}
      <Field label="Nombre completo de quien realiza el registro" required><input name="actor_name" autoComplete="name" value={actorName} onChange={event => setActorName(event.target.value)} maxLength={120} placeholder="Nombre de la persona" /></Field>
      <p>Cuenta de soporte: <strong>{user.name}</strong></p>
      <p className="mobile-inventory-origin">Los artículos retirados salen del inventario de Soporte IDF 3.</p>
      {inventoryError && <Notice tone="danger">{inventoryError}</Notice>}
      <Field label="Buscar artículo" ><input value={itemSearch} onChange={event => { setItemSearch(event.target.value); setItemId(''); }} placeholder="Nombre del artículo…" /></Field>
      <Field label="Artículo retirado" required><select value={itemId} onChange={event => setItemId(event.target.value)}><option value="">Selecciona un artículo ({matches.length} disponibles)</option>{matches.map(item => <option key={item.id} value={item.id} disabled={item.quantity < 1}>{item.description} — {item.quantity} {item.unit}</option>)}</select></Field>
      {selectedItem && <p className="mobile-inventory-stock">Existencia actual: <strong>{selectedItem.quantity} {selectedItem.unit}</strong></p>}
      <Field label="Cantidad retirada" required><input type="number" min="1" max={selectedItem?.quantity || undefined} step="1" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} /></Field>
      <Field label="Número de identificación" required hint="Serie, inventario o código del elemento"><input value={identifier} onChange={event => setIdentifier(event.target.value)} maxLength={120} /></Field>
      <Field label="Observaciones (opcional)"><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={3} /></Field>
      <label className={`mobile-evidence ${file ? 'has-file' : ''}`}><Camera size={21} /><span><strong>{file ? file.name : 'Tomar o añadir foto (opcional)'}</strong></span><input className="sr-only" type="file" accept="image/png,image/jpeg" capture="environment" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
      <Button type="submit" variant="primary" icon={Send} busy={busy}>Registrar retiro</Button>
    </form>}
  </section></main>;
}
