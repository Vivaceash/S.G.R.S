import React, { useEffect, useRef, useState } from 'react';
import { Users, UserPlus, ShieldCheck, Eye, Settings2, PlugZap, Save, RefreshCw, LockKeyhole, Server } from 'lucide-react';
import { Badge, Button, DataTable, Dialog, Field, Loading, Notice, SearchField, SecretInput, Select, useListState } from './components.jsx';
import { PageHeading } from './pages.jsx';
import { useForm } from './forms.jsx';
import { roleLabel, request, dateTime } from './domain.mjs';
import { useSession } from './session.jsx';

export const initialDemoUsers = [
  { id: 'demo-admin', username: 'operador.redes', name: 'Operador de redes', role: 'admin', active: true, version: 1 },
  { id: 'demo-viewer', username: 'consulta.redes', name: 'Consulta de infraestructura', role: 'viewer', active: true, version: 1 },
];
export const initialDemoConnections = ['forti', 'omni'].map(id => ({ id, url: `http://127.0.0.1:${id === 'forti' ? 8001 : 8000}/api/v1`, auth_mode: 'api-key', username: '', has_secret: false, version: 0 }));

function useAdminLoad(path, demo, example) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!demo);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController(); let alive = true;
    setLoading(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 12000);
    request(path, { signal: controller.signal }).then(result => { if (alive) setValue(result); })
      .catch(error => { if (alive) setError(error.name === 'AbortError' ? 'La consulta tardó demasiado. Vuelve a intentar.' : error.message); })
      .finally(() => { clearTimeout(timeout); if (alive) setLoading(false); });
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [path, demo, revision]);
  return { value: demo ? example : value, setValue, error, loading, refresh: () => setRevision(v => v+1) };
}

