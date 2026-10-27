import React from 'react';
import { AlertCircle, CheckCircle2, Clock, FileText, HardDrive, Laptop, MapPin, Network, Package, ShieldCheck, Smartphone, Users, Wifi } from 'lucide-react';
import { Badge, Empty } from './components.jsx';
import { dateTime, statusNames } from './domain.mjs';

export function DetailGrid({ items, className = '' }) {
  return <dl className={`detail-grid ${className}`}>
    {items.map(([label, value, Icon, mono]) => <div className={`detail-field ${Icon ? 'has-icon' : ''}`} key={label} data-field={label}>
      <dt>{Icon && <span className="detail-field-icon"><Icon size={17} strokeWidth={1.7} aria-hidden="true" /></span>}{label}</dt>
      <dd className={mono ? 'font-mono' : undefined}>{value === null || value === undefined || value === '' ? 'Sin información' : value}</dd>
    </div>)}
  </dl>;
}

export function DetailIdentity({ name, subtitle, account, status, icon: Icon, initials }) {
  return <div className="detail-identity-card">
    <span className="detail-identity-symbol" aria-hidden="true">{Icon ? <Icon size={30} strokeWidth={1.5} /> : initials}</span>
    <div className="detail-identity-copy"><span className="detail-identity-label">{Icon ? 'Equipo en la red' : 'Cuenta de acceso'}</span><h3>{name}</h3><p>{subtitle}</p>{account && <span className="detail-identity-account"><Users size={13} aria-hidden="true" />{account}</span>}</div>
    {status !== undefined && <Badge status={status} />}
  </div>;
}

export function DetailSection({ title, source, icon: Icon, children, className = '' }) {
  return <section className={`detail-section-card ${className}`}>
    <header className="detail-card-heading"><span className="detail-card-symbol"><Icon size={19} strokeWidth={1.7} aria-hidden="true" /></span><h3>{title}</h3>{source && <span className="detail-source-tag">{source}</span>}</header>
    {children}
  </section>;
}

function AccountDevice({ device }) {
  const matched = Boolean(device.forti);
  const category = String(device.deviceCategory || '').trim();
  const DeviceIcon = /mobile|m[oó]vil|phone|tel[eé]fono|celular|tablet/i.test(category) ? Smartphone : Laptop;
  return <article className="account-device-card">
    <header className="account-device-header">
      <span className="account-device-symbol"><DeviceIcon size={19} aria-hidden="true" /></span>
      <strong>{device.deviceName || device.deviceMac || 'Dispositivo sin nombre'}</strong>
      <Badge status={device.forti?.status || device.status} />
    </header>
    <DetailGrid className="account-device-fields" items={[
      ['MAC', device.deviceMac || '—', Network, true],
      ['Equipo OmniVista', device.lastAccessDeviceName || '—', Package],
      ['Categoría / familia', [device.deviceCategory, device.deviceFamily].filter(Boolean).join(' · ') || '—', DeviceIcon],
      ['Sistema operativo', device.deviceOS || '—', HardDrive],
      ['Red OmniVista', device.lastAccessDeviceSSID || device.accessRoleProfile || '—', Wifi],
      ['Ubicación', device.lastAccessLocation || '—', MapPin],
      ['Última autenticación', device.lastAuthenticationTime ? dateTime(device.lastAuthenticationTime) : '—', Clock],
      ['Descripción', device.description || '—', FileText],
    ]} />
    <div className={`account-device-match ${matched ? 'is-matched' : ''}`}>
      {matched ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertCircle size={17} aria-hidden="true" />}
      <div><strong>Cotejo con FortiGate</strong><span>{device.cotejo || 'Sin verificar'}</span></div>
    </div>
    {matched && <section className="account-device-forti">
      <h4><ShieldCheck size={16} aria-hidden="true" />Información observada en FortiGate</h4>
      <DetailGrid items={[
        ['FortiGate · nombre', device.forti.hostname || device.forti.name || '—'],
        ['FortiGate · fabricante / modelo', [device.forti.vendor, device.forti.model].filter(Boolean).join(' · ') || '—'],
        ['FortiGate · sistema operativo', device.forti.os || '—'],
        ['FortiGate · IP', device.forti.ip || '—', null, true],
        ['FortiGate · tipo / interfaz', [device.forti.type, device.forti.interface].filter(Boolean).join(' · ') || '—'],
        ['FortiGate · última detección', device.forti.last_seen || '—'],
      ]} />
    </section>}
  </article>;
}

export function AccountDetails({ account }) {
  if (!account) return null;
  const name = account.fullName || account.username || 'Cuenta sin nombre';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const effectiveDate = account.omnivistaEffectiveDate ?? (account.customConcession ? null : account.dateOfEffective);
  return <div className="account-detail-content">
    <section aria-label="Información de la cuenta en OmniVista">
      <div className="detail-section-heading"><h3>Información de la cuenta en OmniVista</h3><span className="detail-source">OmniVista</span></div>
      <DetailIdentity name={name} subtitle={account.department || 'Cuenta de acceso a la red'} initials={initials} />
      <DetailGrid className="altas-account-details" items={[
        ['Cuenta', account.username], ['Departamento', account.department], ['Puesto', account.position],
        ['Correo electrónico', account.email], ['Teléfono', account.telephone],
        ['Fecha de alta', effectiveDate ? dateTime(Number(effectiveDate)) : null],
        ['Perfil de acceso', account.accessRoleProfile], ['Estado en OmniVista', statusNames[account.status] || account.status],
      ]} />
      <div className={`account-activity-notice ${account.activityAssessment?.status === 'active' ? 'is-active' : ''}`}>
        {account.activityAssessment?.status === 'active' ? <CheckCircle2 size={20} aria-hidden="true" /> : <AlertCircle size={20} aria-hidden="true" />}
        <div><strong>Actividad por cotejo</strong><p>{account.activityAssessment?.reason || 'Sin información suficiente para verificar la actividad de esta cuenta.'}</p></div>
      </div>
      {account.description && <div className="account-concession-note">
        <FileText size={17} aria-hidden="true" /><div><strong>Motivo de alta / Oficio</strong><p>{account.description}</p>
          {(account.effectiveTime || account.dateOfEffective) && <small>Límite de concesión: {dateTime(Number(account.effectiveTime || account.dateOfEffective))}</small>}
        </div>
      </div>}
    </section>
    <section aria-label="Dispositivos registrados">
      <div className="detail-section-heading"><h3>Dispositivos registrados <span className="detail-count">{account.devices?.length || 0}</span></h3></div>
      <p className="account-detail-caption">Cotejo entre Company Property de OmniVista y el inventario observado por FortiGate.</p>
      {account.devices?.length ? <div className="account-device-list">{account.devices.map((device, index) => <AccountDevice key={device.deviceMac || device.id || index} device={device} />)}</div>
        : <Empty title="Sin dispositivos asociados">OmniVista no tiene terminales asociadas a esta cuenta en la consulta actual.</Empty>}
    </section>
  </div>;
}
