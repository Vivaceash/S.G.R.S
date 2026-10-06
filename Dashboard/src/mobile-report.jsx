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

export function MobileReport() {
  const query = useRef(params()).current;
  const idf = query.get('idf') || '';
  const token = query.get('token') || '';
  const isDemo = token.startsWith('demo-') || new URLSearchParams(location.search).get('demo') === '1';
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [values, setValues] = useState({ actor: '', temp: '', description: '' });

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

  const update = key => event => setValues(old => ({ ...old, [key]: event.target.value }));

  const submit = async event => {
    event.preventDefault();
    if (!context || busy) return;
    if (!values.actor.trim() || values.temp === '' || !values.description.trim()) {
      setError('Completa los campos obligatorios antes de enviar.');
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
      const response = await fetch('/api/mobile-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          idf_id: idf,
          token,
          actor: values.actor.trim(),
          evidence,
          incident: {
            id: reportId(),
            temp: Number(values.temp),
            status: 'open',
            description: values.description.trim()
          }
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'No se pudo enviar el reporte. Inténtalo nuevamente.');
      setSent(true);
    } catch (problem) {
      setError(problem.message || 'No se pudo enviar el reporte.');
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

  if (!context) return (
    <main className="mobile-report-page">
      <Loading label="Abriendo registro móvil…" />
    </main>
  );

  if (sent) return (
    <main className="mobile-report-page">
      <section className="mobile-report-card panel mobile-success">
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
          <div className="mobile-report-summary">
            <span><i /> Alerta nueva</span>
            <small>Se enviará a Bitácora</small>
          </div>
          <Field label="Nombre completo" required>
            <input autoComplete="name" placeholder="Tu nombre" value={values.actor} onChange={update('actor')} maxLength={120} />
          </Field>
          <Field label="Temperatura (°C)" required>
            <input type="number" inputMode="decimal" min="10" max="42" step="0.5" value={values.temp} onChange={update('temp')} placeholder="Ej. 22" />
          </Field>
          <Field label="Descripción de la incidencia" required hint={`${values.description.length}/1000`}>
            <textarea rows={3} value={values.description} onChange={update('description')} maxLength={1000} placeholder="Equipo afectado y problema observado…" />
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
