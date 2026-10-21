import { QUERY_TIMEOUT_MS } from './query-policy.mjs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock,
  FileText,
  Home,
  Menu,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  X,
  ArrowRight,
  Eye,
  CheckCircle2,
  Copy,
  Printer,
  Users,
  PlugZap,
  LogOut,
  Download,
  Monitor,
  Globe2,
  Radio,
  Camera,
  Headset,
  Package,
  Thermometer,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  Empty,
  IconButton,
  Loading,
  InfiniteMore,
  Notice,
  SearchField,
} from "./components.jsx";
import {
  Addresses,
  AuditLog,
  ProjectAuditLog,
  Devices,
  MeztliManagement,
  Overview,
  PageHeading,
  Requests,
  SupportDashboard,
  SupportInventory,
  SupportMovements,
} from "./pages.jsx";
import { EditForm, EntryForm, ResolveReport } from "./forms.jsx";
import {
  ApiError,
  roleLabel,
  dateTime,
  formatUptime,
  inventoryFromIdfs,
  reportsFromData,
  request,
  formatDeviceType,
  formatLocation,
  statusNames,
  IDF_VIEW_SESSION_PREFIX,
} from "./domain.mjs";
import { createDemo } from "./demo.mjs";
import { useSession } from "./session.jsx";
import {
  UsersPage,
  ConnectionsPage,
  initialDemoUsers,
  initialDemoConnections,
} from "./admin.jsx";
import {
  TelemetryNav,
  TelemetryPage,
  useTelemetryCatalog,
} from "./telemetry.jsx";
import { generateSvg } from "../qrcode.js";
import qrTemplate from "./assets/plantilla_qr.jpg";
import { createQrDocument, createQrPrintPages } from "./qr-document.mjs";
import { DocumentaryInventory } from "./inventory.jsx";
import { RefreshControl } from "./refresh-control.jsx";

const QR_ORIGIN = "http://192.168.38.250:3000";
const QR_SVG_STORAGE_PREFIX = "sgrs:qr-svg:v1:";
const qrSvgCache = new Map();

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function cachedQrSource(value, size) {
  const cacheKey = `${value}|${size}`;
  const memoryValue = qrSvgCache.get(cacheKey);
  if (memoryValue) return memoryValue;
  const storageKey = `${QR_SVG_STORAGE_PREFIX}${stableHash(cacheKey)}`;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved?.value === value && saved?.size === size && saved?.src) {
      qrSvgCache.set(cacheKey, saved.src);
      return saved.src;
    }
  } catch {}
  const svg = generateSvg(value, {
    size,
    margin: 4,
    colorDark: "#222222",
    colorLight: "#ffffff",
  });
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  qrSvgCache.set(cacheKey, source);
  try {
    localStorage.setItem(storageKey, JSON.stringify({ value, size, src: source }));
  } catch {}
  return source;
}

function buildQrValue(row, demo) {
  const url = new URL(QR_ORIGIN);
  // mobile_token is a permanent capability derived from the stable IDF id.
  // It intentionally remains unchanged so printed QR sheets never expire.
  url.searchParams.set("mobile", "1");
  url.searchParams.set("idf", row.id);
  if (row.mobile_token) url.searchParams.set("token", row.mobile_token);
  if (demo) url.searchParams.set("demo", "1");
  url.hash = "reporte";
  return url.toString();
}

function updateWithViewTransition(update) {
  // Panels already have a short CSS entry effect. Avoid taking full-page
  // snapshots and blocking successive selections for the same transition.
  update();
}

