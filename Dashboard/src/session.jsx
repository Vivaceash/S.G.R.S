import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createAltasCache } from './altas-cache.mjs';
import { LogIn, ShieldCheck } from 'lucide-react';
import { Button, Field, Loading, Notice, SecretInput } from './components.jsx';
import { useForm } from './forms.jsx';
import { LoginWaves } from './login-waves.jsx';
import { request, setCsrfToken, ROLE_PAGE_DEFAULTS, roleLabel, BASE_ROLE_CATALOG, getEffectiveRoles, canViewPageId, canViewSubmoduleId, defaultSubmodules, clearIdfViewSession } from './domain.mjs';

const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);
const demoSession = {
  user: {
    id: 'demo-admin',
    name: 'Administrador de ejemplo',
    username: 'admin.demo',
    role: 'super-admin',
    active: true,
    allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'],
  },
  must_change_password: false,
  capabilities: [
    'dashboard.read', 'inventory.read', 'idf.read', 'activity.read',
    'inventory.write', 'inventory.export', 'idf.visits.write',
    'users.read', 'users.create', 'users.edit', 'users.delete', 'integrations.manage', 'traffic.read',
  ],
  roles: [
    { id: 'soporte', title: 'Soporte', description: 'Atención y diagnóstico técnico: consulta de dispositivos, fichas técnicas y DHCP.' },
    { id: 'admin', title: 'admin', description: 'Administra la operación: inventario, visitas e incidencias de IDF y gestión de usuarios.' },
    { id: 'super-admin', title: 'Admin', description: 'Gestiona cuentas, privilegios modulares, conexiones y consultas técnicas.' },
  ],
  allowed_pages: ROLE_PAGE_DEFAULTS['super-admin'],
};

function Login({ onLogin, onBootstrap, setup, setupAllowed, error, retry, expired }) {
  const f = useForm({ username: '', password: '' }, values => Object.fromEntries(['username', 'password'].filter(k => !values[k]).map(k => [k, 'Completa este campo.'])), onLogin, null, true);
  const setupForm = useForm({ username: '', name: '', password: '', password_confirmation: '' }, values => {
    const errors = Object.fromEntries(['username', 'name', 'password', 'password_confirmation'].filter(key => !String(values[key] || '').trim()).map(key => [key, 'Completa este campo.']));
    if (values.password && values.password.length < 12) errors.password = 'Usa al menos 12 caracteres.';
    if (values.password && values.password_confirmation && values.password !== values.password_confirmation) errors.password_confirmation = 'Las contraseñas no coinciden.';
    return errors;
  }, onBootstrap, null, true);
  useEffect(() => { document.title = 'Iniciar sesión · Centro Operativo SGRS'; }, []);
  return <main className="login-page"><LoginWaves /><section className="login-intro" aria-label="Sistema de Gestión en Redes y Seguridad"><p className="eyebrow">Infraestructura NOC</p><h1>Sistema de Gestión<br />en Redes y Seguridad</h1><p>Consulta, documenta y da seguimiento a la infraestructura institucional desde un solo lugar.</p><div className="login-intro-points"><span><i /> Inventario y disponibilidad IP</span><span><i /> Reportes de IDF en tiempo real</span><span><i /> Monitoreo de red centralizado</span></div></section><section className="login-panel panel"><div className="brand-image" role="img" aria-label="ISSSTE" /><p className="eyebrow">Centro Operativo · Redes e Infraestructura</p>{expired && <h1>Vuelve a iniciar sesión</h1>}<p className="muted">Acceso con tu cuenta personal. Tus permisos dependen del rol asignado.</p>
    {setup && <Notice title="Configuración inicial pendiente">{setupAllowed ? 'Crea la primera cuenta local para habilitar el dashboard.' : 'La primera cuenta debe crearse desde la consola del servidor.'}<Button onClick={retry}>Comprobar disponibilidad</Button></Notice>}
    {error && <Notice title="No se pudo consultar el acceso" tone="warning" action={<Button onClick={retry}>Reintentar</Button>}>{error}</Notice>}
    {expired && <Notice title="Sesión no válida">Vuelve a iniciar sesión. Los datos de la sesión anterior se han retirado de la pantalla.</Notice>}
    {setup && setupAllowed && <form noValidate ref={setupForm.form} onSubmit={setupForm.submit} aria-busy={setupForm.busy} className="setup-form"><h2>Crear cuenta inicial</h2>{setupForm.error && <Notice title="No se pudo crear la cuenta" tone="danger">{setupForm.error}</Notice>}<fieldset disabled={setupForm.busy}>
      <Field label="Usuario" required error={setupForm.errors.username}><input autoComplete="username" autoCapitalize="none" value={setupForm.values.username} onChange={e => setupForm.change('username', e.target.value)} maxLength={80} /></Field>
      <Field label="Nombre completo" required error={setupForm.errors.name}><input autoComplete="name" value={setupForm.values.name} onChange={e => setupForm.change('name', e.target.value)} maxLength={120} /></Field>
      <Field label="Contraseña" required error={setupForm.errors.password}><SecretInput autoComplete="new-password" value={setupForm.values.password} onChange={e => setupForm.change('password', e.target.value)} maxLength={128} /></Field>
      <Field label="Repetir contraseña" required error={setupForm.errors.password_confirmation}><SecretInput autoComplete="new-password" value={setupForm.values.password_confirmation} onChange={e => setupForm.change('password_confirmation', e.target.value)} maxLength={128} /></Field>
      <Button type="submit" variant="primary" className="w-full" busy={setupForm.busy}>Crear cuenta y abrir dashboard</Button>
    </fieldset></form>}
    {!setup && <form noValidate ref={f.form} onSubmit={f.submit} aria-busy={f.busy}>{f.error && <Notice title="No se pudo iniciar sesión" tone="danger">{f.error}</Notice>}<fieldset disabled={f.busy}>
      <Field label="Usuario" required error={f.errors.username}><input autoComplete="username" autoCapitalize="none" value={f.values.username} onChange={e => f.change('username', e.target.value)} maxLength={80} /></Field>
      <Field label="Contraseña" required error={f.errors.password}><SecretInput autoComplete="current-password" value={f.values.password} onChange={e => f.change('password', e.target.value)} maxLength={128} /></Field>
      <Button type="submit" variant="primary" className="w-full" busy={f.busy} icon={LogIn}>Iniciar sesión</Button>
    </fieldset></form>}<div className="login-footer"><ShieldCheck size={19} /><span>Sesión personal · Acceso por privilegios</span></div>
  </section></main>;
}

