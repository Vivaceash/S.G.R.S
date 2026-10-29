import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  EyeOff,
  HelpCircle,
  MapPin,
  Monitor,
  Network,
  Plus,
  Printer,
  RotateCcw,
  Router,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { Badge, Button, Dialog, RecordDialog, rowInteraction, Empty, InfiniteMore, Loading, IconButton, Notice, SearchField, downloadExcel } from './components.jsx';
import {
  SUPPORT_EXPORT_COLUMNS,
  SUPPORT_NETWORK_EXPORT_COLUMNS,
  buildSupportSheets,
  formatDeviceType,
  formatLocation,
  formatUptime,
  getSaturationLabel,
  getSaturationStatus,
  getSupportSegments,
  getUtilizationColor,
  getUtilizationTone,
  normalizeText,
  number,
  segmentKey,
} from './domain.mjs';
import { PageHeading } from './pages.jsx';
import { useSession } from './session.jsx';
import {
  DEFAULT_SUPPORT_LAYOUT,
  SUPPORT_WIDGET_CATALOG,
  getInstitutionalWifiDevices,
  sanitizeSupportLayout,
} from './support-widgets-domain.mjs';

const WIDGET_ICONS = {
  Network,
  Monitor,
  Printer,
  Wifi,
};

export function SupportDashboard({ data = {}, openEditor, loading, errors, refresh, demo }) {
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const session = useSession();
  const userId = session?.user?.id || 'default';
  const storageKey = `sgrs:support-dashboard-layout:v1:${demo ? 'demo:' : ''}${userId}`;

  // Layout personalizable de columnas
  const [layout, setLayout] = useState(() => {
    try {
      return sanitizeSupportLayout(JSON.parse(localStorage.getItem(storageKey)));
    } catch {
      return [...DEFAULT_SUPPORT_LAYOUT];
    }
  });

  const [customizing, setCustomizing] = useState(false);
  const [draftLayout, setDraftLayout] = useState(layout);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');

  // Sincronizar borrador al abrir personalización
  const startCustomizing = () => {
    setDraftLayout([...layout]);
    setCustomizing(true);
    setCatalogQuery('');
    setNoticeMessage('');
  };

  const saveCustomization = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(draftLayout));
      setLayout(draftLayout);
      setCustomizing(false);
      setNoticeMessage('Diseño de columnas guardado en tu navegador.');
    } catch {
      setNoticeMessage('No se pudo guardar la preferencia en el almacenamiento local.');
    }
  };

  const resetDefaultLayout = () => {
    setDraftLayout([...DEFAULT_SUPPORT_LAYOUT]);
  };

  const moveColumn = (id, direction) => {
    const list = customizing ? draftLayout : layout;
    const index = list.indexOf(id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    if (customizing) {
      setDraftLayout(next);
    } else {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setLayout(next);
      } catch {
        // Fallback silencioso
      }
    }
  };

  const removeColumn = (id) => {
    const next = (customizing ? draftLayout : layout).filter(item => item !== id);
    if (!next.length) return;
    if (customizing) {
      setDraftLayout(next);
    } else {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setLayout(next);
        setNoticeMessage('Columna ocultada. Puedes reactivarla desde "Personalizar dashboard".');
      } catch {
        // Fallback
      }
    }
  };

  const toggleDraftWidget = (id) => {
    if (draftLayout.includes(id)) {
      if (draftLayout.length <= 1) return; // Mínimo 1 columna
      setDraftLayout(draftLayout.filter(item => item !== id));
    } else {
      setDraftLayout([...draftLayout, id]);
    }
  };

  // Estados de búsqueda y ordenamiento de columnas
  const [networkQuery, setNetworkQuery] = useState('');
  const [computerQuery, setComputerQuery] = useState('');
  const [printerQuery, setPrinterQuery] = useState('');
  const [institutionalQuery, setInstitutionalQuery] = useState('');

  const [computerSort, setComputerSort] = useState('uptime');
  const [institutionalSort, setInstitutionalSort] = useState('uptime');
  const [institutionalWifiOnly, setInstitutionalWifiOnly] = useState(true);

  const [computerLimit, setComputerLimit] = useState(25);
  const [printerLimit, setPrinterLimit] = useState(25);
  const [institutionalLimit, setInstitutionalLimit] = useState(25);

  useEffect(() => setComputerLimit(25), [computerQuery, computerSort]);
  useEffect(() => setPrinterLimit(25), [printerQuery]);
  useEffect(() => setInstitutionalLimit(25), [institutionalQuery, institutionalSort, institutionalWifiOnly]);

  // Modal de exportación Excel
  const [exportOpen, setExportOpen] = useState(false);
  const [exportComputers, setExportComputers] = useState(true);
  const [exportPrinters, setExportPrinters] = useState(true);
  const [exportInstitutionalWifi, setExportInstitutionalWifi] = useState(false);
  const [exportNetworks, setExportNetworks] = useState(false);

  const allExportChecked = exportComputers && exportPrinters && exportInstitutionalWifi && exportNetworks;
  const onlyComputersChecked = exportComputers && !exportPrinters && !exportInstitutionalWifi && !exportNetworks;
  const onlyPrintersChecked = !exportComputers && exportPrinters && !exportInstitutionalWifi && !exportNetworks;
  const ambosChecked = exportComputers && exportPrinters && !exportInstitutionalWifi && !exportNetworks;
  const onlyNetworksChecked = !exportComputers && !exportPrinters && !exportInstitutionalWifi && exportNetworks;
  const hasAnyExportSelected = exportComputers || exportPrinters || exportInstitutionalWifi || exportNetworks;

  const selectAllExport = () => {
    setExportComputers(true);
    setExportPrinters(true);
    setExportInstitutionalWifi(true);
    setExportNetworks(true);
  };

  const selectAmbosExport = () => {
    setExportComputers(true);
    setExportPrinters(true);
    setExportInstitutionalWifi(false);
    setExportNetworks(false);
  };

  const selectComputersExport = () => {
    setExportComputers(true);
    setExportPrinters(false);
    setExportInstitutionalWifi(false);
    setExportNetworks(false);
  };

  const selectPrintersExport = () => {
    setExportComputers(false);
    setExportPrinters(true);
    setExportInstitutionalWifi(false);
    setExportNetworks(false);
  };

  const selectNetworksExport = () => {
    setExportComputers(false);
    setExportPrinters(false);
    setExportInstitutionalWifi(false);
    setExportNetworks(true);
  };

  const { segments = [], devices = [] } = data;
  const supportSegments = useMemo(() => getSupportSegments(segments), [segments]);

  // Balance y resumen de saturación
  const saturationSummary = useMemo(() => supportSegments.reduce((acc, s) => {
    const status = getSaturationStatus(s);
    if (status === 'critical') acc.critical++;
    else if (status === 'warning') acc.warning++;
    else if (status === 'normal') acc.normal++;

    const cap = Number(s.capacity) || 0;
    const occ = Number(s.active_leases) || 0;
    const free = s.available_ips != null ? Number(s.available_ips) : Math.max(0, cap - occ);

    acc.totalIps += cap;
    acc.occupiedIps += occ;
    acc.availableIps += free;
    return acc;
  }, { critical: 0, warning: 0, normal: 0, totalIps: 0, occupiedIps: 0, availableIps: 0 }), [supportSegments]);

  // 1. Redes y estados
  const filteredSegments = useMemo(() => supportSegments.filter(s => {
    if (!networkQuery.trim()) return true;
    const q = normalizeText(networkQuery);
    return (
      (s.name && normalizeText(s.name).includes(q)) ||
      (s.interface && normalizeText(s.interface).includes(q)) ||
      (s.subnet && normalizeText(s.subnet).includes(q)) ||
      (s.default_gateway && normalizeText(s.default_gateway).includes(q)) ||
      (s.vlan && normalizeText(s.vlan).includes(q)) ||
      (s.description && normalizeText(s.description).includes(q))
    );
  }), [supportSegments, networkQuery]);

  // 2. Computadoras conectadas
  const isComputer = d => {
    if (d.status !== 'online') return false;
    const os = d.os || d.omnivista?.os || d.raw?.os_name || '';
    const name = d.omnivista?.device_name || d.name || '';
    const type = formatDeviceType(d.type, os, name, d.vendor);
    return type === 'Computadora';
  };
  const computers = useMemo(() => devices.filter(isComputer), [devices]);

  const filteredComputers = useMemo(() => computers.filter(c => {
    if (!computerQuery.trim()) return true;
    const q = normalizeText(computerQuery);
    const ovName = normalizeText(c.omnivista?.device_name || '');
    const ovLoc = normalizeText(c.omnivista?.location || '');
    return (
      (c.name && normalizeText(c.name).includes(q)) ||
      (c.ip && normalizeText(c.ip).includes(q)) ||
      (c.mac && normalizeText(c.mac).includes(q)) ||
      (c.vendor && normalizeText(c.vendor).includes(q)) ||
      (c.os && normalizeText(c.os).includes(q)) ||
      ovName.includes(q) ||
      ovLoc.includes(q)
    );
  }), [computers, computerQuery]);

  const sortedComputers = useMemo(() => [...filteredComputers].sort((a, b) => {
    if (computerSort === 'uptime') {
      const aUptime = Number(a.uptime_seconds) || 0;
      const bUptime = Number(b.uptime_seconds) || 0;
      return bUptime - aUptime;
    }
    return 0;
  }), [filteredComputers, computerSort]);

  // 3. Impresoras conectadas
  const isPrinter = d => {
    if (d.status !== 'online') return false;
    const os = d.os || d.omnivista?.os || d.raw?.os_name || '';
    const name = d.omnivista?.device_name || d.name || '';
    const type = formatDeviceType(d.type, os, name, d.vendor);
    return type === 'Impresora';
  };
  const printers = useMemo(() => devices.filter(isPrinter), [devices]);

  const filteredPrinters = useMemo(() => printers.filter(p => {
    if (!printerQuery.trim()) return true;
    const q = normalizeText(printerQuery);
    const ovName = normalizeText(p.omnivista?.device_name || '');
    const ovLoc = normalizeText(p.omnivista?.location || '');
    return (
      (p.name && normalizeText(p.name).includes(q)) ||
      (p.ip && normalizeText(p.ip).includes(q)) ||
      (p.mac && normalizeText(p.mac).includes(q)) ||
      (p.vendor && normalizeText(p.vendor).includes(q)) ||
      (p.model && normalizeText(p.model).includes(q)) ||
      ovName.includes(q) ||
      ovLoc.includes(q)
    );
  }), [printers, printerQuery]);

  // 4. NUEVO: Institucionales por WIFI (hostname 04820300 en FortiGate + cotejo OmniVista por MAC)
  const institutionalWifiDevices = useMemo(() => {
    return getInstitutionalWifiDevices(devices, supportSegments, institutionalWifiOnly);
  }, [devices, supportSegments, institutionalWifiOnly]);

  const filteredInstitutional = useMemo(() => institutionalWifiDevices.filter(d => {
    if (!institutionalQuery.trim()) return true;
    const q = normalizeText(institutionalQuery);
    const ovName = normalizeText(d.omnivista?.device_name || '');
    const ovLoc = normalizeText(d.omnivista?.location || '');
    const ovAp = normalizeText(d.omnivista?.ap_name || '');
    const ovAcc = normalizeText(d.omnivista?.account || '');
    const host = normalizeText(d.hostname || d.name || d.raw?.host_name || '');
    const ip = normalizeText(d.ip || '');
    const mac = normalizeText(d.mac || '');
    return (
      host.includes(q) ||
      ip.includes(q) ||
      mac.includes(q) ||
      ovName.includes(q) ||
      ovLoc.includes(q) ||
      ovAp.includes(q) ||
      ovAcc.includes(q)
    );
  }), [institutionalWifiDevices, institutionalQuery]);

  const sortedInstitutional = useMemo(() => [...filteredInstitutional].sort((a, b) => {
    if (institutionalSort === 'uptime') {
      return (Number(b.uptime_seconds) || 0) - (Number(a.uptime_seconds) || 0);
    }
    if (institutionalSort === 'hostname') {
      const hA = String(a.hostname || a.name || '');
      const hB = String(b.hostname || b.name || '');
      return hA.localeCompare(hB, 'es-MX', { numeric: true });
    }
    if (institutionalSort === 'name') {
      const nA = String(a.omnivista?.device_name || a.name || '');
      const nB = String(b.omnivista?.device_name || b.name || '');
      return nA.localeCompare(nB, 'es-MX');
    }
    return 0;
  }), [filteredInstitutional, institutionalSort]);

  const handleExportExcel = async () => {
    if (!hasAnyExportSelected) return;
    const sheets = buildSupportSheets({
      computers,
      printers,
      institutionalWifi: institutionalWifiDevices,
      networks: supportSegments,
      includeComputers: exportComputers,
      includePrinters: exportPrinters,
      includeInstitutionalWifi: exportInstitutionalWifi,
      includeNetworks: exportNetworks,
      columns: SUPPORT_EXPORT_COLUMNS,
      networkColumns: SUPPORT_NETWORK_EXPORT_COLUMNS,
    });
    if (!sheets.length) return;

    let filename = 'reporte-soporte';
    if (onlyComputersChecked) filename = 'listado-soporte-computadoras';
    else if (onlyPrintersChecked) filename = 'listado-soporte-impresoras';
    else if (ambosChecked) filename = 'listado-soporte-dispositivos';
    else if (onlyNetworksChecked) filename = 'listado-soporte-redes';

    await downloadExcel(filename, sheets);
    setExportOpen(false);
  };

  const activeColumns = customizing ? draftLayout : layout;
  if (loading) return <><PageHeading title="Dashboard de Soporte" /><Loading /></>;
  if (errors?.devices || errors?.segments) return <Notice title="No se pudo cargar la información" tone="warning" action={<Button onClick={refresh}>Reintentar</Button>}>{errors.devices || errors.segments}</Notice>;

  return (
    <>
      <RecordDialog row={selectedNetwork} columns={SUPPORT_NETWORK_EXPORT_COLUMNS} title="Información de la red" onClose={() => setSelectedNetwork(null)} />
      {data.networksPartial && <Notice title="Consulta de redes incompleta" tone="warning">Una fuente no está disponible. Usa el botón de actualización para volver a consultar.</Notice>}
      <PageHeading
        eyebrow="Atención y diagnóstico técnico"
        title="Dashboard de Soporte"
        description="Monitoreo operativo de segmentos de red, computadoras e impresoras en servicio"
        updatedAt={data.updatedAt}
      />

      {/* Barra de KPIs superiores con acción de personalización integrada en la misma línea */}
      <div className="support-kpi-bar" role="region" aria-label="Resumen de telemetría de soporte">
        <div className="support-kpi-group">
          <div className="support-kpi-card kpi-network">
            <div className="support-kpi-icon"><Network size={18} aria-hidden="true" /></div>
            <div className="support-kpi-info">
              <span className="support-kpi-count">{number(supportSegments.length)}</span>
              <span className="support-kpi-label">Redes y perfiles</span>
            </div>
          </div>

          <div className="support-kpi-divider" aria-hidden="true" />

          <div className="support-kpi-card kpi-computers">
            <div className="support-kpi-icon"><Monitor size={18} aria-hidden="true" /></div>
            <div className="support-kpi-info">
              <span className="support-kpi-count">{number(computers.length)}</span>
              <span className="support-kpi-label">Computadoras en línea</span>
            </div>
            <span className="support-kpi-pulse pulse-success" title="En servicio" />
          </div>

          <div className="support-kpi-divider" aria-hidden="true" />

          <div className="support-kpi-card kpi-printers">
            <div className="support-kpi-icon"><Printer size={18} aria-hidden="true" /></div>
            <div className="support-kpi-info">
              <span className="support-kpi-count">{number(printers.length)}</span>
              <span className="support-kpi-label">Impresoras en línea</span>
            </div>
            <span className="support-kpi-pulse pulse-info" title="En servicio" />
          </div>
        </div>

        {/* Acciones en la misma línea del encabezado: Personalizar Dashboard y Exportar Excel */}
        <div className="support-kpi-actions">
          <Button
            icon={Settings2}
            variant="secondary"
            className="support-personalize-action"
            onClick={startCustomizing}
            disabled={customizing}
            title="Personaliza las columnas visibles y su orden en el tablero de soporte"
          >
            Personalizar dashboard
          </Button>

          <Button
            icon={Download}
            variant="primary"
            className="support-export-action"
            onClick={() => setExportOpen(true)}
          >
            Exportar listado Excel
          </Button>
        </div>
      </div>

      {noticeMessage && (
        <p className="widget-save-message" role="status" style={{ margin: '8px 0 14px' }}>
          <Check size={16} aria-hidden="true" />
          {noticeMessage}
        </p>
      )}

      {/* Panel interactivo de personalización de columnas de Soporte */}
      {customizing && (
        <section className="support-customize-panel" aria-label="Editor de columnas de soporte">
          <div className="support-customize-header">
            <div>
              <h3><SlidersHorizontal size={18} aria-hidden="true" /> Personalizar columnas de soporte</h3>
              <p>Agrega, remueve o reordena las columnas de telemetría y diagnóstico técnico. Tu diseño se conserva en este navegador.</p>
            </div>
            <Button icon={RotateCcw} onClick={resetDefaultLayout}>
              Restablecer diseño
            </Button>
          </div>

          <SearchField
            defer
            value={catalogQuery}
            onChange={setCatalogQuery}
            placeholder="Buscar widgets o columnas disponibles…"
          />

          <div className="support-customize-catalog">
            {SUPPORT_WIDGET_CATALOG.filter(w => {
              if (!catalogQuery.trim()) return true;
              const q = normalizeText(catalogQuery);
              return (
                normalizeText(w.title).includes(q) ||
                normalizeText(w.description).includes(q) ||
                normalizeText(w.category).includes(q)
              );
            }).map(w => {
              const active = draftLayout.includes(w.id);
              const IconComp = WIDGET_ICONS[w.iconName] || Network;
              return (
                <article key={w.id} className={`support-catalog-card ${active ? 'is-active' : ''}`}>
                  <div className="support-catalog-card-header">
                    <span className="support-catalog-title">
                      <IconComp size={18} className={`text-${w.tone}`} aria-hidden="true" />
                      {w.title}
                    </span>
                    <span className="support-catalog-category">{w.category}</span>
                  </div>
                  <p className="support-catalog-desc">{w.description}</p>
                  <Button
                    icon={active ? Trash2 : Plus}
                    variant={active ? 'secondary' : 'primary'}
                    onClick={() => toggleDraftWidget(w.id)}
                  >
                    {active ? 'Quitar columna' : 'Agregar columna'}
                  </Button>
                </article>
              );
            })}
          </div>

          <div className="support-customize-footer">
            <span><strong>{draftLayout.length}</strong> columnas seleccionadas · Vista previa editable</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={() => setCustomizing(false)}>Cancelar</Button>
              <Button variant="primary" onClick={saveCustomization}>Guardar diseño</Button>
            </div>
          </div>
        </section>
      )}

      {/* Grid modular y adaptable de columnas de Soporte */}
      <section
        className="support-dashboard-grid"
        style={{ '--support-cols': activeColumns.length }}
        aria-label="Tablero de columnas para soporte"
      >
        {activeColumns.map((colId, colIndex) => {
          const colDef = SUPPORT_WIDGET_CATALOG.find(item => item.id === colId);
          const ColIcon = colDef ? WIDGET_ICONS[colDef.iconName] || Network : Network;

          const renderControls = () => {
            if (!customizing) return null;
            return (
              <div className="support-column-controls">
                <IconButton
                  icon={ArrowLeft}
                  label={`Mover ${colDef?.title || 'columna'} a la izquierda`}
                  disabled={colIndex === 0}
                  onClick={() => moveColumn(colId, -1)}
                />
                <IconButton
                  icon={ArrowRight}
                  label={`Mover ${colDef?.title || 'columna'} a la derecha`}
                  disabled={colIndex === activeColumns.length - 1}
                  onClick={() => moveColumn(colId, 1)}
                />
                <IconButton
                  icon={EyeOff}
                  label={`Ocultar ${colDef?.title || 'columna'}`}
                  onClick={() => removeColumn(colId)}
                />
              </div>
            );
          };

          // -------------------------------------------------------------
          // Columna 1: Listado de redes y estados
          // -------------------------------------------------------------
          if (colId === 'networks') {
            return (
              <div key={colId} className="support-column">
                <div className="support-column-header">
                  <div className="support-column-title">
                    <ColIcon size={20} className="text-brand" aria-hidden="true" />
                    <h3>Listado de redes y estados</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="support-column-badge">{number(filteredSegments.length)}</span>
                    {renderControls()}
                  </div>
                </div>

                {/* Panel resumen de saturación */}
                <div className="support-saturation-panel" aria-label="Resumen de saturación de redes">
                  <div className="support-saturation-counts">
                    <span className="badge badge-danger" title="Redes saturadas / críticas con utilización >= 80%">
                      <span className="badge-dot" aria-hidden="true" />
                      <strong>{saturationSummary.critical}</strong> {saturationSummary.critical === 1 ? 'Saturada' : 'Saturadas'}
                    </span>
                    <span className="badge badge-warning" title="Redes en uso medio con utilización entre 50% y 79%">
                      <span className="badge-dot" aria-hidden="true" />
                      <strong>{saturationSummary.warning}</strong> Uso medio
                    </span>
                    <span className="badge badge-success" title="Redes disponibles con utilización < 50%">
                      <span className="badge-dot" aria-hidden="true" />
                      <strong>{saturationSummary.normal}</strong> {saturationSummary.normal === 1 ? 'Disponible' : 'Disponibles'}
                    </span>
                  </div>
                  <div className="support-saturation-balance">
                    <div className="support-balance-col">
                      <span className="support-balance-lbl">Total IPs</span>
                      <strong className="support-balance-num">{number(saturationSummary.totalIps)}</strong>
                    </div>
                    <div className="support-balance-col">
                      <span className="support-balance-lbl">IPs Ocupadas</span>
                      <strong className="support-balance-num text-danger">{number(saturationSummary.occupiedIps)}</strong>
                    </div>
                    <div className="support-balance-col">
                      <span className="support-balance-lbl">IPs Libres</span>
                      <strong className="support-balance-num text-success">{number(saturationSummary.availableIps)}</strong>
                    </div>
                  </div>
                </div>

                <div className="support-column-search">
                  <SearchField
                    defer
                    value={networkQuery}
                    onChange={setNetworkQuery}
                    placeholder="Buscar red, VLAN o gateway…"
                  />
                </div>

                <div className="support-column-body" tabIndex={0} aria-label="Lista de redes y segmentos">
                  {filteredSegments.length ? (
                    filteredSegments.map(segment => {
                      const satStatus = getSaturationStatus(segment);
                      const satLabel = getSaturationLabel(satStatus);
                      const meterTone = getUtilizationTone(segment.utilization_percent);
                      const meterColor = getUtilizationColor(segment.utilization_percent);
                      const freeIps = segment.available_ips ?? (segment.capacity != null && segment.active_leases != null ? Math.max(0, Number(segment.capacity) - Number(segment.active_leases)) : null);

                      return (
                        <article key={segmentKey(segment)} className="support-item-card support-network-card" {...rowInteraction(() => setSelectedNetwork(segment))}>
                          <div className="support-card-header-row">
                            <div className="support-card-heading-group">
                              <div className="support-card-icon-pill network-pill">
                                <Network size={16} aria-hidden="true" />
                              </div>
                              <div className="support-card-title-stack">
                                <strong className="support-card-main-title">{segment.name || segment.interface}</strong>
                                <div className="support-card-subtags">
                                  <span className="support-vlan-tag">VLAN: {segment.vlan || segment.interface || '—'}</span>
                                  <span className="support-mono-ip font-mono">{segment.subnet || segment.ip_ranges?.[0] || 'Rango no informado'}</span>
                                </div>
                              </div>
                            </div>
                            <Badge status={satStatus}>{satLabel}</Badge>
                          </div>

                          <div className="support-network-stats-grid">
                            <div className="support-stat-cell stat-danger">
                              <span className="support-stat-lbl">IPs Ocupadas</span>
                              <strong className="support-stat-num text-danger">{number(segment.active_leases)}</strong>
                            </div>
                            <div className="support-stat-cell stat-success">
                              <span className="support-stat-lbl">IPs Libres</span>
                              <strong className="support-stat-num text-success">{number(freeIps)}</strong>
                            </div>
                            <div className="support-stat-cell stat-total">
                              <span className="support-stat-lbl">Capacidad</span>
                              <strong className="support-stat-num">{number(segment.capacity)}</strong>
                            </div>
                          </div>

                          <div className="support-meter-block">
                            <div className="support-meter-header">
                              <span className="support-gateway-hint">
                                <Router size={13} aria-hidden="true" /> {segment.default_gateway || 'Sin gateway'}
                              </span>
                              <span className={`support-sat-indicator sat-${satStatus}`}>
                                {segment.utilization_percent == null ? 'Capacidad DHCP no informada' : <><strong>{number(segment.utilization_percent)}%</strong> utilizado ({satLabel})</>}
                              </span>
                            </div>
                            {segment.utilization_percent != null && <div className={`capacity-meter capacity-meter-${meterTone}`} style={{ '--meter-fill': meterColor }}>
                              <meter min="0" max="100" value={segment.utilization_percent || 0} aria-label={`Utilización de ${segment.name || segment.interface}`} />
                            </div>}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="support-empty-state">
                      <p>No se encontraron redes coincidentes.</p>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          // -------------------------------------------------------------
          // Columna 2: Computadoras conectadas
          // -------------------------------------------------------------
          if (colId === 'computers') {
            return (
              <div key={colId} className="support-column">
                <div className="support-column-header">
                  <div className="support-column-title">
                    <ColIcon size={20} className="text-success" aria-hidden="true" />
                    <h3>Computadoras conectadas</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="support-column-badge badge-success">{number(filteredComputers.length)}</span>
                    {renderControls()}
                  </div>
                </div>

                <div className="support-column-search">
                  <SearchField
                    defer
                    value={computerQuery}
                    onChange={setComputerQuery}
                    placeholder="Buscar computadora, IP, usuario…"
                  />
                  <div className="support-column-sort">
                    <ArrowUpDown size={14} className="text-muted" aria-hidden="true" />
                    <label htmlFor="computer-sort-select" className="support-sort-label">Ordenar:</label>
                    <select
                      id="computer-sort-select"
                      className="support-sort-select"
                      value={computerSort}
                      onChange={e => setComputerSort(e.target.value)}
                      aria-label="Criterio de ordenamiento de computadoras"
                    >
                      <option value="standard">En línea (estándar)</option>
                      <option value="uptime">Mayor tiempo conectadas (Top Uptime)</option>
                    </select>
                  </div>
                </div>

                <div className="support-column-body" tabIndex={0} aria-label="Lista de computadoras conectadas">
                  {sortedComputers.length ? (
                    sortedComputers.slice(0, computerLimit).map((pc, idx) => {
                      const displayName = pc.omnivista?.device_name || pc.name || 'Computadora';
                      const loc = pc.omnivista?.location || formatLocation(pc.location, pc.vendor);
                      return (
                        <article
                          key={`${pc.mac || pc.ip || idx}`}
                          className="support-item-card support-device-card"
                          role="button"
                          {...rowInteraction(() => openEditor?.('device-detail', pc))}
                          title={`Ver detalle técnico de ${displayName}`}
                        >
                          <div className="support-card-header-row">
                            <div className="support-card-heading-group">
                              <div className="support-card-icon-pill device-pill">
                                <Monitor size={17} aria-hidden="true" />
                              </div>
                              <div className="support-card-title-stack">
                                <strong className="support-card-main-title">{displayName}</strong>
                                <div className="support-card-subtags">
                                  {pc.omnivista?.matched ? (
                                    <span className="network-tag omni-tag" title="Cotejado con OmniVista 2500">OmniVista</span>
                                  ) : (
                                    <span className="support-unmatched-tag">Solo Red</span>
                                  )}
                                  {pc.vendor && <span className="support-vendor-tag">{pc.vendor}</span>}
                                </div>
                              </div>
                            </div>
                            <Badge status={pc.status} />
                          </div>

                          <div className="support-tech-box">
                            <div className="support-tech-item">
                              <span className="support-tech-lbl">Dirección IP</span>
                              <span className="support-tech-val ip-mono">{pc.ip || '—'}</span>
                            </div>
                            <div className="support-tech-item">
                              <span className="support-tech-lbl">MAC Address</span>
                              <span className="support-tech-val mac-mono">{pc.mac || '—'}</span>
                            </div>
                          </div>

                          <div className="support-card-details-grid">
                            <div className="support-detail-item">
                              <MapPin size={13} className="text-muted" aria-hidden="true" />
                              <span className="support-detail-text" title={loc}>{loc && loc !== '—' ? loc : 'Ubicación no especificada'}</span>
                            </div>
                            {pc.uptime_seconds != null && (
                              <div className="support-detail-item">
                                <Clock size={13} className="text-muted" aria-hidden="true" />
                                <span className="support-detail-text" title={`Tiempo observado: ${formatUptime(pc.uptime_seconds)}`}>
                                  Conectado: <strong>{formatUptime(pc.uptime_seconds)}</strong>
                                </span>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="support-empty-state">
                      <p>No se encontraron computadoras en línea coincidentes.</p>
                    </div>
                  )}
                  <InfiniteMore count={computerLimit} total={sortedComputers.length} onMore={() => setComputerLimit(value => value + 25)} />
                </div>
              </div>
            );
          }

          // -------------------------------------------------------------
          // Columna 3: Impresoras conectadas
          // -------------------------------------------------------------
          if (colId === 'printers') {
            return (
              <div key={colId} className="support-column">
                <div className="support-column-header">
                  <div className="support-column-title">
                    <ColIcon size={20} className="text-info" aria-hidden="true" />
                    <h3>Impresoras conectadas</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="support-column-badge badge-info">{number(filteredPrinters.length)}</span>
                    {renderControls()}
                  </div>
                </div>

                <div className="support-column-search">
                  <SearchField
                    defer
                    value={printerQuery}
                    onChange={setPrinterQuery}
                    placeholder="Buscar impresora, IP, modelo…"
                  />
                </div>

                <div className="support-column-body" tabIndex={0} aria-label="Lista de impresoras conectadas">
                  {filteredPrinters.length ? (
                    filteredPrinters.slice(0, printerLimit).map((printer, idx) => {
                      const displayName = printer.omnivista?.device_name || printer.name || 'Impresora';
                      const loc = printer.omnivista?.location || formatLocation(printer.location, printer.vendor);
                      return (
                        <article
                          key={`${printer.mac || printer.ip || idx}`}
                          className="support-item-card support-device-card support-printer-card"
                          role="button"
                          {...rowInteraction(() => openEditor?.('device-detail', printer))}
                          title={`Ver detalle técnico de ${displayName}`}
                        >
                          <div className="support-card-header-row">
                            <div className="support-card-heading-group">
                              <div className="support-card-icon-pill printer-pill">
                                <Printer size={17} aria-hidden="true" />
                              </div>
                              <div className="support-card-title-stack">
                                <strong className="support-card-main-title">{displayName}</strong>
                                <div className="support-card-subtags">
                                  {printer.omnivista?.matched ? (
                                    <span className="network-tag omni-tag" title="Cotejado con OmniVista 2500">OmniVista</span>
                                  ) : (
                                    <span className="support-unmatched-tag">Solo Red</span>
                                  )}
                                  {(printer.model || printer.vendor) && (
                                    <span className="support-vendor-tag">{printer.model || printer.vendor}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Badge status={printer.status} />
                          </div>

                          <div className="support-tech-box">
                            <div className="support-tech-item">
                              <span className="support-tech-lbl">Dirección IP</span>
                              <span className="support-tech-val ip-mono">{printer.ip || '—'}</span>
                            </div>
                            <div className="support-tech-item">
                              <span className="support-tech-lbl">MAC Address</span>
                              <span className="support-tech-val mac-mono">{printer.mac || '—'}</span>
                            </div>
                          </div>

                          <div className="support-card-details-grid">
                            <div className="support-detail-item full-width">
                              <MapPin size={13} className="text-muted" aria-hidden="true" />
                              <span className="support-detail-text" title={loc}>{loc && loc !== '—' ? loc : 'Printer'}</span>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="support-empty-state">
                      <p>No se encontraron impresoras en línea coincidentes.</p>
                    </div>
                  )}
                  <InfiniteMore count={printerLimit} total={filteredPrinters.length} onMore={() => setPrinterLimit(value => value + 25)} />
                </div>
              </div>
            );
          }

          // -------------------------------------------------------------
          // Columna 4: WIDGET - Institucionales por WIFI
          // -------------------------------------------------------------
          if (colId === 'institutional-wifi') {
            return (
              <div key={colId} className="support-column">
                <div className="support-column-header">
                  <div className="support-column-title">
                    <ColIcon size={20} className="text-brand" aria-hidden="true" />
                    <h3>Institucionales por WIFI</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="support-column-badge badge-purple" title="Equipos institucionales (04820300) cotejados con OmniVista">
                      {number(filteredInstitutional.length)}
                    </span>
                    {renderControls()}
                  </div>
                </div>

                <div className="support-column-search">
                  <SearchField
                    defer
                    value={institutionalQuery}
                    onChange={setInstitutionalQuery}
                    placeholder="Buscar hostname (04820300), IP, MAC o AP…"
                  />
                  <div className="support-column-sort">
                    <ArrowUpDown size={14} className="text-muted" aria-hidden="true" />
                    <label htmlFor="inst-sort-select" className="support-sort-label">Ordenar:</label>
                    <select
                      id="inst-sort-select"
                      className="support-sort-select"
                      value={institutionalSort}
                      onChange={e => setInstitutionalSort(e.target.value)}
                      aria-label="Criterio de ordenamiento de institucionales"
                    >
                      <option value="uptime">Mayor tiempo conectados (Top Uptime)</option>
                      <option value="hostname">Hostname Fortinet (04820300-…)</option>
                      <option value="name">Nombre OmniVista</option>
                    </select>
                  </div>

                  <div className="support-filter-tabs" role="tablist" aria-label="Filtro de conectividad institucional">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={institutionalWifiOnly}
                      className={`support-filter-tab ${institutionalWifiOnly ? 'is-active' : ''}`}
                      onClick={() => setInstitutionalWifiOnly(true)}
                    >
                      Solo conectados por WiFi
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={!institutionalWifiOnly}
                      className={`support-filter-tab ${!institutionalWifiOnly ? 'is-active' : ''}`}
                      onClick={() => setInstitutionalWifiOnly(false)}
                    >
                      Todos los institucionales
                    </button>
                  </div>
                </div>

                <div className="support-column-body" tabIndex={0} aria-label="Lista de equipos institucionales por WiFi">
                  {sortedInstitutional.length ? (
                    sortedInstitutional.slice(0, institutionalLimit).map((instDev, idx) => {
                      const fortiHost = instDev.hostname || instDev.raw?.host_name || instDev.name || '04820300-—';
                      const ovName = instDev.omnivista?.device_name;
                      const displayName = ovName || fortiHost;
                      const loc = instDev.omnivista?.location || formatLocation(instDev.location, instDev.vendor);
                      const apName = instDev.omnivista?.ap_name;

                      return (
                        <article
                          key={`${instDev.mac || instDev.ip || idx}`}
                          className="support-item-card support-device-card support-institutional-card"
                          role="button"
                          {...rowInteraction(() => openEditor?.('device-detail', instDev))}
                          title={`Ver cotejo institucional de ${displayName}`}
                        >
                          <div className="support-card-header-row">
                            <div className="support-card-heading-group">
                              <div className="support-card-icon-pill wifi-pill">
                                <Wifi size={17} aria-hidden="true" />
                              </div>
                              <div className="support-card-title-stack">
                                <strong className="support-card-main-title">{displayName}</strong>
                                <div className="support-card-subtags">
                                  {instDev.omnivista?.matched ? (
                                    <span className="network-tag omni-tag" title="Cotejado con Company Property de OmniVista 2500">
                                      OmniVista
                                    </span>
                                  ) : (
                                    <span className="support-unmatched-tag">Solo Red</span>
                                  )}
                                  {fortiHost && fortiHost !== displayName && (
                                    <span className="support-vendor-tag font-mono">Forti: {fortiHost}</span>
                                  )}
                                  {instDev.vendor && <span className="support-vendor-tag">{instDev.vendor}</span>}
                                  {instDev.omnivista?.account && (
                                    <span className="support-user-badge">
                                      <Users size={11} aria-hidden="true" /> {instDev.omnivista.account}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Badge status={instDev.status} />
                          </div>

                          <div className="support-tech-box">
                            <div className="support-tech-item">
                              <span className="support-tech-lbl">Dirección IP</span>
                              <span className="support-tech-val ip-mono">{instDev.ip || '—'}</span>
                            </div>
                            <div className="support-tech-item">
                              <span className="support-tech-lbl">MAC Address</span>
                              <span className="support-tech-val mac-mono">{instDev.mac || '—'}</span>
                            </div>
                          </div>

                          <div className="support-card-details-grid">
                            {apName && (
                              <div className="support-detail-item">
                                <span className="support-ap-badge" title="Access Point en OmniVista">
                                  <Wifi size={11} aria-hidden="true" /> AP: <strong>{apName}</strong>
                                </span>
                              </div>
                            )}
                            <div className="support-detail-item">
                              <MapPin size={13} className="text-muted" aria-hidden="true" />
                              <span className="support-detail-text" title={loc}>{loc && loc !== '—' ? loc : 'Ubicación no especificada'}</span>
                            </div>
                            {instDev.uptime_seconds != null && (
                              <div className="support-detail-item">
                                <Clock size={13} className="text-muted" aria-hidden="true" />
                                <span className="support-detail-text" title={`Tiempo observado: ${formatUptime(instDev.uptime_seconds)}`}>
                                  Conectado: <strong>{formatUptime(instDev.uptime_seconds)}</strong>
                                </span>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="support-empty-state">
                      <p>No se encontraron equipos institucionales (04820300) {institutionalWifiOnly ? 'conectados por WiFi' : ''} coincidentes.</p>
                      {institutionalWifiOnly && (
                        <Button
                          variant="ghost"
                          onClick={() => setInstitutionalWifiOnly(false)}
                          style={{ marginTop: '8px' }}
                        >
                          Ver todos los institucionales (incluyendo cableados)
                        </Button>
                      )}
                    </div>
                  )}

                  <InfiniteMore count={institutionalLimit} total={sortedInstitutional.length} onMore={() => setInstitutionalLimit(value => value + 25)} />
                </div>
              </div>
            );
          }

          return null;
        })}
      </section>

      {/* Dialog interactivo para exportación Excel con hojas separadas */}
      <Dialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Exportar listado de dispositivos (Excel)"
        footer={
          <div className="dialog-actions">
            <Button onClick={() => setExportOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              icon={Download}
              disabled={!hasAnyExportSelected}
              onClick={handleExportExcel}
            >
              Descargar archivo Excel
            </Button>
          </div>
        }
      >
        <p className="dialog-description">
          Descarga el reporte de soporte en formato Excel (.xlsx). Las categorías seleccionadas se exportarán en un único archivo Excel separadas en hojas independientes (&ldquo;Computadoras&rdquo;, &ldquo;Impresoras&rdquo;, &ldquo;Institucionales WiFi&rdquo;, etc.).
        </p>

        <div className="support-export-modal-body">
          <div className="support-quick-selection">
            <span className="support-quick-label">Selección rápida:</span>
            <div className="support-quick-btn-group" style={{ flexWrap: 'wrap', gap: '6px' }}>
              <button
                type="button"
                className={`support-quick-btn ${allExportChecked ? 'is-active' : ''}`}
                onClick={selectAllExport}
              >
                Todos
              </button>
              <button
                type="button"
                className={`support-quick-btn ${ambosChecked ? 'is-active' : ''}`}
                onClick={selectAmbosExport}
              >
                Ambos
              </button>
              <button
                type="button"
                className={`support-quick-btn ${onlyComputersChecked ? 'is-active' : ''}`}
                onClick={selectComputersExport}
              >
                Solo computadoras
              </button>
              <button
                type="button"
                className={`support-quick-btn ${onlyPrintersChecked ? 'is-active' : ''}`}
                onClick={selectPrintersExport}
              >
                Solo impresoras
              </button>
              <button
                type="button"
                className={`support-quick-btn ${onlyNetworksChecked ? 'is-active' : ''}`}
                onClick={selectNetworksExport}
              >
                Solo redes
              </button>
            </div>
          </div>

          <div className="support-checkbox-list">
            <label className={`support-checkbox-card ${exportComputers ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={exportComputers}
                onChange={e => setExportComputers(e.target.checked)}
              />
              <div className="support-checkbox-details">
                <div className="support-checkbox-main">
                  <Monitor size={18} className="text-success" aria-hidden="true" />
                  <strong>Computadoras</strong>
                </div>
                <span className="support-checkbox-count">{number(computers.length)} equipos</span>
              </div>
            </label>

            <label className={`support-checkbox-card ${exportPrinters ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={exportPrinters}
                onChange={e => setExportPrinters(e.target.checked)}
              />
              <div className="support-checkbox-details">
                <div className="support-checkbox-main">
                  <Printer size={18} className="text-info" aria-hidden="true" />
                  <strong>Impresoras</strong>
                </div>
                <span className="support-checkbox-count">{number(printers.length)} equipos</span>
              </div>
            </label>

            <label className={`support-checkbox-card ${exportInstitutionalWifi ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={exportInstitutionalWifi}
                onChange={e => setExportInstitutionalWifi(e.target.checked)}
              />
              <div className="support-checkbox-details">
                <div className="support-checkbox-main">
                  <Wifi size={18} className="text-purple" aria-hidden="true" />
                  <strong>Institucionales por WIFI</strong>
                </div>
                <span className="support-checkbox-count">{number(institutionalWifiDevices.length)} equipos</span>
              </div>
            </label>

            <label className={`support-checkbox-card ${exportNetworks ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={exportNetworks}
                onChange={e => setExportNetworks(e.target.checked)}
              />
              <div className="support-checkbox-details">
                <div className="support-checkbox-main">
                  <Network size={18} className="text-brand" aria-hidden="true" />
                  <strong>Redes y estados</strong>
                </div>
                <span className="support-checkbox-count">{number(supportSegments.length)} redes</span>
              </div>
            </label>
          </div>

          {!hasAnyExportSelected && (
            <Notice tone="warning" title="Sin categorías seleccionadas">
              Selecciona al menos una categoría para poder descargar el listado Excel.
            </Notice>
          )}

          <div className="support-export-note">
            <small className="text-muted">
              El archivo contiene hojas independientes para cada widget seleccionado. Dispositivos incluye: Tipo, IP, MAC, Hostname, Interfaz, Uptime, Ubicación y Piso. Redes incluye: Nombre, Interfaz/VLAN, Segmento, Gateway, IPs Ocupadas, IPs Libres, Capacidad, Uso (%) y Estado.
            </small>
          </div>
        </div>
      </Dialog>
    </>
  );
}