const emptyData = () => ({
  segments: [],
  ips: [],
  devices: [],
  meztliLeases: [],
  resources: [],
  requests: [],
  idfs: [],
  reports: {},
  audit: [],
  health: null,
  updatedAt: null,
});
const navItems = [
  ["resumen", "Dashboard", Home],
  ["soporte", "Dashboard Soporte", Headset],
  ["dispositivos", "Dispositivos", Monitor],
  ["disponibilidad", "IPs", Globe2],
  ["bitacora", "Bitácora", FileText],
  ["idf", "Registro IDF", Building2],
  ["aps", "Access Points", Radio],
  ["cctv", "CCTV", Camera],
  ["altas", "Gestión de altas", Wifi],
  ["gestion-meztli", "Gestión Meztli", ShieldAlert],
];
const adminItems = [
  ["usuarios", "Usuarios y privilegios", Users],
  ["conexiones", "Conexiones API", PlugZap],
];
const titles = {
  resumen: "Dashboard Operativo",
  soporte: "Dashboard de Soporte",
  altas: "Gestión de Altas de Red",
  inventario: "Recursos Disponibles",
  disponibilidad: "Direcciones IP",
  "gestion-meztli": "Gestión Meztli",
  dispositivos: "Dispositivos de Red",
  idf: "Registro IDF",
  entrada: "Registro IDF",
  bitacora: "Bitácora General de Movimientos",
  usuarios: "Usuarios y privilegios",
  conexiones: "Conexiones con las APIs",
};
function readRoute() {
  let raw = location.hash.slice(1) || "resumen";
  const [base, query = ""] = raw.split("?");
  const alias = { actividad: "bitacora", reporte: "entrada", qr: "idf" };
  return { path: alias[base] || base, params: new URLSearchParams(query), raw };
}
function Nav({
  route,
  navigate,
  administration = false,
  data,
  records = [],
  canViewPage = () => true,
  user,
  can = () => false,
}) {
  const active = route === "entrada" ? "idf" : route;
  const badge = (path) => {
    if (!data) return null;
    if (path === "disponibilidad")
      return data.ips.filter((ip) => ip.status === "available").length || null;
    if (path === "idf") {
      const activeReports = records.filter(
        (r) => r.status !== "resolved",
      ).length;
      return activeReports || null;
    }
    if (path === "dispositivos")
      return (
        data.devices.filter((device) => device.status === "online").length ||
        null
      );
    if (path === "soporte")
      return (
        data.devices.filter((device) => device.status === "online").length ||
        null
      );
    return null;
  };
  const link = ([path, label, Icon]) => {
    const count = badge(path);
    const hasPendingReports = path === "idf" && Boolean(count);
    return (
      <a
        key={path}
        className={hasPendingReports ? "nav-alert" : undefined}
        href={`#${path}`}
        aria-current={active === path ? "page" : undefined}
        onClick={(e) => {
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            navigate(path);
          }
        }}
      >
        <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
        <span>{label}</span>
        {count && <b className="nav-badge">{count}</b>}
      </a>
    );
  };
  const canSeeNavigationPage = (path) =>
    canViewPage(path) && (path !== "bitacora" || can("activity.read"));

  if (administration) {
    const adminVisible = adminItems.filter(([path]) => {
      if (path === "usuarios" && (!can || !can("users.read"))) return false;
      if (
        path === "conexiones" &&
        user?.role !== "super-admin" &&
        (!can || !can("integrations.manage"))
      )
        return false;
      return canSeeNavigationPage(path);
    });
    if (!adminVisible.length) return null;
    return (
      <nav className="main-nav" aria-label="Administración">
        {adminVisible.map(link)}
      </nav>
    );
  }

  const group1 = navItems.filter(
    ([path]) =>
      [
        "resumen",
        "soporte",
        "dispositivos",
        "disponibilidad",
        "bitacora",
      ].includes(path) && canSeeNavigationPage(path),
  );
  const group2 = navItems.filter(
    ([path]) => ["idf", "aps", "cctv"].includes(path) && canSeeNavigationPage(path),
  );
  const group3 = navItems.filter(
    ([path]) => ["altas", "gestion-meztli"].includes(path) && canSeeNavigationPage(path),
  );

  return (
    <nav className="main-nav" aria-label="Navegación principal">
      {group1.length > 0 && <div className="nav-group">{group1.map(link)}</div>}
      {group2.length > 0 && (
        <div className="nav-group nav-group-infrastructure">
          <p>Infraestructura NOC</p>
          {group2.map(link)}
        </div>
      )}
      {group3.length > 0 && (
        <div className="nav-group nav-group-secondary">{group3.map(link)}</div>
      )}
    </nav>
  );
}
function Brand() {
  return (
    <div
      className="brand-image"
      role="img"
      aria-label="ISSSTE · Instituto de Seguridad y Servicios Sociales de los Trabajadores del Estado"
    />
  );
}
function ServiceStatus({ health, demo }) {
  return (
    <div className="service-list">
      {[
        ["FortiGate", health?.forti],
        ["OmniVista", health?.omni],
      ].map(([name, status]) => (
        <div key={name}>
          <span>{name}</span>
          <Badge
            status={
              status === true
                ? "normal"
                : status === false
                  ? "offline"
                  : "unknown"
            }
          >
            {demo
              ? "Ejemplo"
              : status === true
                ? "Servicio responde"
                : status === false
                  ? "Sin conexión"
                  : "Sin verificar"}
          </Badge>
        </div>
      ))}
    </div>
  );
}
function QrCard({
  row,
  demo,
  toast,
  compact = false,
  size = 300,
  template = false,
}) {
  const value = useMemo(
    () => buildQrValue(row, demo),
    [row.id, row.mobile_token, demo],
  );
  const idfNumber = String(row.id || "").match(/idf[-\s]?0*(\d+)/i)?.[1];
  const printableIdf = idfNumber ? `IDF-${Number(idfNumber)}` : row.name;
  const qrSrc = useMemo(() => cachedQrSource(value, size), [value, size]);
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Enlace copiado.");
    } catch {
      toast(
        "No se pudo copiar. Selecciona el enlace para copiarlo manualmente.",
      );
    }
  };

  if (template) {
    return (
      <div className="qr-card qr-template-card">
        <div className="qr-template-sheet-wrap">
          <div
            className="qr-template-sheet"
            role="img"
            aria-label={`Planilla carta con código QR para registrar una visita a ${row.name}`}
          >
            <img
              className="qr-template-background"
              src={qrTemplate}
              alt=""
              aria-hidden="true"
            />
            <div className="qr-template-code">
              <img src={qrSrc} alt={`Código QR para registrar una visita a ${row.name}`} />
            </div>
            <span className="qr-template-idf-label">{printableIdf}</span>
          </div>
        </div>
        <div className="qr-template-meta qr-template-screen-only">
          <div className="qr-template-meta-header">
            <strong>{row.name}</strong>
            <span className="qr-template-tag-sheet">Planilla carta oficial · Cartel de bitácora</span>
          </div>
          <div className="qr-url-row">
            <span className="qr-url-label">Enlace directo:</span>
            <a className="qr-url" href={value} target="_blank" rel="noopener noreferrer">
              {value}
            </a>
            <Button icon={Copy} onClick={copyUrl} className="qr-url-copy-btn">
              Copiar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`qr-card ${compact ? "qr-card-compact" : ""}`}>
      {!compact && (
        <>
          <p className="eyebrow">Registro de entrada</p>
          <h3>{row.name}</h3>
          <p>{row.zone}</p>
        </>
      )}
      <img
        width={size}
        height={size}
        src={qrSrc}
        alt={`Código QR para registrar una visita a ${row.name}`}
      />
      <div className="qr-url-row">
        <a className="qr-url" href={value}>
          {value}
        </a>
        <Button icon={Copy} onClick={copyUrl}>
          Copiar
        </Button>
      </div>
      {!compact && (
        <>
          <div className="flex justify-center gap-3">
            <Button icon={Printer} onClick={() => window.print()}>
              Imprimir
            </Button>
          </div>
          <p className="muted">
            El dispositivo que escanee debe poder acceder a esta dirección. Los
            enlaces localhost solo funcionan en este equipo.
          </p>
        </>
      )}
    </div>
  );
}
function DeviceDetail({ row, demo, canReadTraffic = false }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [traffic, setTraffic] = useState(null);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = async () => {
    if (!canReadTraffic || demo || !row?.ip || row.ip === "—") return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => current.abort(), 12000);
    try {
      const json = await request(
        `/api/traffic/ip/${encodeURIComponent(row.ip)}?limit=20&direction=all`,
        { signal: current.signal },
      );
      if (controller.current === current) setTraffic(json.data || json);
    } catch (e) {
      if (controller.current === current)
        setError(
          e.name === "AbortError"
            ? "La consulta tardó demasiado. Puedes volver a intentar."
            : e.message,
        );
    } finally {
      clearTimeout(timer);
      if (controller.current === current) setLoading(false);
    }
  };

  const ipDisplay =
    row?.ip_source === "unconfirmed"
      ? "Pendiente de confirmar"
      : row?.ip ||
        (row?.is_reserved && row?.reserved_ip
          ? `${row.reserved_ip} (reservada)`
          : "No informada");
  const macDisplay = row?.mac || "No informada";
  const serialDisplay =
    row?.serial ||
    row?.raw?.serial ||
    row?.omnivista?.serial ||
    row?.raw?.serial_number ||
    "No informado";
  const vendorDisplay = row?.vendor || row?.brand || "No informado";
  const modelDisplay =
    row?.model ||
    row?.raw?.model ||
    row?.brandModel ||
    row?.omnivista?.model ||
    "No informado";
  const osDisplay =
    row?.os || row?.omnivista?.os || row?.raw?.os_name || "No informado";
  const locationDisplay =
    row?.omnivista?.location ||
    formatLocation(row?.location, row?.vendor, row?.interface) ||
    "No informada";
  const typeDisplay = formatDeviceType(
    row?.type,
    osDisplay,
    row?.omnivista?.device_name || row?.name,
    vendorDisplay,
  );
  const statusDisplay =
    statusNames[row?.status] || row?.status || "No informado";
  const hostnameDisplay =
    row?.hostname ||
    row?.detected_device ||
    row?.omnivista?.device_name ||
    row?.name ||
    "No informado";
  const userDisplay = row?.user || row?.omnivista?.account || "No identificado";
  const fortigateDisplay = row?.fortigate || "No informado";

  const techDetails = [
    ["Nombre de equipo / Hostname", hostnameDisplay],
    ["Usuario identificado", userDisplay],
    ["Dirección IP", ipDisplay],
    ["Dirección MAC", macDisplay],
    ["Número de serie (serial)", serialDisplay],
    ["Fabricante", vendorDisplay],
    ["Modelo", modelDisplay],
    ["Sistema operativo", osDisplay],
    ["Tipo de dispositivo", typeDisplay],
    ["Ubicación física", locationDisplay],
    ["Interfaz de red", row?.interface || row?.vlan || "No informada"],
    ["FortiGate de procedencia", fortigateDisplay],
    ["Estado del equipo", statusDisplay],
    ["Última actividad", row?.activity || row?.last_seen || "Reciente"],
  ];

  return (
    <>
      <dl className="detail-grid">
        {techDetails.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd
              className={
                label.includes("IP") ||
                label.includes("MAC") ||
                label.includes("serie") ||
                label.includes("Hostname")
                  ? "font-mono"
                  : undefined
              }
            >
              {value || "No informado"}
            </dd>
          </div>
        ))}
      </dl>

      {row?.omnivista?.matched && (
        <div className="omni-detail-box">
          <div className="omni-detail-header">
            <CheckCircle2
              size={18}
              className="text-success"
              aria-hidden="true"
            />
            <h4>Información cotejada en OmniVista 2500</h4>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Nombre en OmniVista</dt>
              <dd>
                <strong>{row.omnivista.device_name || "—"}</strong>
              </dd>
            </div>
            <div>
              <dt>Cuenta asignada</dt>
              <dd>{row.omnivista.account || "Sin cuenta individual"}</dd>
            </div>
            <div>
              <dt>Ubicación física (IDF / Puerto)</dt>
              <dd>
                <strong className="text-location">
                  {row.omnivista.location || "No informada"}
                </strong>
              </dd>
            </div>
            <div>
              <dt>Punto de acceso (AP)</dt>
              <dd>{row.omnivista.ap_name || "No informado"}</dd>
            </div>
            <div>
              <dt>SSID reportado</dt>
              <dd>{row.omnivista.ssid || row.interface || "—"}</dd>
            </div>
            <div>
              <dt>Perfil de acceso</dt>
              <dd>{row.omnivista.profile || "—"}</dd>
            </div>
            <div>
              <dt>Categoría / Familia</dt>
              <dd>
                {[row.omnivista.category, row.omnivista.family]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </dd>
            </div>
            <div>
              <dt>Sistema operativo OmniVista</dt>
              <dd>{row.omnivista.os || "—"}</dd>
            </div>
            <div>
              <dt>Estado en OmniVista</dt>
              <dd>
                <Badge
                  status={
                    row.omnivista.status?.toLowerCase() === "online"
                      ? "online"
                      : "offline"
                  }
                />{" "}
                {row.omnivista.status || "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <div className="forti-detail-box">
        <div className="forti-detail-header">
          <ShieldCheck size={18} className="text-brand" aria-hidden="true" />
          <h4>Datos cotejados de la captura de FortiGate</h4>
        </div>
        <dl className="detail-grid">
          <div>
            <dt>Usuario identificado</dt>
            <dd>
              <strong>{row?.user || "No identificado"}</strong>
            </dd>
          </div>
          <div>
            <dt>Interfaz</dt>
            <dd className="font-mono">
              {row?.interface || row?.vlan || "No informada"}
            </dd>
          </div>
          <div>
            <dt>FortiGate de procedencia</dt>
            <dd>
              <strong>{row?.fortigate || "No informado"}</strong>
            </dd>
          </div>
          <div>
            <dt>Hostname / Detected Device</dt>
            <dd className="font-mono">
              {row?.hostname || row?.detected_device || "No informado"}
            </dd>
          </div>
          <div>
            <dt>Número de serie (Service Tag)</dt>
            <dd className="font-mono">
              {row?.serial || row?.raw?.serial || "No informado"}
            </dd>
          </div>
        </dl>
      </div>

      {(row?.uptime_seconds != null ||
        row?.first_connected_at != null ||
        row?.total_connected_seconds != null) && (
        <div className="uptime-detail-box">
          <div className="uptime-detail-header">
            <Clock size={18} className="text-brand" aria-hidden="true" />
            <h4>Histórico de Conexión y Permanencia</h4>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>Tiempo continuo actual</dt>
              <dd>
                <strong>
                  {row?.uptime_seconds != null
                    ? formatUptime(row.uptime_seconds)
                    : "—"}
                </strong>
              </dd>
            </div>
            <div>
              <dt>Conectado desde</dt>
              <dd>
                {row?.first_connected_at
                  ? dateTime(
                      typeof row.first_connected_at === "number" &&
                        row.first_connected_at < 1e12
                        ? row.first_connected_at * 1000
                        : row.first_connected_at,
                    )
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Tiempo acumulado en base de datos</dt>
              <dd>
                <strong>
                  {row?.total_connected_seconds != null
                    ? formatUptime(row.total_connected_seconds)
                    : "—"}
                </strong>
              </dd>
            </div>
          </dl>
        </div>
      )}

      {canReadTraffic && (
        <>
          <Button
            icon={RefreshCw}
            busy={loading}
            disabled={demo || !row.ip || row.ip === "—"}
            onClick={load}
          >
            Consultar telemetría de tráfico
          </Button>
          {demo && (
            <p className="muted">
              La telemetría requiere una conexión real con FortiGate.
            </p>
          )}
          {error && (
            <Notice title="No se pudo consultar el tráfico" tone="danger">
              {error}
            </Notice>
          )}
          {traffic && (
            <div className="traffic-summary">
              <h3>Telemetría consultada</h3>
              <dl className="detail-grid">
                <div>
                  <dt>Sesiones activas</dt>
                  <dd>{traffic.active_sessions_count ?? "—"}</dd>
                </div>
                <div>
                  <dt>Bytes enviados</dt>
                  <dd>{traffic.total_sent_bytes ?? "—"}</dd>
                </div>
                <div>
                  <dt>Bytes recibidos</dt>
                  <dd>{traffic.total_rcvd_bytes ?? "—"}</dd>
                </div>
              </dl>
              <h3>Sesiones recientes</h3>
              {traffic.sessions?.length ? (
                <ul className="detail-list">
                  {traffic.sessions.slice(0, 20).map((s, i) => (
                    <li key={i}>
                      <span>
                        {s.dst_ip || s.src_ip || "Destino no informado"}
                      </span>
                      <span>
                        {s.application || s.protocol_name || "Sin clasificar"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Sin sesiones reportadas.</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
function IdfHub({
  data,
  records,
  demo,
  userId,
  navigate,
  openEditor,
  canWrite,
  canEditInventory,
  canViewActivity,
  canViewInventory,
  canViewQrAllowed,
  canViewOverview,
  canOpenIdfs,
  notify,
  onResolve,
  loading,
  errors,
  refresh,
}) {
  const viewStorageKey = `${IDF_VIEW_SESSION_PREFIX}${userId || "anonymous"}`;
  const [viewState, setViewState] = useState(() => ({
    selectedId: "",
    tab: canViewActivity ? "activity" : canViewInventory ? "inventory" : "qr",
  }));
  const selectedId = canOpenIdfs ? viewState.selectedId : "";
  const [deviceLimit, setDeviceLimit] = useState(25);
  useEffect(() => setDeviceLimit(25), [selectedId]);
  const tab = viewState.tab;
  const idfs = useMemo(
    () => data.idfs.filter((idf) => idf.id !== "idf-13" && idf.name !== "IDF 13"),
    [data.idfs],
  );
  const canViewQr = canViewQrAllowed;
  const [qrDocumentBusy, setQrDocumentBusy] = useState(false);
  const qrPrintFrame = useRef(null);
  useEffect(() => () => {
    if (qrPrintFrame.current) {
      URL.revokeObjectURL(qrPrintFrame.current.src);
      qrPrintFrame.current.remove();
    }
  }, []);
  const exportQrDocument = async (print = false) => {
    if (qrDocumentBusy) return;
    setQrDocumentBusy(true);
    try {
      const entries = idfs.map(row => ({
        source: cachedQrSource(buildQrValue(row, demo), 900),
        label: String(row.id || '').match(/idf[-\s]?0*(\d+)/i)
          ? `IDF-${Number(String(row.id).match(/idf[-\s]?0*(\d+)/i)[1])}` : row.name,
      }));
      if (print) {
        if (qrPrintFrame.current) {
          URL.revokeObjectURL(qrPrintFrame.current.src);
          qrPrintFrame.current.remove();
        }
        const pages = await createQrPrintPages(qrTemplate, entries);
        const frame = document.createElement('iframe');
        frame.title = 'Documento de todos los QR de IDF';
        frame.style.cssText = 'position:fixed;width:1px;height:1px;bottom:0;right:0;border:0';
        const ready = new Promise((resolve, reject) => {
          frame.onload = async () => {
            try {
              await Promise.all([...frame.contentDocument.images].map(image => image.decode()));
              frame.contentWindow.focus();
              frame.contentWindow.print();
              resolve();
            } catch (error) { reject(error); }
          };
          frame.onerror = () => reject(new Error('No se pudo abrir el documento para imprimir.'));
        });
        frame.srcdoc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>QR de todos los IDF</title><style>@page{size:letter portrait;margin:0}html,body{margin:0;padding:0}img{display:block;width:100%;height:auto;break-after:page;page-break-after:always}img:last-child{break-after:auto;page-break-after:auto}@media print{img{width:8.5in;height:11in;object-fit:contain}}</style></head><body>${pages.map(source => `<img src="${source}" alt="Código QR de IDF">`).join('')}</body></html>`;
        qrPrintFrame.current = frame;
        document.body.appendChild(frame);
        await ready;
      } else {
        const blob = await createQrDocument(qrTemplate, entries);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'QR-todos-los-IDF.pdf';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } catch (error) {
      notify(error.message || 'No se pudo preparar el documento de QR.');
    } finally {
      setQrDocumentBusy(false);
    }
  };
  const firstTab = canViewActivity ? 'activity' : canViewInventory ? 'inventory' : 'qr';
  const selected = idfs.find((idf) => idf.id === selectedId) || null;
  const availableTab = (tab === 'activity' && canViewActivity) || (tab === 'inventory' && canViewInventory) || (tab === 'qr' && canViewQr) ? tab : firstTab;
  const unresolvedByIdf = useMemo(() => {
    const counts = new Map();
    for (const record of records) if (record.status !== "resolved") counts.set(record.idfId, (counts.get(record.idfId) || 0) + 1);
    return counts;
  }, [records]);
  const unresolved = idf => unresolvedByIdf.get(idf.id) || 0;
  const updateViewState = (next) => {
    setViewState((current) => ({ ...current, ...next }));
  };
  const choose = (id) => updateWithViewTransition(() => updateViewState({
    selectedId: id,
    tab: availableTab,
  }));
  const showAll = () => updateWithViewTransition(() => updateViewState({
    selectedId: "",
    tab: firstTab,
  }));
  useEffect(() => {
    try {
      sessionStorage.setItem(viewStorageKey, JSON.stringify(viewState));
    } catch {}
  }, [viewStorageKey, viewState]);
  useEffect(() => {
    if (!canViewOverview && canOpenIdfs && idfs.length && !selectedId) {
      updateViewState({ selectedId: idfs[0].id, tab: firstTab });
    }
  }, [canViewOverview, canOpenIdfs, firstTab, idfs, selectedId]);
  useEffect(() => {
    if (selectedId && !selected && !loading && !errors.idfs) updateViewState({ selectedId: "" });
  }, [selectedId, selected, loading, errors.idfs]);
  useEffect(() => {
    if (availableTab !== tab) updateViewState({ tab: availableTab });
  }, [availableTab, tab]);
  if (!idfs.length)
    return (
      <>
        <PageHeading
          eyebrow="Distribución y gabinetes"
          title="Registro IDF"
          description="Bitácora consolidada e inventario físico por gabinete"
          updatedAt={data.updatedAt}
        />
        {loading ? <Loading label="Cargando gabinetes IDF…" /> : <Empty title="Sin IDF disponibles">No hay gabinetes disponibles para este usuario.</Empty>}
      </>
    );
  const devices = selected
    ? data.resources.filter((resource) => resource.idfId === selected.id)
    : [];
  const renderIdfCards = () => idfs.map((idf) => {
    const alerts = unresolved(idf);
    const active = idf.id === selected?.id;
    const idfDevices = data.resources.filter((resource) => resource.idfId === idf.id);
    const deviceCount = canOpenIdfs ? idfDevices.length : idf.device_count || 0;
    const offlineCount = canOpenIdfs
      ? idfDevices.filter((device) => device.status === "offline").length
      : idf.offline_count || 0;
    const statusText = alerts
      ? `${alerts} ${alerts === 1 ? "alerta pendiente" : "alertas pendientes"}`
      : offlineCount
        ? `${offlineCount} ${offlineCount === 1 ? "equipo fuera de línea" : "equipos fuera de línea"}`
        : "Operativo";
    return (
      <button
        type="button"
        key={idf.id}
        aria-label={`${idf.name || idf.id}: ${statusText}`}
        aria-pressed={active}
        disabled={!canOpenIdfs}
        className={`idf-card ${active ? "is-active" : ""} ${alerts ? "has-alert" : ""} ${offlineCount ? "has-offline" : ""}`}
        onClick={() => choose(idf.id)}
      >
        <span className="idf-card-top">
          <strong>{idf.name || idf.id}</strong>
          <span className="idf-card-status">
            <i />
            {alerts ? "Atención" : offlineCount ? "Revisión" : "Operativo"}
          </span>
        </span>
        <span className="idf-card-metrics">
          <span>
            <b>{alerts}</b>
            <small>Alertas</small>
          </span>
          <span>
            <b>{deviceCount}</b>
            <small>Equipos</small>
          </span>
          <span className="idf-card-offline">
            <b>{offlineCount}</b>
            <small title="Equipos fuera de línea">Sin línea</small>
          </span>
        </span>
      </button>
    );
  });
  return (
    <>
      <PageHeading
        eyebrow="Distribución y gabinetes"
        title="Registro IDF"
        description={selected
          ? `Bitácora, inventario y acceso móvil de ${selected.name || selected.id}`
          : "Bitácora consolidada e inventario físico por gabinete"}
        updatedAt={data.updatedAt}
      />
      <section className="idf-console" aria-label="Centro de operación de IDF">
        <div className={`idf-cards ${selected ? "is-selected" : "is-overview"}`}>
          {renderIdfCards()}
        </div>
        {canOpenIdfs && (canViewActivity || canViewInventory || canViewQr) && (
          <div className="idf-console-tabs">
          <div
            className="idf-console-tablist"
            role="tablist"
            aria-label="Vista del IDF"
          >
            {canViewActivity && (
              <button
                role="tab"
                aria-selected={Boolean(selected && availableTab === "activity")}
                onClick={() => updateWithViewTransition(() => updateViewState({ selectedId: selectedId || idfs[0]?.id || '', tab: "activity" }))}
                disabled={!idfs.length}
              >
                Bitácora
              </button>
            )}
            {canViewInventory && <button
              role="tab"
              aria-selected={Boolean(selected && availableTab === "inventory")}
              onClick={() => updateWithViewTransition(() => updateViewState({ selectedId: selectedId || idfs[0]?.id || '', tab: "inventory" }))}
              disabled={!idfs.length}
            >
              Inventario
            </button>}
            {canViewQr && (
              <button
                role="tab"
                aria-selected={Boolean(selected && availableTab === "qr")}
                onClick={() => updateWithViewTransition(() => updateViewState({ selectedId: selectedId || idfs[0]?.id || '', tab: "qr" }))}
                disabled={!idfs.length}
              >
                Código QR
              </button>
            )}
          </div>
          <div className="idf-console-actions">
            {selected && canViewOverview && (
              <Button variant="secondary" onClick={showAll}>
                Ver todos los IDF
              </Button>
            )}
            {selected && canViewActivity && (
              <Button
                variant="primary"
                className="idf-report-action"
                onClick={() => navigate(`entrada?idf=${encodeURIComponent(selected.id)}`)}
                disabled={!canWrite}
              >
                + Levantar reporte
              </Button>
            )}
          </div>
          </div>
        )}
        {!selected && canViewOverview && (
          <section className="idf-panel idf-consolidated-panel">
            <AuditLog
              data={data}
              records={records}
              navigate={navigate}
              openEditor={openEditor}
              loading={loading}
              errors={errors}
              refresh={refresh}
              idfView={true}
              consolidated
              canWrite={false}
              canResolve={false}
              onResolve={onResolve}
            />
          </section>
        )}
        {selected && availableTab === "inventory" && (
          <section className="idf-panel">
            {devices.length ? (
              <div className="idf-device-table">
                <table>
                  <thead>
                    <tr>
                      <th>Dispositivo</th>
                      <th>Categoría</th>
                      <th>Nivel</th>
                      <th>Marca y modelo</th>
                      <th>N.º serie</th>
                      <th>Dirección MAC</th>
                      <th>Puertos</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.slice(0, deviceLimit).map((device) => (
                      <tr
                        key={device.id}
                        className={
                          device.status === "offline"
                            ? "device-row-offline"
                            : ""
                        }
                      >
                        <td>
                          <strong>
                            {device.name ||
                              device.desc ||
                              device.type ||
                              "Equipo no descrito"}
                          </strong>
                        </td>
                        <td>{device.category || device.type || "—"}</td>
                        <td>{device.ru || "—"}</td>
                        <td>
                          {device.brand ||
                            device.brandModel ||
                            device.model ||
                            "—"}
                        </td>
                        <td className="font-mono">{device.serial || "—"}</td>
                        <td className="font-mono">{device.mac || "—"}</td>
                        <td>{device.ports || "—"}</td>
                        <td>
                          <Badge status={device.status}>
                            {device.status === "offline"
                              ? "Fuera de línea"
                              : undefined}
                          </Badge>
                        </td>
                        <td>
                          {canEditInventory ? (
                            <Button
                              onClick={() => openEditor("resource", device)}
                            >
                              Actualizar
                            </Button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <InfiniteMore count={deviceLimit} total={devices.length} onMore={() => setDeviceLimit(value => value + 25)} />
              </div>
            ) : (
              <Empty title="Sin equipos documentados">
                Este gabinete aún no tiene dispositivos registrados en el
                inventario.
              </Empty>
            )}
          </section>
        )}
        {selected && availableTab === "activity" && (
          <section className="idf-panel idf-audit-panel">
            <AuditLog
              data={data}
              records={records}
              navigate={navigate}
              openEditor={openEditor}
              loading={loading}
              errors={errors}
              refresh={refresh}
              idfView={true}
              filterIdf={selected?.name || selected?.id}
              canWrite={canWrite}
              canResolve={canWrite}
              onResolve={onResolve}
            />
          </section>
        )}
        {selected && availableTab === "qr" && (
          <section className="idf-panel idf-qr-panel">
            <div className="qr-showcase">
              <div className="qr-showcase-copy">
                <div className="qr-showcase-header">
                  <p className="eyebrow">Acceso móvil por código QR</p>
                  <h2>{selected.name || selected.id}</h2>
                  <p className="qr-showcase-subtitle">
                    Escanea directamente con la cámara de tu celular para abrir el formulario de bitácora y registro de visitas asignado a este cuarto de telecomunicaciones.
                  </p>
                </div>

                <div className="qr-host-bar">
                  <label htmlFor="qr-host">Origen permanente de los QR</label>
                  <div className="qr-host-controls">
                    <input
                      id="qr-host"
                      value={QR_ORIGIN}
                      readOnly
                    />
                  </div>
                  <small>
                    Todos los IDF usan esta misma dirección base. El celular debe poder acceder a ella desde la red institucional.
                  </small>
                </div>

                <div className="qr-direct-access-card">
                  <div className="qr-direct-code-box">
                    <img
                      src={cachedQrSource(buildQrValue(selected, demo), 220)}
                      alt={`Código QR directo de ${selected.name || selected.id}`}
                      className="qr-direct-img"
                    />
                    <span className="qr-direct-tag">Escaneo Directo</span>
                  </div>
                  <div className="qr-direct-info">
                    <h4>Escaneo rápido en pantalla</h4>
                    <p>
                      Apunta tu celular a este código para ingresar de inmediato al registro del <strong>{selected.name || selected.id}</strong> sin necesidad de imprimir.
                    </p>
                    <ol className="qr-steps-compact" aria-label="Pasos rápidos">
                      <li><b>1</b><span>Wi-Fi institucional</span></li>
                      <li><b>2</b><span>Apunta cámara</span></li>
                      <li><b>3</b><span>Registra entrada</span></li>
                    </ol>
                  </div>
                </div>

                <div className="qr-showcase-actions">
                  <Button icon={Printer} variant="primary" busy={qrDocumentBusy} onClick={() => exportQrDocument(true)}>
                    Imprimir todos los QR
                  </Button>
                  <Button icon={Download} disabled={qrDocumentBusy} onClick={() => exportQrDocument(false)}>
                    Descargar documento PDF
                  </Button>
                  <p className="qr-document-note">{idfs.length} carteles · Una hoja carta por IDF</p>
                </div>
              </div>

              <div className="qr-card-frame">
                <QrCard
                  row={selected}
                  demo={demo}
                  toast={notify}
                  compact
                  size={720}
                  template
                />
              </div>
            </div>
          </section>
        )}
      </section>
    </>
  );
}
function SupportWorkspace({ data, demo, openEditor, loading, errors, refresh, canEditInventory, initialTab }) {
  const { canViewSubmodule } = useSession();
  const [tab, setTab] = useState(() => ['dashboard', 'log', 'inventory'].includes(initialTab) ? initialTab : 'dashboard');
  const visibleTabs = ['dashboard', 'log', 'inventory'].filter(value => canViewSubmodule('soporte', value === 'dashboard' ? 'live' : value));
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];
  return <>
    <nav className="inventory-tabs" role="tablist" aria-label="Vistas de Dashboard de soporte">
      {canViewSubmodule('soporte', 'live') && <button type="button" role="tab" aria-selected={activeTab === 'dashboard'} onClick={() => setTab('dashboard')}><Monitor size={15} /> En vivo</button>}
      {canViewSubmodule('soporte', 'log') && <button type="button" role="tab" aria-selected={activeTab === 'log'} onClick={() => setTab('log')}><FileText size={15} /> Bitácora de soporte</button>}
      {canViewSubmodule('soporte', 'inventory') && <button type="button" role="tab" aria-selected={activeTab === 'inventory'} onClick={() => setTab('inventory')}><Package size={15} /> Inventario soporte IDF 3</button>}
    </nav>
    {activeTab === 'dashboard' && <SupportDashboard data={data} demo={demo} openEditor={openEditor} loading={loading} errors={errors} refresh={refresh} />}
    {activeTab === 'log' && <SupportMovements demo={demo} />}
    {activeTab === 'inventory' && <SupportInventory canEdit={canEditInventory} />}
  </>;
}

export default function App() {
  const { demo, setDemo, user, can, signOut, allowedPages, canViewPage, canViewSubmodule } =
    useSession();
  const canOpenIdfs = Boolean(allowedPages?.includes("idf") && can("idf.read"));
  const canViewIdfOverview = Boolean(allowedPages?.includes("bitacora-idf") && can("activity.read"));
  const idfDataView = canOpenIdfs ? "" : canViewIdfOverview ? "?view=general" : null;
  const canReadIdfReports = Boolean(((canOpenIdfs && canViewSubmodule('idf', 'activity')) || canViewIdfOverview) && can("activity.read"));
  const reportsPath = canReadIdfReports ? `/api/reports${idfDataView}` : null;
  const canReadAudit = Boolean(canViewPage("bitacora") && can("activity.read"));
  const catalog = useTelemetryCatalog(!demo && can("traffic.read"));
  const [demoUsers, setDemoUsers] = useState(initialDemoUsers);
  const [demoConnections, setDemoConnections] = useState(
    initialDemoConnections,
  );
  const [data, setData] = useState(() => (demo ? createDemo() : emptyData()));

  const homeRoute = canViewPage?.("resumen")
    ? "resumen"
    : allowedPages?.includes("soporte")
      ? "soporte"
      : (allowedPages?.[0] === "bitacora-idf" ? "idf" : allowedPages?.[0]) || "resumen";

  const [route, setRoute] = useState(() => {
    const initial = readRoute();
    if (initial.raw === "resumen" || !initial.raw) {
      if (
        allowedPages &&
        !canViewPage?.("resumen") &&
        allowedPages.includes("soporte")
      ) {
        return {
          path: "soporte",
          params: new URLSearchParams(""),
          raw: "soporte",
        };
      }
    }
    return initial;
  });

  const [loading, setLoading] = useState(!demo);
  const [idfEntry, setIdfEntry] = useState(0);
  const [errors, setErrors] = useState({});
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [modalDirty, setModalDirty] = useState(false);
  const [discardModal, setDiscardModal] = useState(false);
  const [toast, setToast] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const input = document.querySelector(".header-search input");
        if (input) {
          input.focus();
          input.select();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [releaseError, setReleaseError] = useState("");
  const [releaseUncertain, setReleaseUncertain] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const generation = useRef(0);
  const loadController = useRef(null);
  const loadedResources = useRef(new Set());
  const [pendingResources, setPendingResources] = useState(new Set());
  const mutationLock = useRef(false);
  const toastTimer = useRef(null);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const notify = useCallback((text) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(""), 5500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const expired = () => {
      setModal(null);
      setMenu(false);
      setModalDirty(false);
      setDiscardModal(false);
      setPendingNavigation(null);
    };
    window.addEventListener("sgrs-session-expired", expired);
    return () => window.removeEventListener("sgrs-session-expired", expired);
  }, []);
  const refresh = useCallback(async () => {
    if (demo) {
      notify("La vista de demostración está actualizada.");
      return;
    }
    window.dispatchEvent(new Event('sgrs:refresh-current-module'));
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const version = ++generation.current;
    setLoading(true);
    const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
    const endpoints = {
      ...(idfDataView !== null ? { idfs: `/api/idfs${idfDataView}` } : {}),
      ips: "/api/ips",
      devices: "/api/devices",
      meztliLeases: "/api/forti/network/dhcp-leases",
      ...(reportsPath ? { reports: reportsPath } : {}),
      health: "/api/health",
      segments: "/api/forti/network/dhcp-pools",
      ...(canReadAudit ? { audit: "/api/audit" } : {}),
    };
    setPendingResources(new Set(Object.keys(endpoints)));
    setData(old => ({ ...old,
      ...(idfDataView === null ? { idfs: [], resources: [] } : {}),
      ...(!reportsPath ? { reports: {} } : {}),
      ...(!canReadAudit ? { audit: [] } : {}),
    }));
    // Publish each source as soon as it arrives: a slow, unrelated provider
    // must not keep every page behind its loading placeholder.
    await Promise.allSettled(Object.entries(endpoints).map(async ([key, path]) => {
      try {
        const response = await request(path, { signal: controller.signal });
        if (version !== generation.current) return;
        const value = key === "audit" ? (response.events || response)
          : key === "segments" ? response.data?.pools
          : key === "meztliLeases" ? response.data : response;
        if (["idfs", "ips", "devices", "meztliLeases", "segments"].includes(key) && !Array.isArray(value)) {
          throw new Error("El servicio devolvió un formato no reconocido.");
        }
        loadedResources.current.add(key);
        setData(old => ({ ...old, [key]: value,
          ...(key === "idfs" ? { resources: inventoryFromIdfs(value) } : {}),
          updatedAt: new Date().toISOString() }));
        setErrors(old => { const next = { ...old }; delete next[key]; return next; });
      } catch (error) {
        if (version !== generation.current) return;
        loadedResources.current.add(key);
        setErrors(old => ({ ...old, [key]: error.name === "AbortError"
          ? "Se agotó el tiempo de consulta. Vuelve a intentar." : error.message }));
      }
      finally {
        if (version === generation.current) setPendingResources(old => {
          const next = new Set(old); next.delete(key); return next;
        });
      }
    }));
    clearTimeout(timer);
    if (version !== generation.current) return;
    setLoading(false);
  }, [demo, notify, idfDataView, reportsPath, canReadAudit]);
  useEffect(() => {
    if (!demo) refresh();
    return () => {
      generation.current++;
      loadController.current?.abort();
    };
  }, [demo, refresh]);
  const go = (path) => {
    setMenu(false);
    setDirty(false);
    setPendingNavigation(null);
    if (["idf", "inventario"].includes(path.split("?")[0])) setIdfEntry(value => value + 1);
    location.hash = path;
    setRoute(readRoute());
  };
  const navigate = (path) => {
    if (mutationLock.current) return;
    if (dirty) setPendingNavigation(() => () => go(path));
    else go(path);
  };
  useEffect(() => {
    const changed = () => {
      const next = readRoute();
      if (next.raw === currentRoute.current.raw) return;
      if (dirty) {
        const url = new URL(location.href);
        url.hash = currentRoute.current.raw;
        history.replaceState(null, "", url);
        setPendingNavigation(() => () => go(next.raw));
      } else {
        setRoute(next);
        setMenu(false);
      }
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [dirty]);

  // Route protection based on allowedPages and role capabilities
  useEffect(() => {
    if (!allowedPages || !allowedPages.length) return;
    const currentPath = route.path;
    const effective =
      currentPath === "bitacora-idf"
        ? "idf"
        : currentPath.startsWith("consulta/")
          ? "consulta"
          : currentPath;
    if (effective === "consulta" && can("traffic.read")) return;
    const pathAllowed =
      effective === "conexiones"
        ? canViewPage?.("conexiones") &&
          (user?.role === "super-admin" || can("integrations.manage"))
        : canViewPage?.(effective);
    if (!pathAllowed) {
      const target = allowedPages.includes("soporte")
        ? "soporte"
        : (allowedPages[0] === "bitacora-idf" ? "idf" : allowedPages[0]) || "resumen";
      go(target);
    }
  }, [allowedPages, route.path, user?.role]);

  useEffect(() => {
    const title = route.path.startsWith("consulta/")
      ? can("traffic.read")
        ? catalog.modules.find((item) => item.id === route.path.slice(9))
            ?.title || "Consultas de red"
        : "Acceso restringido"
      : {
          catalogo: "Inventario documental de IDF",
          aps: "Inventario de access points",
          cctv: "Inventario CCTV",
        }[route.path] ||
        titles[route.path] ||
        "Página no encontrada";
    document.title = `${title} · Centro Operativo SGRS`;
    if (document.querySelector("dialog[open]")) return;
    [...document.querySelectorAll(".main-content h1")]
      .find((node) => node.offsetParent !== null)
      ?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route.raw, catalog.modules]);
  useEffect(() => {
    if (!dirty && !modalDirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, modalDirty]);
  const openEditor = (kind, row, { readOnly = false } = {}) => {
    if (
      ["ip", "release", "resource", "stock", "request"].includes(kind) &&
      !can("inventory.write")
    ) {
      notify("Tu rol permite consultar, pero no modificar esta información.");
      return;
    }
    setModalDirty(false);
    setDiscardModal(false);
    setReleaseError("");
    setReleaseUncertain(false);
    setModal({ kind, row, readOnly });
  };
  const closeModal = () => {
    if (mutationLock.current) return;
    if (modalDirty) setDiscardModal(true);
    else setModal(null);
  };
  async function mutate(path, body) {
    if (mutationLock.current) throw new ApiError(409);
    loadController.current?.abort();
    generation.current++;
    setLoading(false);
    setPendingResources(new Set());
    mutationLock.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      return await request(path, { body, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      mutationLock.current = false;
    }
  }
  async function saveEntry(values) {
    if (!can("idf.visits.write")) throw new ApiError(403);
    const now = new Date().toISOString();
    const id = values.reportId;
    let incident = {
      id,
      date: now,
      severity: "medium",
      device: "Gabinete",
      temp: Number(values.temp),
      title: "Reporte de incidencia",
      description: values.description.trim(),
      status: "open",
      tech: demo ? values.actor : user.name,
    };
    let telemetry = {
      temp: Number(values.temp),
      date: now,
      status:
        Number(values.temp) >= 28
          ? "critical"
          : Number(values.temp) >= 24
            ? "warn"
            : "normal",
    };
    if (!demo) {
      const saved = await mutate("/api/reports", {
        idf_id: values.idf,
        incident,
        telemetry,
        evidence: values.evidence,
      });
      incident = saved.incident;
      telemetry = saved.telemetry || telemetry;
    } else if (values.evidence)
      incident.evidenceDemo = `data:${values.evidence.type};base64,${values.evidence.data}`;
    setData((old) => {
      const previous = old.reports[values.idf];
      return {
        ...old,
        reports: {
          ...old.reports,
          [values.idf]: {
            incidents: [
              incident,
              ...(Array.isArray(previous)
                ? previous
                : previous?.incidents || []),
            ],
            telemetry,
          },
        },
      };
    });
    setDirty(false);
    go("bitacora");
    notify(
      demo
        ? "Entrada de ejemplo registrada. No se envió al servidor."
        : "Entrada registrada en la bitácora.",
    );
  }
  async function saveEditor(values) {
    const { kind, row } = modal;
    if (kind === "ip") {
      if (!demo) await mutate("/api/ips/update", { ip: row.ip, ...values });
      setData((old) => ({
        ...old,
        ips: old.ips.map((ip) =>
          ip.ip === row.ip ? { ...ip, ...values } : ip,
        ),
      }));
    } else if (kind === "resource") {
      const device = {
        ...(row || {}),
        desc: values.name,
        type: values.category,
        ru: values.ru,
        brandModel: values.brand,
        serial: values.serial,
        mac: values.mac,
        status: values.status,
      };
      for (const key of [
        "id",
        "idfId",
        "index",
        "name",
        "category",
        "idf",
        "zone",
      ])
        delete device[key];
      await mutate("/api/idfs/device", {
        idf_id: values.idfId,
        device,
        ...(row ? { index: row.index } : {}),
      });
      setData((old) => {
        const idfs = old.idfs.map((idf) => {
          if (idf.id !== values.idfId) return idf;
          const devices = [...(idf.devices || [])];
          if (row) devices[row.index] = device;
          else devices.push(device);
          return { ...idf, devices };
        });
        return { ...old, idfs, resources: inventoryFromIdfs(idfs) };
      });
    } else if (kind === "stock" && demo) {
      const idf = data.idfs.find((i) => i.id === values.idfId);
      const resource = {
        ...row,
        ...values,
        id: row?.id || crypto.randomUUID(),
        quantity: Number(values.quantity),
        available: Number(values.available),
        idf: idf?.name,
        zone: idf?.zone,
        status:
          Number(values.available) <= 1
            ? "critical"
            : Number(values.available) <= 3
              ? "low"
              : "available",
      };
      setData((old) => ({
        ...old,
        resources: row
          ? old.resources.map((r) => (r.id === row.id ? resource : r))
          : [...old.resources, resource],
      }));
    } else if (kind === "request" && demo) {
      setData((old) => ({
        ...old,
        requests: [
          {
            ...values,
            id: `DEMO-${Date.now()}`,
            status: "pending",
            date: new Date().toISOString(),
          },
          ...old.requests,
        ],
      }));
    } else throw new ApiError(403);
    setModalDirty(false);
    setModal(null);
    notify(
      demo
        ? "Cambios de ejemplo guardados en esta sesión."
        : "Cambios guardados.",
    );
  }
  async function releaseIp() {
    if (releaseBusy || releaseUncertain) return;
    setReleaseBusy(true);
    setReleaseError("");
    try {
      if (!demo)
        await mutate("/api/ips/update", {
          ip: modal.row.ip,
          action: "release",
        });
      setData((old) => ({
        ...old,
        ips: old.ips.map((ip) =>
          ip.ip === modal.row.ip
            ? { ...ip, status: "available", hostname: "—" }
            : ip,
        ),
      }));
      setModal(null);
      notify(
        demo
          ? "Dirección liberada en la demostración."
          : "Dirección liberada en el inventario local.",
      );
    } catch (e) {
      const uncertain = !e.status || e.status >= 500;
      setReleaseUncertain(uncertain);
      setReleaseError(
        uncertain
          ? "No se pudo confirmar la liberación. Consulta el inventario antes de repetir la acción."
          : e.message,
      );
    } finally {
      setReleaseBusy(false);
    }
  }
  async function resolveReport(row = modal?.row) {
    if (!can("idf.visits.write")) throw new ApiError(403);
    if (!row) throw new ApiError(404);
    const incident = demo
      ? { ...row, status: "resolved", resolved_at: new Date().toISOString() }
      : (
          await mutate("/api/reports/resolve", {
            idf_id: row.idfId,
            record_key: row.record_key,
          })
        ).incident;
    setData((old) => {
      const group = old.reports[row.idfId] || {};
      const incidents = Array.isArray(group) ? group : group.incidents || [];
      return {
        ...old,
        reports: {
          ...old.reports,
          [row.idfId]: {
            ...(Array.isArray(group) ? {} : group),
            incidents: [
              ...incidents.filter(
                (i) =>
                  (i.record_key !== row.record_key || !row.record_key) &&
                  (!row.id || i.id !== row.id),
              ),
              incident,
            ],
          },
        },
      };
    });
    if (modal?.row === row) setModal(null);
    notify(
      demo
        ? "Incidencia de ejemplo resuelta."
        : "Incidencia resuelta. El historial se conserva.",
    );
  }
  const resolveDirect = async (row) => {
    try {
      await resolveReport(row);
    } catch (error) {
      notify(error.message || "No se pudo resolver la incidencia.");
    }
  };
  const records = useMemo(() => reportsFromData(data.reports, data.idfs), [data.reports, data.idfs]);
  const pageResources = {
    resumen: ['ips', 'devices', 'segments'], dispositivos: ['devices', ...(route.params.get('segmento') ? ['segments'] : [])],
    disponibilidad: ['ips'], 'gestion-meztli': ['meztliLeases', 'devices'], bitacora: ['audit'],
    idf: ['idfs', ...(reportsPath ? ['reports'] : [])], inventario: ['idfs'],
    'bitacora-idf': ['idfs', ...(reportsPath ? ['reports'] : [])], soporte: ['devices', 'segments'],
  }[route.path] || [];
  const pageLoading = !demo && pageResources.some(key => pendingResources.has(key) || (loading && !loadedResources.current.has(key)));
  const shared = {
    data,
    demo,
    navigate,
    openEditor,
    loading: pageLoading,
    errors,
    refresh,
    canWrite: can("inventory.write"),
    canExport: can("inventory.export"),
    onResolve: resolveDirect,
  };
  const canViewActivity = Boolean(
    canViewPage?.("bitacora") && can("activity.read"),
  );

  const effectivePath = route.path;
  const isAllowed =
    (route.path === "bitacora"
      ? canViewActivity
      : route.path === "conexiones"
      ? canViewPage?.("conexiones") &&
        (user?.role === "super-admin" || can("integrations.manage"))
      : canViewPage?.(effectivePath)) ||
    (route.path.startsWith("consulta/") && can("traffic.read"));

  let page;
  if (!isAllowed) {
    page = (
      <>
        <PageHeading
          eyebrow="Acceso restringido · 403"
          title="No tienes permiso para esta sección"
          description="Usa la navegación para consultar las secciones disponibles en tu cuenta."
        />
        <Button onClick={() => navigate(homeRoute)}>
          Ir a mi página principal
        </Button>
      </>
    );
  } else if (route.path.startsWith("consulta/")) {
    page = can("traffic.read") ? (
      <TelemetryPage
        catalog={catalog}
        moduleId={route.path.slice(9)}
        resourceId={route.params.get("recurso")}
        navigate={navigate}
      />
    ) : (
      <PageHeading
        eyebrow="Acceso restringido · 403"
        title="No tienes permiso para esta sección"
        description="Usa la navegación para consultar las secciones disponibles en tu cuenta."
      />
    );
  } else if (route.path === "soporte") {
    page = <SupportWorkspace {...shared} openEditor={openEditor} canEditInventory={can('inventory.write')} initialTab={route.params.get('vista')} />;
  } else if (route.path === "resumen") {
    page = (
      <Overview {...shared} userId={user.id} />
    );
  } else if (route.path === "altas") {
    page = <Requests {...shared} />;
  } else if (route.path === "inventario") {
    page = (
      <IdfHub
        key={`${route.path}-${idfEntry}`}
        data={data}
        records={records}
        demo={demo}
        userId={user?.id}
        navigate={navigate}
        openEditor={openEditor}
        canWrite={canOpenIdfs && can("idf.visits.write")}
        canEditInventory={canOpenIdfs && can("inventory.write")}
        canViewActivity={canOpenIdfs && can("activity.read") && canViewSubmodule('idf', 'activity')}
        canViewInventory={canOpenIdfs && canViewSubmodule('idf', 'inventory')}
        canViewQrAllowed={canOpenIdfs && canViewSubmodule('idf', 'qr')}
        canViewOverview={canViewIdfOverview}
        canOpenIdfs={canOpenIdfs}
        notify={notify}
        onResolve={resolveDirect}
        loading={pageLoading}
        errors={errors}
        refresh={refresh}
      />
    );
  } else if (["catalogo", "aps", "cctv"].includes(route.path)) {
    page = (
      <DocumentaryInventory
        key={`${route.path}-${demo}`}
        {...shared}
        route={route.path}
        canViewActivity={canViewActivity}
        mutate={mutate}
        notify={notify}
        onDirty={setDirty}
      />
    );
  } else if (route.path === "disponibilidad") {
    page = <Addresses {...shared} />;
  } else if (route.path === "dispositivos") {
    page = (
      <Devices {...shared} selectedSegment={route.params.get("segmento")} />
    );
  } else if (route.path === "idf") {
    page = (
      <IdfHub
        key={`${route.path}-${idfEntry}`}
        data={data}
        records={records}
        demo={demo}
        userId={user?.id}
        navigate={navigate}
        openEditor={openEditor}
        canWrite={canOpenIdfs && can("idf.visits.write")}
        canEditInventory={canOpenIdfs && can("inventory.write")}
        canViewActivity={canOpenIdfs && can("activity.read") && canViewSubmodule('idf', 'activity')}
        canViewInventory={canOpenIdfs && canViewSubmodule('idf', 'inventory')}
        canViewQrAllowed={canOpenIdfs && canViewSubmodule('idf', 'qr')}
        canViewOverview={canViewIdfOverview}
        canOpenIdfs={canOpenIdfs}
        notify={notify}
        onResolve={resolveDirect}
        loading={pageLoading}
        errors={errors}
        refresh={refresh}
      />
    );
  } else if (route.path === "entrada") {
    page = (
      <EntryForm
        key={route.raw}
        {...shared}
        user={user}
        canRegister={can("idf.visits.write")}
        idfId={route.params.get("idf")}
        save={saveEntry}
        onDirty={setDirty}
      />
    );
  } else if (route.path === "bitacora") {
    page = (
      <ProjectAuditLog
        {...shared}
        canExport={can("inventory.export")}
      />
    );
  } else if (route.path === "gestion-meztli") {
    page = (
      <MeztliManagement
        data={data}
        openEditor={openEditor}
        loading={pageLoading}
        errors={errors}
        refresh={refresh}
        canExport={can("inventory.export")}
      />
    );
  } else if (route.path === "usuarios") {
    page = !(canViewPage?.("usuarios") && can("users.read")) ? (
      <>
        <PageHeading
          eyebrow="Acceso restringido · 403"
          title="No tienes permiso para esta sección"
          description="Usa la navegación para consultar las secciones disponibles en tu cuenta."
        />
        <Button onClick={() => navigate(homeRoute)}>Volver al dashboard</Button>
      </>
    ) : (
      <UsersPage
        demoUsers={demoUsers}
        setDemoUsers={setDemoUsers}
        notify={notify}
      />
    );
  } else if (route.path === "conexiones") {
    const hasConnectionAccess =
      canViewPage?.("conexiones") &&
      (user?.role === "super-admin" || can("integrations.manage"));
    page = !hasConnectionAccess ? (
      <>
        <PageHeading
          eyebrow="Acceso restringido · 403"
          title="No tienes permiso para esta sección"
          description="Usa la navegación para consultar las secciones disponibles en tu cuenta."
        />
        <Button onClick={() => navigate(homeRoute)}>Volver al dashboard</Button>
      </>
    ) : (
      <ConnectionsPage
        demoConnections={demoConnections}
        setDemoConnections={setDemoConnections}
        onDirty={setDirty}
        notify={notify}
      />
    );
  } else {
    page = (
      <>
        <PageHeading
          eyebrow="Error 404"
          title="Página no encontrada"
          description="Esta sección no existe en el centro operativo."
        />
        <Empty
          action={
            <Button onClick={() => navigate(homeRoute)}>Ir al dashboard</Button>
          }
        >
          Usa la navegación para abrir una sección disponible.
        </Empty>
      </>
    );
  }

  const modalTitle =
    modal?.kind === "ip"
      ? `Administrar ${modal.row.ip}`
      : modal?.kind === "release"
        ? `Liberar ${modal.row.ip}`
        : modal?.kind === "resource" || modal?.kind === "stock"
          ? modal.row
            ? "Actualizar recurso"
            : "Agregar recurso"
          : modal?.kind === "request"
            ? "Nueva alta de red"
            : modal?.kind === "qr"
              ? "Código QR del gabinete"
              : modal?.kind === "device-detail"
                ? modal.row.hostname ||
                  modal.row.detected_device ||
                  modal.row.omnivista?.device_name ||
                  modal.row.name ||
                  "Detalle del dispositivo"
                : modal?.kind === "request-detail"
                  ? "Detalle del registro"
                  : modal?.kind === "report-detail"
                    ? "Detalle del registro"
                    : modal?.kind === "report-resolve"
                      ? "Resolver incidencia"
                      : modal?.kind === "services"
                        ? "Estado de los servicios"
                        : "Acceso y privilegios";
  const activeModuleTitle = route.path.startsWith("consulta/")
    ? catalog.modules.find((m) => m.id === route.path.slice(9))?.title ||
      "Consultas de red"
    : {
        catalogo: "Inventario documental de IDF",
        aps: "Inventario de access points",
        cctv: "Inventario CCTV",
      }[route.path] ||
      titles[route.path] ||
      "Página no encontrada";

  const canManageUsers = Boolean(canViewPage?.("usuarios") && can("users.read"));
  const canManageConnections = Boolean(
    canViewPage?.("conexiones") &&
    (user?.role === "super-admin" || can("integrations.manage")),
  );
  const hasAdminAccess = canManageUsers || canManageConnections;

  const searchableItems = [...navItems, ...adminItems].filter(([path]) => {
    if (
      path === "conexiones" &&
      user?.role !== "super-admin" &&
      !can("integrations.manage")
    )
      return false;
    return canViewPage?.(path) && (path !== "bitacora" || canViewActivity);
  });

  return (
    <div className="dashboard-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Ir al contenido
      </a>
      <header className="institutional-header">
        <a
          href={`#${homeRoute}`}
          className="mobile-brand-link"
          onClick={(e) => {
            e.preventDefault();
            navigate(homeRoute);
          }}
        >
          <Brand />
        </a>
        <div className="header-title">
          <strong>{activeModuleTitle}</strong>
          <span>Centro Operativo · Redes e Infraestructura</span>
        </div>
        <div className="header-search">
          <div className="header-search-wrapper">
            <SearchField defer
              value={globalQuery}
              onChange={setGlobalQuery}
              label="Buscar una sección"
              placeholder="Buscar una sección del centro operativo…"
            />
            <kbd className="header-search-kbd" title="Atajo de teclado">Ctrl K</kbd>
          </div>
          {globalQuery && (
            <div className="global-results">
              {searchableItems
                .filter(([, label]) =>
                  label
                    .toLocaleLowerCase("es-MX")
                    .includes(globalQuery.toLocaleLowerCase("es-MX")),
                )
                .map(([path, label, Icon]) => (
                  <button
                    type="button"
                    key={path}
                    onClick={() => {
                      setGlobalQuery("");
                      navigate(path);
                    }}
                  >
                    <Icon size={18} />
                    {label}
                    <ArrowRight size={16} />
                  </button>
                ))}
              {!searchableItems.some(([, label]) =>
                label.toLowerCase().includes(globalQuery.toLowerCase()),
              ) && <p>Sin secciones coincidentes.</p>}
            </div>
          )}
        </div>
        <RefreshControl loading={loading} onRefresh={refresh} />
        <div className="header-bell-wrapper">
          <IconButton
            icon={Bell}
            label="Consultar estado de servicios"
            onClick={() => openEditor("services")}
            className="header-bell-btn"
          />
          <span className="header-bell-badge" aria-hidden="true" title="Servicios en línea" />
        </div>
        <button
          className="account-button"
          type="button"
          onClick={() => openEditor("access")}
        >
          <span className="avatar">
            {user.name
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </span>
          <span className="account-info">
            <strong className="account-name">{user.name}</strong>
            <small className="account-username">@{user.username || 'usuario'}</small>
          </span>
          <ChevronDown size={14} className="account-chevron" />
        </button>
        <div className="mexico-wordmark">
          Servir a<br />
          México
        </div>
        <IconButton
          icon={Menu}
          label="Abrir navegación"
          className="mobile-menu"
          aria-expanded={menu}
          onClick={() => setMenu(true)}
        />
      </header>
      <aside id="desktop-sidebar" className="sidebar sidebar-solar">
        <div className="sidebar-art" aria-hidden="true"><i className="sidebar-stars" /><i className="sidebar-calendar" /></div>
        <a
          href={`#${homeRoute}`}
          className="sidebar-brand"
          onClick={(e) => {
            e.preventDefault();
            navigate(homeRoute);
          }}
          aria-label="Ir al inicio"
        >
          <Brand />
        </a>
        <Nav
          route={route.path}
          navigate={navigate}
          data={data}
          records={records}
          canViewPage={canViewPage}
          user={user}
          can={can}
        />
        {can("traffic.read") && (
          <div className="sidebar-admin">
            <p>Consultas de red</p>
            <TelemetryNav
              modules={catalog.modules}
              route={route.path}
              navigate={navigate}
            />
            {catalog.error && (
              <Button onClick={catalog.retry}>Reintentar navegación</Button>
            )}
          </div>
        )}
        <div className="sidebar-bottom">
          <Building2 size={28} strokeWidth={1.5} />
          <p>
            Dirección de Tecnologías
            <br />
            de la Información
          </p>
          <small>
            ISSSTE
            <br />
            2026 · Centro Operativo SGRS
          </small>
        </div>
        {hasAdminAccess && (
          <div className="sidebar-admin">
            <p>Administración</p>
            <Nav
              administration
              route={route.path}
              navigate={navigate}
              canViewPage={canViewPage}
              user={user}
              can={can}
            />
          </div>
        )}
      </aside>
      <main className="main-content" id="main-content" tabIndex={-1}>
        {Object.keys(errors).length > 0 && (
          <Notice
            title="No se pudo actualizar toda la información"
            tone="warning"
            action={
              <Button onClick={refresh} busy={loading}>
                Reintentar
              </Button>
            }
          >
            Los datos conservados pueden estar desactualizados. Consultas
            pendientes:{" "}
            {Object.keys(errors)
              .map(
                (k) =>
                  ({
                    idfs: "IDFs",
                    ips: "direcciones IP",
                    devices: "dispositivos",
                    reports: "bitácora",
                    health: "servicios",
                    segments: "segmentos DHCP",
                    meztliLeases: "concesiones Meztli",
                    catalog: "catálogo documental",
                    users: "usuarios",
                    integrations: "integraciones",
                  })[k] || k,
              )
              .filter(Boolean)
              .join(", ")}
            .
          </Notice>
        )}
        {!can("inventory.write") && user.role !== "soporte" && (
          <Notice title="Perfil viewer · Solo consulta">
            Puedes revisar la información operativa. El registro y la edición
            requieren un perfil administrador.
          </Notice>
        )}
        {page}
      </main>
      <Dialog
        open={menu}
        onClose={() => setMenu(false)}
        title="Centro Operativo"
      >
        <Nav
          route={route.path}
          navigate={navigate}
          data={data}
          records={records}
          canViewPage={canViewPage}
          user={user}
          can={can}
        />
        {can("traffic.read") && (
          <TelemetryNav
            modules={catalog.modules}
            route={route.path}
            navigate={navigate}
          />
        )}
        {hasAdminAccess && (
          <div className="mobile-admin">
            <Nav
              administration
              route={route.path}
              navigate={navigate}
              canViewPage={canViewPage}
              user={user}
              can={can}
            />
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(pendingNavigation)}
        onClose={() => setPendingNavigation(null)}
        title="Tienes cambios sin guardar"
        footer={
          <>
            <Button autoFocus onClick={() => setPendingNavigation(null)}>
              Seguir editando
            </Button>
            <Button variant="danger" onClick={() => pendingNavigation?.()}>
              Descartar cambios y continuar
            </Button>
          </>
        }
      >
        Si continúas, se perderán los datos del formulario que aún no has
        guardado.
      </Dialog>
      <Dialog
        open={Boolean(modal)}
        onClose={closeModal}
        title={modalTitle}
        wide={["resource", "stock", "request", "device-detail", "report-detail"].includes(
          modal?.kind,
        )}
        busy={releaseBusy}
      >
        {discardModal && (
          <Notice
            title="¿Descartar los cambios sin guardar?"
            tone="warning"
            action={
              <div className="flex gap-2">
                <Button autoFocus onClick={() => setDiscardModal(false)}>
                  Seguir editando
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setModalDirty(false);
                    setModal(null);
                  }}
                >
                  Descartar
                </Button>
              </div>
            }
          >
            La información guardada anteriormente se conservará.
          </Notice>
        )}
        {modal &&
          ["resource", "stock", "ip", "request"].includes(modal.kind) && (
            <>
              <EditForm
                key={`${modal.kind}-${modal.row?.id || modal.row?.ip || "new"}`}
                kind={modal.kind}
                row={modal.row}
                data={data}
                save={saveEditor}
                cancel={closeModal}
                onDirty={setModalDirty}
              />
              {modal.kind === "ip" && modal.row.status !== "available" && (
                <div className="danger-zone">
                  <Button
                    variant="danger"
                    disabled={modalDirty}
                    onClick={() =>
                      setModal({ kind: "release", row: modal.row })
                    }
                  >
                    Liberar dirección IP
                  </Button>
                  <small>Elimina la asignación del inventario local.</small>
                </div>
              )}
            </>
          )}
        {modal?.kind === "release" && (
          <>
            <p>
              Se quitará la asignación de{" "}
              <strong>{modal.row.hostname || "este equipo"}</strong> y la
              dirección quedará disponible en el inventario local. Esto no
              desconecta al equipo ni cambia el firewall.
            </p>
            {releaseError && (
              <Notice title="Liberación sin confirmar" tone="danger">
                {releaseError}
              </Notice>
            )}
            <div className="form-actions">
              <Button
                autoFocus
                disabled={releaseBusy}
                onClick={() => setModal(null)}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                busy={releaseBusy}
                disabled={releaseUncertain}
                onClick={releaseIp}
              >
                Liberar dirección
              </Button>
            </div>
          </>
        )}
        {modal?.kind === "qr" && (
          <QrCard row={modal.row} demo={demo} toast={notify} />
        )}
        {modal?.kind === "device-detail" && (
          <DeviceDetail
            row={modal.row}
            demo={demo}
            canReadTraffic={can("traffic.read")}
          />
        )}
        {modal?.kind === "request-detail" && (
          <dl className="detail-grid">
            {Object.entries({
              Folio: modal.row.id,
              Usuario: modal.row.name,
              Área: modal.row.area,
              Red: modal.row.network,
              Responsable: modal.row.actor,
              Fecha: dateTime(modal.row.date),
            }).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {modal?.kind === "report-detail" && (
          <div className="idf-report-sheet">
            {/* Cabecera visual del reporte */}
            <div className="idf-report-sheet-header">
              <div className="idf-report-sheet-titles">
                <span className="idf-report-badge-folio">Folio: {modal.row.id}</span>
                <h3 className="idf-report-sheet-activity">{modal.row.title || "Visita / Reporte de IDF"}</h3>
              </div>
              <div className="idf-report-sheet-badges">
                <span className={`idf-status-pill ${modal.row.status === "resolved" ? "is-resolved" : "is-pending"}`}>
                  <span className="idf-pill-dot" />
                  {modal.row.status === "resolved" ? "Resuelto" : "Pendiente"}
                </span>
                {modal.row.severity && (
                  <span className={`idf-severity-pill is-${modal.row.severity}`}>
                    Severidad {modal.row.severity === "high" ? "Alta" : modal.row.severity === "medium" ? "Media" : "Baja"}
                  </span>
                )}
              </div>
            </div>

            {/* Cuadrícula organizada en secciones claras */}
            <div className="idf-report-sections idf-report-summary">
              {/* Sección 1: Datos Operativos */}
              <div className="idf-report-card">
                <h4 className="idf-card-title">Datos Operativos</h4>
                <div className="idf-card-grid">
                  <div className="idf-info-item">
                    <span className="idf-info-label">Gabinete / IDF</span>
                    <strong className="idf-info-val highlight">{modal.row.idf}</strong>
                  </div>
                  {modal.row.device && (
                    <div className="idf-info-item">
                      <span className="idf-info-label">Equipo / Componente</span>
                      <strong className="idf-info-val">{modal.row.device}</strong>
                    </div>
                  )}
                </div>
                <div className="idf-report-findings">
                <h4 className="idf-card-title">Descripción y Hallazgos</h4>
                <p className="idf-description-text">
                  {modal.row.description || "Sin descripción proporcionada."}
                </p>
                </div>
              </div>
              <div className="idf-report-side">
              <div className="idf-report-card">
                <h4 className="idf-card-title">Responsable y fecha</h4>
                <div className="idf-card-grid">
                  <div className="idf-info-item">
                    <span className="idf-info-label">Responsable</span>
                    <strong className="idf-info-val">{modal.row.actor}</strong>
                  </div>
                  <div className="idf-info-item">
                    <span className="idf-info-label">Fecha de inspección</span>
                    <strong className="idf-info-val">{dateTime(modal.row.date)}</strong>
                  </div>
                  {modal.row.resolved_at && (
                    <div className="idf-info-item">
                      <span className="idf-info-label">Fecha de resolución</span>
                      <strong className="idf-info-val text-success">{dateTime(modal.row.resolved_at)}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Sección 2: Métrica y Diagnóstico */}
              <div className="idf-report-card">
                <h4 className="idf-card-title">Condición Térmica</h4>
                <div className="idf-temp-box">
                  <div className={`idf-temp-indicator ${Number(modal.row.temp) >= 25 ? "temp-alert" : "temp-normal"}`}>
                    <Thermometer size={26} aria-hidden="true" />
                    <div>
                      <span className="idf-temp-value">
                        {modal.row.temp == null ? "—" : `${modal.row.temp} °C`}
                      </span>
                      <span className="idf-temp-tag">
                        {modal.row.temp == null
                          ? "Sin registro"
                          : Number(modal.row.temp) >= 25
                          ? "Temperatura Elevada (Alerta)"
                          : "Rango Térmico Nominal"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </div>

            {/* Sección 4: Evidencia Fotográfica */}
            <div className="idf-report-card full-span">
              <div className="idf-card-header-flex">
                <h4 className="idf-card-title">Evidencia Fotográfica</h4>
                {(modal.row.evidence || modal.row.evidenceDemo) && (
                  <a
                    className="button button-secondary idf-btn-download"
                    href={
                      demo
                        ? modal.row.evidenceDemo
                        : `/api/reports/evidence/${encodeURIComponent(modal.row.evidence)}`
                    }
                    download="evidencia-idf"
                  >
                    <Download size={15} />
                    Descargar foto original
                  </a>
                )}
              </div>

              {modal.row.evidence || modal.row.evidenceDemo ? (
                <div className="idf-photo-showcase">
                  <div className="idf-photo-frame">
                    <img
                      src={
                        demo
                          ? modal.row.evidenceDemo
                          : `/api/reports/evidence/${encodeURIComponent(modal.row.evidence)}?view=1`
                      }
                      alt={`Evidencia fotográfica del reporte ${modal.row.id}`}
                      className="idf-photo-img"
                    />
                  </div>
                  <div className="idf-photo-meta">
                    <Camera size={16} aria-hidden="true" />
                    <span>Fotografía adjunta capturada durante la inspección en {modal.row.idf}</span>
                  </div>
                </div>
              ) : (
                <div className="idf-no-photo">
                  <Camera size={30} strokeWidth={1.5} aria-hidden="true" />
                  <span>Sin evidencia fotográfica adjunta para este reporte</span>
                </div>
              )}
            </div>
          </div>
        )}
        {modal?.kind === "services" && (
          <>
            <ServiceStatus health={data.health} demo={demo} />
            <p className="muted">
              Que un servicio responda no garantiza que los equipos de red estén
              operativos.
            </p>
            <Button icon={RefreshCw} busy={loading} onClick={refresh}>
              Actualizar información
            </Button>
          </>
        )}
        {modal?.kind === "report-resolve" && canOpenIdfs && can("idf.visits.write") && (
          <ResolveReport row={modal.row} save={resolveReport} />
        )}
        {modal?.kind === "report-detail" &&
          modal.row.status !== "resolved" &&
          !modal.readOnly &&
          canOpenIdfs && can("idf.visits.write") &&
          (demo || modal.row.record_key) && (
            <ResolveReport row={modal.row} save={resolveReport} />
          )}
        {modal?.kind === "access" && (
          <>
            <section className="access-profile" aria-label="Resumen de sesión">
              <div className="access-profile-main">
                <span className="access-profile-avatar">
                  {user.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <p>
                    {demo ? "SESION DE DEMOSTRACIÓN" : "CUENTA INSTITUCIONAL"}
                  </p>
                  <h3>{user.name}</h3>
                  <small>{user.username}</small>
                </div>
                <span className="access-online">
                  <i /> En línea
                </span>
              </div>
              <div className="access-profile-grid">
                <article>
                  <span className="access-profile-icon">
                    <ShieldCheck size={21} />
                  </span>
                  <div>
                    <strong>Sesión protegida</strong>
                    <small>Acceso institucional verificado.</small>
                  </div>
                </article>
              </div>
              <p className="access-profile-note">
                <CheckCircle2 size={15} /> Tu sesión está lista para trabajar en
                el Centro Operativo.
              </p>
            </section>
            {logoutError && (
              <Notice title="No se pudo cerrar la sesión" tone="danger">
                {logoutError}
              </Notice>
            )}
            {!demo && (
              <div className="access-session-actions">
                <Button
                  icon={LogOut}
                  busy={logoutBusy}
                  onClick={async () => {
                    const exit = async () => {
                      setLogoutBusy(true);
                      setLogoutError("");
                      try {
                        await signOut();
                      } catch (e) {
                        setLogoutError(e.message);
                      } finally {
                        setLogoutBusy(false);
                      }
                    };
                    if (dirty) {
                      setModal(null);
                      setPendingNavigation(() => exit);
                    } else await exit();
                  }}
                >
                  Cerrar sesión
                </Button>
              </div>
            )}
          </>
        )}
      </Dialog>
      <div
        className="toast-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && (
          <div className="toast">
            <CheckCircle2 size={21} />
            <span>{toast}</span>
            <IconButton
              icon={X}
              label="Cerrar notificación"
              onClick={() => setToast("")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