function UserForm({ row, save, cancel, onDirty, currentId }) {
  const { roles: roleInfo } = useSession();
  const f = useForm({ id: row?.id, version: row?.version, username: row?.username || '', name: row?.name || '', role: row?.role || 'viewer', active: row ? Boolean(row.active) : true, password: '', confirmed: false }, values => {
    const errors = {};
    if (!/^[a-z0-9][a-z0-9._@-]{2,79}$/i.test(values.username.trim())) errors.username = 'Usa 3–80 letras, números, puntos, guiones o @.';
    if (values.name.trim().length < 2) errors.name = 'Escribe el nombre completo.';
    if ((!row || values.password) && (values.password.length < 12 || values.password.length > 128)) errors.password = 'Usa entre 12 y 128 caracteres.';
    if (!values.confirmed) errors.confirmed = 'Confirma los permisos antes de guardar.';
    return errors;
  }, save, onDirty);
  const change = (key, value) => { f.change(key, value); f.change('confirmed', false); };
  return <form noValidate onSubmit={f.submit} ref={f.form} aria-busy={f.busy}>
    {f.error && <Notice title="No se pudo confirmar el guardado" tone="danger">{f.error}</Notice>}
    <fieldset disabled={f.busy || f.uncertain}><div className="form-grid">
      <Field label="Nombre completo" required error={f.errors.name}><input value={f.values.name} maxLength={120} autoComplete="off" onChange={e => change('name', e.target.value)} /></Field>
      <Field label="Usuario de acceso" required error={f.errors.username}><input value={f.values.username} maxLength={80} autoCapitalize="none" autoComplete="off" onChange={e => change('username', e.target.value)} /></Field>
      <Field label="Rol asignado" required><select value={f.values.role} disabled={row?.id === currentId} onChange={e => change('role', e.target.value)}>{roleInfo.map(role => <option key={role.id} value={role.id}>{roleLabel(role.id)}</option>)}</select></Field>
      <Field label="Estado de la cuenta"><select value={f.values.active ? 'active' : 'inactive'} disabled={row?.id === currentId} onChange={e => change('active', e.target.value === 'active')}><option value="active">Activa</option><option value="inactive">Suspendida</option></select></Field>
      <div className="col-span-full"><Field label={row ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'} required={!row} error={f.errors.password} hint={row ? 'Déjala vacía para conservarla. Al cambiarla se cerrarán las sesiones del usuario.' : '12–128 caracteres. Entrégala a la persona por un canal seguro.'}><SecretInput autoComplete="new-password" value={f.values.password} maxLength={128} onChange={e => change('password', e.target.value)} /></Field></div>
    </div><Notice title={`Permisos de ${roleLabel(f.values.role)}`} tone={f.values.active ? 'info' : 'warning'}>{roleInfo.find(r => r.id === f.values.role)?.description} {!f.values.active && 'La cuenta no podrá iniciar sesión. Sus registros se conservarán.'} {row && 'Los cambios de rol, contraseña o suspensión revocan sus sesiones.'}</Notice>
    <Field label={`Confirmo ${row ? 'actualizar' : 'crear'} esta cuenta con el rol ${roleLabel(f.values.role)}`} required error={f.errors.confirmed}><input className="confirmation-checkbox" type="checkbox" checked={f.values.confirmed} onChange={e => f.change('confirmed', e.target.checked)} /></Field>
    </fieldset><div className="form-actions"><Button disabled={f.busy} onClick={cancel}>Cancelar</Button><Button type="submit" icon={Save} variant="primary" busy={f.busy} disabled={f.uncertain}>{row ? 'Guardar usuario y permisos' : 'Crear usuario y asignar rol'}</Button></div>
  </form>;
}

export function UsersPage({ demoUsers, setDemoUsers, notify }) {
  const { demo, user, roles: roleInfo } = useSession();
  const list = useAdminLoad('/api/admin/users', demo, { users: demoUsers });
  const state = useListState('usuarios');
  const [editor, setEditor] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const busy = useRef(false);
  const close = () => { if (busy.current) return; if (dirty) setDiscard(true); else setEditor(null); };
  useEffect(() => { const expired = () => { setEditor(null); setDirty(false); setDiscard(false); }; window.addEventListener('sgrs-session-expired', expired); return () => window.removeEventListener('sgrs-session-expired', expired); }, []);
  useEffect(() => { if (!dirty) return; const warn = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const save = async values => {
    if (busy.current) return;
    busy.current = true;
    try {
      let saved;
      if (demo) {
        if (demoUsers.some(u => u.username.toLowerCase() === values.username.toLowerCase() && u.id !== values.id)) throw Object.assign(new Error('Ese usuario ya existe en la demostración.'), { status: 409 });
        const { password, confirmed, ...publicValues } = values;
        saved = { ...publicValues, id: values.id || crypto.randomUUID(), version: (values.version || 0)+1 };
        setDemoUsers(old => values.id ? old.map(u => u.id === values.id ? saved : u) : [saved, ...old]);
      } else {
        saved = (await request('/api/admin/users/save', { body: values })).user;
        list.setValue(old => ({ users: values.id ? old.users.map(u => u.id === values.id ? saved : u) : [saved, ...old.users] }));
      }
      setDirty(false); setEditor(null); notify(demo ? 'Usuario de ejemplo guardado. No crea acceso real.' : 'Usuario y permisos guardados.');
    } finally { busy.current = false; }
  };
  const rows = (list.value?.users || []).map(u => ({ ...u, state: u.active ? 'active' : 'inactive' }));
  return <><PageHeading eyebrow="Administración del sistema" title="Usuarios y privilegios" description="Cuentas personales y permisos de acceso al Centro Operativo"><Button icon={UserPlus} variant="primary" disabled={list.loading || Boolean(list.error)} onClick={() => { setDirty(false); setDiscard(false); setEditor({ row: null }); }}>Crear usuario</Button></PageHeading>
    <div className="role-cards">{roleInfo.map(({ id, title, description }) => <article className="role-card panel" key={id}><ShieldCheck size={24} /><h2>{roleLabel(id)}</h2><p>{description}</p><span>{rows.filter(u => u.role === id).length} cuentas</span></article>)}</div>
    <div className="toolbar"><SearchField value={state.query} onChange={state.setQuery} placeholder="Buscar por nombre o usuario…" /><Select label="Rol" value={state.filters.role || ''} onChange={e => state.setFilter('role', e.target.value)}><option value="">Todos los roles</option>{roleInfo.map(r => <option key={r.id} value={r.id}>{roleLabel(r.id)}</option>)}</Select><Select label="Estado" value={state.filters.state || ''} onChange={e => state.setFilter('state', e.target.value)}><option value="">Todas las cuentas</option><option value="active">Activas</option><option value="inactive">Suspendidas</option></Select></div>
    <DataTable title="Usuarios del sistema" rows={rows} state={state} noun="usuarios" loading={list.loading} error={list.error} onRetry={list.refresh} columns={[
      { key: 'name', label: 'Nombre', render: r => <div className="cell-detail"><strong>{r.name}</strong><small>{r.id === user.id ? 'Tu cuenta' : 'Cuenta personal'}</small></div> },
      { key: 'username', label: 'Usuario' }, { key: 'role', label: 'Rol', render: r => <span className="network-tag">{roleLabel(r.role)}</span> },
      { key: 'state', label: 'Estado', render: r => <Badge status={r.active ? 'online' : 'offline'}>{r.active ? 'Activa' : 'Suspendida'}</Badge> },
      { key: 'actions', label: 'Permisos', sortable: false, render: r => <Button icon={Settings2} onClick={() => { setDirty(false); setDiscard(false); setEditor({ row: r }); }}>Administrar</Button> },
    ]} />
    <p className="muted">No se permite eliminar usuarios ni desactivar la última cuenta responsable del sistema.</p>
    <Dialog open={Boolean(editor)} onClose={close} title={editor?.row ? `Administrar ${editor.row.name}` : 'Crear usuario'} wide>
      {discard && <Notice title="¿Descartar los cambios de esta cuenta?" tone="warning" action={<><Button autoFocus onClick={() => setDiscard(false)}>Seguir editando</Button><Button variant="danger" onClick={() => { setDirty(false); setEditor(null); }}>Descartar</Button></>}>Los cambios aún no se han guardado.</Notice>}
      {editor && <UserForm key={editor.row?.id || 'new'} row={editor.row} currentId={user.id} save={save} cancel={close} onDirty={setDirty} />}
    </Dialog>
  </>;
}

function ConnectionForm({ row, onSave, onDirty, notify }) {
  const { demo } = useSession();
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const controller = useRef(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  const validate = values => {
    const errors = {};
    try { const u = new URL(values.url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error(); } catch { errors.url = 'Usa una URL HTTP(S) base sin credenciales ni parámetros.'; }
    if (!values.secret && (!row.has_secret || values.url !== row.url || values.auth_mode !== row.auth_mode || values.username !== row.username)) errors.secret = 'Introduce la credencial para este destino.';
    if (values.auth_mode === 'basic' && !values.username.trim()) errors.username = 'Indica el usuario de la API.';
    return errors;
  };
  const f = useForm({ ...row, secret: '', confirmed: false }, values => ({ ...validate(values), ...(!values.confirmed ? { confirmed: 'Confirma el destino antes de guardar.' } : {}) }), async values => {
    const saved = demo ? { ...row, url: values.url, auth_mode: values.auth_mode, username: values.username, has_secret: Boolean(values.secret || row.has_secret), version: row.version+1 } : (await request(`/api/admin/connections/${row.id}/save`, { body: values })).connection;
    onSave(saved); notify(demo ? 'Configuración de ejemplo guardada; la credencial se descartó.' : 'Conexión guardada. Se usará en las próximas consultas.');
  }, onDirty);
  const change = (key, value) => { sequence.current++; controller.current?.abort(); setTesting(false); setTest(null); f.change(key, value); f.change('confirmed', false); };
  const probe = async () => {
    if (testing) return;
    const invalid = validate(f.values);
    if (Object.keys(invalid).length) { setTest({ ok: false, message: Object.values(invalid)[0] }); return; }
    if (demo) { setTest({ ok: null, message: 'La demostración no realiza conexiones. Cambia al sistema e inicia sesión para probar la API.' }); return; }
    const current = ++sequence.current; controller.current = new AbortController();
    const activeController = controller.current;
    const timeout = setTimeout(() => activeController.abort(), 12000);
    setTesting(true); setTest(null);
    try { const result = await request(`/api/admin/connections/${row.id}/test`, { body: f.values, signal: controller.current.signal }); if (current === sequence.current) setTest(result); }
    catch (error) { if (current === sequence.current) setTest({ ok: false, message: error.name === 'AbortError' ? 'La consulta tardó demasiado. Verifica la disponibilidad de la API.' : error.message }); }
    finally { clearTimeout(timeout); if (current === sequence.current) setTesting(false); }
  };
  return <form className="connection-panel panel" noValidate ref={f.form} onSubmit={f.submit} aria-busy={f.busy || testing}>
    <div className="section-heading"><span className="metric-icon metric-icon-brand"><Server size={24} /></span><div><h2>{row.id === 'forti' ? 'API FortiGate' : 'API OmniVista'}</h2><p>{row.id === 'forti' ? 'Telemetría, segmentos y dispositivos de red' : 'Infraestructura Alcatel-Lucent y servicios de red'}</p></div><Badge status={row.has_secret ? 'normal' : 'unknown'}>{row.has_secret ? 'Configurada' : 'Sin credencial'}</Badge></div>
    {f.error && <Notice title="Guardado sin completar" tone="danger">{f.error}</Notice>}
    <fieldset disabled={f.busy || f.uncertain || testing}><div className="form-grid">
      <div className="col-span-full"><Field label="URL base de la API" required error={f.errors.url} hint="Incluye /api/v1. HTTPS obligatorio fuera de localhost."><input type="url" autoComplete="off" placeholder="https://api.institucion.gob.mx/api/v1" value={f.values.url} onChange={e => change('url', e.target.value)} /></Field></div>
      <Field label="Autenticación del request"><select value={f.values.auth_mode} onChange={e => change('auth_mode', e.target.value)}><option value="api-key">Clave API · X-API-Key</option><option value="bearer">Token · Authorization Bearer</option><option value="basic">Usuario y contraseña · Basic</option></select></Field>
      {f.values.auth_mode === 'basic' ? <Field label="Usuario de la API" required error={f.errors.username}><input value={f.values.username} autoComplete="off" onChange={e => change('username', e.target.value)} /></Field> : <div className="connection-header-note"><LockKeyhole size={18} /><span>{f.values.auth_mode === 'api-key' ? 'Se envía en X-API-Key' : 'Se envía en Authorization'}</span></div>}
      <div className="col-span-full"><Field label="Contraseña / clave de consulta" error={f.errors.secret} hint={row.has_secret ? 'Credencial guardada. Déjala vacía para conservarla si no cambias el destino.' : 'Solo se envía al servidor al guardar o probar la conexión.'}><SecretInput label="credencial de consulta" value={f.values.secret} autoComplete="new-password" maxLength={4096} placeholder={row.has_secret ? 'Credencial almacenada · No se muestra' : 'Introduce la contraseña o clave del request'} onChange={e => change('secret', e.target.value)} /></Field></div>
    </div><Field label={`Confirmo usar este destino para las consultas de ${row.id === 'forti' ? 'FortiGate' : 'OmniVista'}`} required error={f.errors.confirmed}><input type="checkbox" className="confirmation-checkbox" checked={f.values.confirmed} onChange={e => f.change('confirmed', e.target.checked)} /></Field></fieldset>
    <div className="connection-result" role="status">{test && <Notice title={test.ok === true ? 'Conexión verificada' : test.ok === false ? 'Conexión no confirmada' : 'Sin consulta externa'} tone={test.ok === false ? 'warning' : 'info'}>{test.message}{test.http_status && ` HTTP ${test.http_status} · ${test.elapsed_ms} ms`}</Notice>}</div>
    <div className="form-actions"><Button icon={PlugZap} busy={testing} disabled={f.busy || f.uncertain} onClick={probe}>Probar conexión</Button><Button type="submit" icon={Save} variant="primary" busy={f.busy} disabled={testing || f.uncertain}>Guardar conexión</Button></div>
  </form>;
}

export function ConnectionsPage({ demoConnections, setDemoConnections, onDirty, notify }) {
  const { demo } = useSession();
  const list = useAdminLoad('/api/admin/connections', demo, { connections: demoConnections });
  const dirty = useRef({});
  const markDirty = (id, value) => { dirty.current[id] = value; onDirty(Object.values(dirty.current).some(Boolean)); };
  useEffect(() => () => onDirty(false), [onDirty]);
  const saved = value => {
    if (demo) setDemoConnections(old => old.map(row => row.id === value.id ? value : row));
    else list.setValue(old => ({ connections: old.connections.map(row => row.id === value.id ? value : row) }));
    markDirty(value.id, false);
  };
  return <><PageHeading eyebrow="Administración del sistema" title="Conexiones con las APIs" description="Configura el destino y la autenticación de las consultas del Centro Operativo" />
    <Notice title="Credenciales del servidor, no del navegador">La credencial guardada no vuelve a mostrarse ni se almacena en este navegador. Probar conexión realiza una consulta de lectura con los valores del formulario; no los guarda ni cambia equipos.</Notice>
    {list.loading ? <Loading /> : list.error ? <Notice title="No se pudo cargar la configuración" tone="danger" action={<Button onClick={list.refresh}>Reintentar</Button>}>{list.error}</Notice> : <div className="connections-grid">{list.value?.connections.map(row => <ConnectionForm key={`${row.id}-${row.version}`} row={row} onSave={saved} onDirty={value => markDirty(row.id, value)} notify={notify} />)}</div>}
    <p className="muted">Configura las APIs intermedias de este proyecto, no directamente el firewall o el NMS. La prueba informa de la respuesta de la API; no certifica la disponibilidad de toda la infraestructura.</p>
  </>;
}