function PasswordChange({ onChanged }) {
  const f = useForm({ password: '', password_confirmation: '' }, values => {
    const errors = {};
    if (values.password.length < 12 || values.password.length > 128) errors.password = 'Usa entre 12 y 128 caracteres.';
    if (values.password_confirmation !== values.password) errors.password_confirmation = 'Las contraseñas no coinciden.';
    return errors;
  }, async values => {
    const result = await request('/api/auth/password/change', { body: values });
    setCsrfToken(result.csrf);
    onChanged(result);
  }, null, true);
  return <main className="login-page password-change-page"><section className="login-panel panel password-change-panel">
    <p className="eyebrow">Primer acceso</p><h1>Actualiza tu contraseña</h1>
    <p className="muted">La contraseña inicial es temporal. Define una contraseña personal para continuar al dashboard.</p>
    {f.error && <Notice title="No se pudo actualizar la contraseña" tone="danger">{f.error}</Notice>}
    <form noValidate ref={f.form} onSubmit={f.submit} aria-busy={f.busy}><fieldset disabled={f.busy}>
      <Field label="Nueva contraseña" required error={f.errors.password}><SecretInput autoComplete="new-password" value={f.values.password} maxLength={128} onChange={e => f.change('password', e.target.value)} /></Field>
      <Field label="Repetir contraseña" required error={f.errors.password_confirmation}><SecretInput autoComplete="new-password" value={f.values.password_confirmation} maxLength={128} onChange={e => f.change('password_confirmation', e.target.value)} /></Field>
      <Button type="submit" variant="primary" className="w-full" busy={f.busy}>Guardar contraseña y continuar</Button>
    </fieldset></form>
  </section></main>;
}

export function SessionProvider({ children }) {
  useEffect(() => {
    const syncVisibility = () => document.documentElement.toggleAttribute('data-ui-hidden', document.hidden);
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      document.documentElement.removeAttribute('data-ui-hidden');
    };
  }, []);
  const [demo, setDemoState] = useState(() => new URLSearchParams(location.search).get('demo') === '1');
  const [identity, setIdentity] = useState(null);
  const [ready, setReady] = useState(demo);
  const [expired, setExpired] = useState(false);
  const [setup, setSetup] = useState(false);
  const [setupAllowed, setSetupAllowed] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const altasCache = useMemo(() => createAltasCache(), [identity?.user?.id, expired, demo]);
  useEffect(() => {
    if (demo) { setReady(true); setCsrfToken(''); return; }
    const controller = new AbortController(); let alive = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setError('');
    request('/api/auth/session', { signal: controller.signal }).then(value => {
      if (!alive || controller.signal.aborted) return;
      setCsrfToken(value.csrf); setSetup(Boolean(value.setup_required));
      setSetupAllowed(Boolean(value.web_bootstrap_allowed));
      if (value.user) { setIdentity(value); setExpired(false); }
      else { setExpired(true); window.dispatchEvent(new Event('sgrs-session-expired')); }
    }).catch(() => { if (alive) setError('Inicia el servidor local del dashboard para acceder con una cuenta.'); })
      .finally(() => { clearTimeout(timeout); if (alive) setReady(true); });
    // Timeout must terminate the initial loading state too.
    return () => { alive = false; clearTimeout(timeout); controller.abort(); };
  }, [demo, revision]);
  useEffect(() => {
    const onExpired = () => {
      if (!demo) {
        clearIdfViewSession(identity?.user?.id);
        setExpired(true);
      }
    };
    const check = () => { if (!demo && !expired) setRevision(value => value+1); };
    window.addEventListener('sgrs-session-expired', onExpired);
    window.addEventListener('focus', check);
    return () => { window.removeEventListener('sgrs-session-expired', onExpired); window.removeEventListener('focus', check); };
  }, [demo, expired, identity?.user?.id]);
  const setDemo = value => {
    setCsrfToken(''); setDemoState(value); setError(''); setExpired(false); setIdentity(null); setReady(value);
    const url = new URL(location.href); if (value) url.searchParams.set('demo', '1'); else url.searchParams.delete('demo');
    history.replaceState(null, '', url);
  };
  const signIn = async values => {
    const result = await request('/api/auth/login', { body: values }); setCsrfToken(result.csrf); setIdentity(result); setExpired(false); setReady(true); setError('');
  };
  const bootstrap = async values => { const result = await request('/api/auth/bootstrap', { body: values }); setCsrfToken(result.csrf); setIdentity(result); setSetup(false); setExpired(false); setReady(true); setError(''); };
  const signOut = async () => {
    const userId = identity?.user?.id;
    if (!demo) await request('/api/auth/logout', { body: {} });
    clearIdfViewSession(userId);
    setCsrfToken(''); setIdentity(null); setExpired(false);
  };
  const [demoRole, setDemoRole] = useState(() => new URLSearchParams(location.search).get('role') || 'super-admin');
  const switchDemoRole = newRole => {
    if (ROLE_PAGE_DEFAULTS[newRole]) {
      setDemoRole(newRole);
      const url = new URL(location.href);
      url.searchParams.set('role', newRole);
      history.replaceState(null, '', url);
    }
  };
  const activeDemoRole = demoRole in ROLE_PAGE_DEFAULTS ? demoRole : 'super-admin';
  const activeDemoPages = ROLE_PAGE_DEFAULTS[activeDemoRole];
  const demoCapabilities = activeDemoRole === 'super-admin'
    ? ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read', 'inventory.write', 'inventory.export', 'idf.visits.write', 'users.read', 'users.create', 'users.edit', 'users.delete', 'integrations.manage', 'traffic.read']
    : activeDemoRole === 'admin'
      ? ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read', 'inventory.write', 'inventory.export', 'idf.visits.write', 'users.read', 'users.create', 'users.edit', 'users.delete']
      : ['dashboard.read', 'inventory.read', 'idf.read', 'activity.read'];

  const computedDemo = {
    ...demoSession,
    roles: BASE_ROLE_CATALOG.filter(role => activeDemoRole === 'super-admin' || (activeDemoRole === 'admin' && role.id !== 'super-admin')),
    user: {
      ...demoSession.user,
      role: activeDemoRole,
      allowed_pages: activeDemoPages,
    },
    capabilities: demoCapabilities,
    allowed_pages: activeDemoPages,
    allowed_submodules: defaultSubmodules(activeDemoPages),
  };

  const current = demo ? computedDemo : identity;
  const userRole = current?.user?.role || 'viewer';
  const allowedPages = current?.allowed_pages
    || current?.user?.allowed_pages
    || ROLE_PAGE_DEFAULTS[userRole]
    || ROLE_PAGE_DEFAULTS.admin;

  const canViewPage = pageId => canViewPageId(pageId, allowedPages);
  const allowedSubmodules = current?.allowed_submodules || current?.user?.allowed_submodules || defaultSubmodules(allowedPages);
  const canViewSubmodule = (page, tab) => canViewSubmoduleId(page, tab, allowedPages, allowedSubmodules);

  const sessionRoles = getEffectiveRoles(current?.roles);

  return <SessionContext.Provider value={{
    altasCache,
    ...current,
    user: current?.user,
    allowedPages,
    allowed_pages: allowedPages,
    allowedSubmodules,
    allowed_submodules: allowedSubmodules,
    canViewPage,
    canViewSubmodule,
    roles: sessionRoles,
    demo,
    setDemo,
    demoRole: activeDemoRole,
    switchDemoRole,
    signOut,
    can: name => Boolean(current?.capabilities?.includes(name)),
  }}>
    {!ready ? <div className="login-page"><Loading /></div> : <>
      {current && (demo || !expired) && (current.must_change_password
        ? <PasswordChange onChanged={setIdentity} />
        : <div key={`${demo ? `demo-${activeDemoRole}` : 'live'}-${current.user.id}-${current.user.role}-${current.user.version}`}>{children}</div>)}
      {(!current || (!demo && expired)) && <Login onLogin={signIn} onBootstrap={bootstrap} setup={setup} setupAllowed={setupAllowed} error={error} retry={() => setRevision(r => r+1)} expired={Boolean(current)} />}
    </>}
  </SessionContext.Provider>;
}
