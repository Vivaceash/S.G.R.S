/* ==========================================================================
   SGRS — SISTEMA DE GESTIÓN DE REDES Y SEGURIDAD
   Enrutador SPA Modular Asíncrono y Lógica de Aplicación
   ========================================================================== */

const viewConfig = {
  resumen: {
    title: "Estado general de la red",
    eyebrow: "CENTRO DE MONITOREO"
  },
  dispositivos: {
    title: "Inventario completo de dispositivos",
    eyebrow: "CONTROL DE EQUIPOS"
  },
  disponibilidad: {
    title: "Disponibilidad y Asignación de Direcciones IP",
    eyebrow: "GESTIÓN DE DIRECCIONAMIENTO IPAM"
  },
  actividad: {
    title: "Bitácora de movimientos y cambios",
    eyebrow: "TRAZABILIDAD Y AUDITORÍA"
  },
  idf: {
    title: "Gestión de cuartos de telecomunicaciones (IDFs)",
    eyebrow: "DISTRIBUCIÓN Y GABINETES"
  },
  qr: {
    title: "Códigos QR de racks y gabinetes",
    eyebrow: "ETIQUETADO Y BITÁCORA EN SITIO"
  }
};

const viewCache = {};
let currentActiveView = "resumen";

/* ==========================================================================
   DATOS DEL SISTEMA: DISPOSITIVOS GLOBALES
   ========================================================================== */

let devices = [];

let activeFilter = "all";
let sortKey = "name";
let sortAscending = true;

function renderDevices() {
  const rows = document.querySelector("#deviceRows");
  const search = document.querySelector("#deviceSearch");
  const clearSearch = document.querySelector("#clearSearch");
  const emptyState = document.querySelector("#emptyState");
  const resultCount = document.querySelector("#resultCount");
  if (!rows || !search) return;

  const query = search.value.trim().toLocaleLowerCase("es-MX");
  const visible = devices
    .filter(device => activeFilter === "all" || device.status === activeFilter)
    .filter(device => [device.name, device.ip, device.type, device.location].some(value => value.toLocaleLowerCase("es-MX").includes(query)))
    .sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey]), "es-MX") * (sortAscending ? 1 : -1));

  const fragment = document.createDocumentFragment();
  visible.forEach(device => {
    const row = document.createElement("tr");
    row.style.cursor = "pointer";
    row.title = "Clic para ver detalles técnicos y telemetría de tráfico en tiempo real";
    row.addEventListener("click", () => openDeviceModal(device));

    const deviceCell = document.createElement("td");
    const deviceName = document.createElement("span");
    const deviceIcon = document.createElement("i");
    deviceName.className = "device-name";
    deviceIcon.className = "device-type-icon";
    deviceIcon.setAttribute("aria-hidden", "true");
    deviceIcon.textContent = device.icon;
    deviceName.append(deviceIcon, document.createTextNode(device.name));
    deviceCell.append(deviceName);

    const ipCell = document.createElement("td");
    const ip = document.createElement("span");
    ip.className = "ip";
    ip.textContent = device.ip;
    ipCell.append(ip);

    const typeCell = document.createElement("td");
    typeCell.textContent = device.type;

    const locationCell = document.createElement("td");
    locationCell.textContent = device.location;

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `status-pill ${device.status}`;
    status.append(document.createElement("i"), document.createTextNode(device.status === "online" ? "En línea" : "Fuera de línea"));
    statusCell.append(status);

    const activityCell = document.createElement("td");
    activityCell.textContent = device.activity;

    row.append(deviceCell, ipCell, typeCell, locationCell, statusCell, activityCell);
    fragment.append(row);
  });

  rows.replaceChildren(fragment);
  if (emptyState) emptyState.hidden = visible.length > 0;
  if (resultCount) {
    const totalCount = devices.length;
    resultCount.textContent = visible.length ? `Mostrando ${visible.length} de ${totalCount} dispositivos` : "No se encontraron dispositivos";
  }
  if (clearSearch) clearSearch.classList.toggle("visible", Boolean(search.value));
}

function initDevicesEvents() {
  const search = document.querySelector("#deviceSearch");
  const clearSearch = document.querySelector("#clearSearch");
  if (search) {
    search.addEventListener("input", renderDevices);
  }
  if (clearSearch && search) {
    clearSearch.addEventListener("click", () => {
      search.value = "";
      renderDevices();
      search.focus();
    });
  }
  document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(item => {
      item.classList.toggle("selected", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    renderDevices();
  }));
  document.querySelectorAll("[data-sort]").forEach(button => button.addEventListener("click", () => {
    if (sortKey === button.dataset.sort) sortAscending = !sortAscending;
    else { sortKey = button.dataset.sort; sortAscending = true; }
    document.querySelectorAll("th").forEach(th => th.removeAttribute("aria-sort"));
    button.closest("th").setAttribute("aria-sort", sortAscending ? "ascending" : "descending");
    renderDevices();
  }));

  const regDevBtn = document.querySelector("#regMovementFromDevBtn");
  if (regDevBtn) {
    regDevBtn.addEventListener("click", () => {
      const dialog = document.querySelector("#movementDialog");
      if (dialog) dialog.showModal();
    });
  }

  initDeviceDetailModalEvents();
  renderDevices();
}

/* ==========================================================================
   TELEMETRÍA Y DETALLE DE DISPOSITIVO (INTEGRACIÓN FORTIOS / TRAFFIC API)
   ========================================================================== */

function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes) || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

let activeTrafficDevice = null;
let currentTrafficDirection = "all";

async function fetchDeviceTraffic(ip, direction = "all") {
  const loader = document.querySelector("#trafficLoading");
  const content = document.querySelector("#trafficContent");
  const actSessions = document.querySelector("#tActiveSessions");
  const actSplit = document.querySelector("#tSessionSplit");
  const bSent = document.querySelector("#tBytesSent");
  const bRcvd = document.querySelector("#tBytesRcvd");
  const lCount = document.querySelector("#tLogCount");
  const sessionRows = document.querySelector("#trafficSessionRows");
  const logRows = document.querySelector("#trafficLogRows");
  const topDestList = document.querySelector("#topDestList");

  if (!ip || ip === "—") {
    if (sessionRows) sessionRows.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#888;">El dispositivo no tiene una dirección IP asignada para análisis de tráfico</td></tr>`;
    if (logRows) logRows.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#888;">Sin IP registrada</td></tr>`;
    return;
  }

  if (loader) loader.style.display = "block";
  if (content) content.style.opacity = "0.4";

  try {
    const res = await fetch(`/api/traffic/ip/${encodeURIComponent(ip)}?limit=40&direction=${direction}`);
    const json = await res.json();
    const data = json.data || json;

    if (actSessions) actSessions.textContent = data.active_sessions_count || 0;
    if (actSplit) actSplit.textContent = `Salida: ${data.outbound_sessions_count || 0} | Entrada: ${data.inbound_sessions_count || 0}`;
    if (bSent) bSent.textContent = formatBytes(data.total_sent_bytes || 0);
    if (bRcvd) bRcvd.textContent = formatBytes(data.total_rcvd_bytes || 0);
    if (lCount) lCount.textContent = (data.recent_logs || []).length;

    // Render sesiones
    if (sessionRows) {
      const sessions = data.sessions || [];
      if (!sessions.length) {
        sessionRows.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#888;">No hay sesiones activas en este momento</td></tr>`;
      } else {
        sessionRows.innerHTML = sessions.map(s => {
          const isOut = (s.direction || "outbound") === "outbound";
          const dirBadge = isOut 
            ? `<span class="dir-badge outbound">↗ Salida</span>` 
            : `<span class="dir-badge inbound">↙ Entrada</span>`;
          const target = isOut ? `${s.dst_ip || "—"}:${s.dst_port || ""}` : `${s.src_ip || "—"}:${s.src_port || ""}`;
          const proto = s.protocol_name || "TCP";
          const app = s.application || "Navegación Web";
          const bytes = `${formatBytes(s.bytes_sent)} Tx / ${formatBytes(s.bytes_received)} Rx`;
          const dur = formatDuration(s.duration);
          return `<tr>
            <td>${dirBadge}</td>
            <td style="font-family:var(--font-mono); font-weight:600;">${target}</td>
            <td>${proto}</td>
            <td>${app}</td>
            <td>${bytes}</td>
            <td>${dur}</td>
          </tr>`;
        }).join("");
      }
    }

    // Render logs
    if (logRows) {
      const logs = data.recent_logs || [];
      if (!logs.length) {
        logRows.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#888;">Sin registros de navegación recientes</td></tr>`;
      } else {
        logRows.innerHTML = logs.map(l => {
          const isOut = (l.direction || "outbound") === "outbound";
          const dirBadge = isOut 
            ? `<span class="dir-badge outbound">↗ Salida</span>` 
            : `<span class="dir-badge inbound">↙ Entrada</span>`;
          const dest = l.hostname || l.dst_ip || "—";
          const timeStr = l.timestamp ? (l.timestamp.split(" ")[1] || l.timestamp) : "Reciente";
          const service = l.service || "HTTPS";
          const cat = l.app_category || "General";
          const action = (l.action === "permit" || l.action === "accept") 
            ? `<span style="color:var(--green); font-weight:700;">Permitido</span>` 
            : `<span style="color:var(--red); font-weight:700;">Bloqueado</span>`;
          const vol = `${formatBytes(l.sent_bytes || 0)} / ${formatBytes(l.rcvd_bytes || 0)}`;
          return `<tr>
            <td style="font-size:11px; color:#666;">${timeStr}</td>
            <td>${dirBadge}</td>
            <td style="font-weight:600; font-family:var(--font-mono);">${dest}</td>
            <td>${service}</td>
            <td>${cat}</td>
            <td>${action}</td>
            <td>${vol}</td>
          </tr>`;
        }).join("");
      }
    }

    // Render top destinations
    if (topDestList) {
      const topDests = data.top_destinations || [];
      if (!topDests.length) {
        topDestList.innerHTML = `<p style="font-size:12px; color:#888; margin:0;">Sin destinos frecuentes registrados.</p>`;
      } else {
        topDestList.innerHTML = topDests.map(d => `
          <div class="top-dest-card">
            <div>
              <div class="top-dest-name">${d.destination}</div>
              <small style="font-size:11px; color:#888;">${d.session_count} conexiones</small>
            </div>
            <strong style="font-size:12px; color:var(--pantone-7421);">${formatBytes(d.total_bytes)}</strong>
          </div>
        `).join("");
      }
    }

  } catch (err) {
    console.warn("Error consultando telemetría de tráfico:", err);
    if (sessionRows) sessionRows.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#c00;">No se pudo conectar con el servicio de telemetría de FortiGate</td></tr>`;
  } finally {
    if (loader) loader.style.display = "none";
    if (content) content.style.opacity = "1";
  }
}

function openDeviceModal(device) {
  if (!device) return;
  activeTrafficDevice = device;

  const dialog = document.querySelector("#deviceDetailDialog");
  if (!dialog) return;

  const raw = device.raw || {};
  const title = document.querySelector("#devDetailTitle");
  const sub = document.querySelector("#devDetailSubtitle");
  const icon = document.querySelector("#devDetailIcon");
  const badge = document.querySelector("#devDetailStatusBadge");

  if (title) title.textContent = device.name;
  if (sub) sub.textContent = `MAC: ${device.mac || raw.mac || "—"} | IP: ${device.ip || "—"}`;
  if (icon) icon.textContent = device.icon || "💻";

  if (badge) {
    const isOnline = device.status === "online";
    badge.className = `status-pill ${isOnline ? "online" : "offline"}`;
    badge.innerHTML = `<i></i>${isOnline ? "En línea" : "Fuera de línea"}`;
  }

  // Llenar pestaña información técnica
  const setTxt = (id, val) => {
    const el = document.querySelector(id);
    if (el) el.textContent = val || "—";
  };

  setTxt("#devInfoIp", device.ip);
  setTxt("#devInfoMac", device.mac || raw.mac);
  setTxt("#devInfoHostname", raw.hostname || device.name);
  setTxt("#devInfoVendor", device.vendor || raw.hardware_vendor || "Fortinet");
  setTxt("#devInfoType", device.type || raw.device_type);
  setTxt("#devInfoOs", device.os || raw.os_name);
  setTxt("#devInfoInterface", device.interface || raw.interface);
  setTxt("#devInfoActivity", device.activity);

  // Configurar input de IP en pestaña tráfico
  const ipInput = document.querySelector("#trafficIpInput");
  if (ipInput) ipInput.value = (device.ip && device.ip !== "—") ? device.ip : "";

  // Reset pestañas
  switchDevModalTab("info");

  // Si tiene IP válida, cargar tráfico en segundo plano
  if (device.ip && device.ip !== "—") {
    fetchDeviceTraffic(device.ip, currentTrafficDirection);
  }

  dialog.showModal();
}

function switchDevModalTab(tabId) {
  document.querySelectorAll(".dev-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.devTab === tabId);
  });
  const paneInfo = document.querySelector("#devPaneInfo");
  const paneTraffic = document.querySelector("#devPaneTraffic");
  if (paneInfo) paneInfo.classList.toggle("active", tabId === "info");
  if (paneTraffic) paneTraffic.classList.toggle("active", tabId === "traffic");
}

function initDeviceDetailModalEvents() {
  const dialog = document.querySelector("#deviceDetailDialog");
  const closeBtn = document.querySelector("#closeDevDetailBtn");
  if (closeBtn && dialog) {
    closeBtn.onclick = () => dialog.close();
  }

  // Click fuera del diálogo para cerrar
  if (dialog) {
    dialog.onclick = (e) => {
      const rect = dialog.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        dialog.close();
      }
    };
  }

  // Pestañas
  document.querySelectorAll(".dev-tab-btn").forEach(btn => {
    btn.onclick = () => {
      switchDevModalTab(btn.dataset.devTab);
    };
  });

  // Botón actualizar tráfico
  const refreshBtn = document.querySelector("#refreshTrafficBtn");
  const ipInput = document.querySelector("#trafficIpInput");
  if (refreshBtn && ipInput) {
    refreshBtn.onclick = () => {
      const ip = ipInput.value.trim() || activeTrafficDevice?.ip;
      if (ip) fetchDeviceTraffic(ip, currentTrafficDirection);
    };
    ipInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const ip = ipInput.value.trim();
        if (ip) fetchDeviceTraffic(ip, currentTrafficDirection);
      }
    };
  }

  // Filtros de dirección (Salida / Entrada / Todas)
  document.querySelectorAll(".traffic-dir-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".traffic-dir-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTrafficDirection = btn.dataset.dir || "all";
      const ip = ipInput ? ipInput.value.trim() : (activeTrafficDevice?.ip || "");
      if (ip) fetchDeviceTraffic(ip, currentTrafficDirection);
    };
  });
}

/* ==========================================================================
   DATOS DEL SISTEMA: 13 CUARTOS IDF (1 AL 12 Y PACS)
   ========================================================================== */

let idfData = [];

let currentIdfId = "idf-1";
let currentIdfTab = "inventory";
let idfDeviceFilter = "";
let currentQrServerHost = "";

const defaultFallbackIdf = {
  id: "idf-1",
  name: "IDF 1",
  zone: "—",
  rack: "Gabinete 42U",
  devices: [],
  incidents: []
};

function getSelectedIdf() {
  if (!Array.isArray(idfData) || idfData.length === 0) {
    return defaultFallbackIdf;
  }
  return idfData.find(idf => idf.id === currentIdfId) || idfData[0] || defaultFallbackIdf;
}

function updateIdfChipsBar() {
  const chipsScroll = document.querySelector("#idfChipsScroll");
  if (!chipsScroll) return;

  if (!Array.isArray(idfData) || idfData.length === 0) {
    chipsScroll.innerHTML = '<span style="padding:8px 12px;font-size:12px;color:var(--text-muted)">Cargando IDFs...</span>';
    return;
  }

  const fragment = document.createDocumentFragment();
  idfData.forEach(idf => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `idf-chip-btn ${idf.id === currentIdfId ? "active" : ""}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(idf.id === currentIdfId));
    btn.setAttribute("data-idf-id", idf.id);

    const statusDot = document.createElement("span");
    const unresolvedIncidents = (Array.isArray(idf.incidents) ? idf.incidents : []).filter(i => i.status !== "resolved");
    const hasAlert = unresolvedIncidents.length > 0;
    statusDot.className = `idf-chip-status ${hasAlert ? "has-alert" : ""}`;

    const label = document.createElement("span");
    label.textContent = idf.name;

    btn.append(statusDot, label);

    if (hasAlert) {
      const badge = document.createElement("span");
      badge.className = "idf-chip-badge";
      badge.textContent = unresolvedIncidents.length;
      btn.append(badge);
    }

    btn.addEventListener("click", () => {
      currentIdfId = idf.id;
      idfDeviceFilter = "";
      updateIdfChipsBar();
      renderIdfContent();
    });

    fragment.append(btn);
  });

  chipsScroll.replaceChildren(fragment);
}

function updateIdfSubnavTabs() {
  const tabs = document.querySelectorAll(".idf-tab-link[data-idf-tab]");
  tabs.forEach(tab => {
    const isCurrent = tab.dataset.idfTab === currentIdfTab;
    tab.classList.toggle("active", isCurrent);
    tab.setAttribute("aria-selected", String(isCurrent));
  });
}

function renderIdfContent() {
  const container = document.querySelector("#idfDynamicContainer");
  if (!container) return;

  updateIdfSubnavTabs();

  const idf = getSelectedIdf();
  const unresolvedIncidents = (Array.isArray(idf.incidents) ? idf.incidents : []).filter(i => i.status !== "resolved");

  if (currentIdfTab === "inventory") {
    const filteredDevices = idf.devices.filter(d => {
      if (!idfDeviceFilter) return true;
      const q = idfDeviceFilter.toLocaleLowerCase("es-MX");
      return (
        (d.desc && d.desc.toLowerCase().includes(q)) ||
        (d.brandModel && d.brandModel.toLowerCase().includes(q)) ||
        (d.serial && d.serial.toLowerCase().includes(q)) ||
        (d.mac && d.mac.toLowerCase().includes(q)) ||
        (d.ports && d.ports.toLowerCase().includes(q)) ||
        (d.ru && String(d.ru).toLowerCase().includes(q)) ||
        (d.type && d.type.toLowerCase().includes(q))
      );
    });

    const rowsHtml = filteredDevices.length > 0
      ? filteredDevices.map((d, idx) => `
        <tr>
          <td>
            <span class="device-name">
              <i class="device-type-icon" aria-hidden="true">${d.icon || "▤"}</i>
              ${d.desc}
            </span>
          </td>
          <td>
            <span class="badge-ru">${d.ru && d.ru !== "—" ? (String(d.ru).toLowerCase().startsWith("u") ? d.ru : "U" + d.ru) : "Base"}</span>
          </td>
          <td><strong style="color:var(--text);font-size:13.5px">${d.brandModel}</strong></td>
          <td><span class="mono-code">${d.serial}</span></td>
          <td><span class="mono-code ${d.mac && d.mac !== "—" ? "has-mac" : ""}">${d.mac}</span></td>
          <td><span style="font-family:var(--font-mono);font-size:12.5px;color:#a3bac8">${d.ports}</span></td>
          <td>
            <span class="status-pill ${d.status}">
              <i></i>${d.status === "online" ? "En servicio" : "Fuera de línea"}
            </span>
          </td>
          <td style="text-align:center">
            <div class="row-actions-cell">
              <button type="button" class="row-edit-btn" title="Modificar equipo" data-edit-device-idx="${idx}" aria-label="Editar ${d.desc}">
                <span aria-hidden="true">✎</span>
              </button>
              <button type="button" class="row-delete-btn" title="Eliminar equipo del gabinete" data-delete-device-idx="${idx}" aria-label="Eliminar ${d.desc}">
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          </td>
        </tr>
      `).join("")
      : `<tr><td colspan="8" style="text-align:center;padding:26px;color:var(--muted)">No se encontraron equipos con el filtro actual en ${idf.name}</td></tr>`;

    container.innerHTML = `
      <div class="idf-view-header">
        <h3>Inventario de Equipos — ${idf.name}</h3>
        <div class="idf-actions">
          <div class="search-wrap" style="width:340px">
            <span aria-hidden="true">⌕</span>
            <input type="search" id="idfDeviceSearchInput" placeholder="Filtrar por modelo, serie, MAC, U…" value="${idfDeviceFilter}" />
          </div>
          <button class="primary-button" type="button" id="openAddDeviceBtn">
            <span aria-hidden="true">＋</span> Agregar equipo
          </button>
        </div>
      </div>

      <div class="table-wrap" tabindex="0" aria-label="Tabla de inventario del rack">
        <table>
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Nivel (Rack)</th>
              <th>Marca y Modelo</th>
              <th>N° Serie</th>
              <th>Dirección MAC</th>
              <th>Puertos / Capacidad</th>
              <th>Estado</th>
              <th style="text-align:center;width:80px">Acciones</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="table-footer">
        <span>Total: ${idf.devices.length} equipos registrados en este gabinete (${filteredDevices.length} visibles)</span>
        <button class="secondary-button" style="height:34px;font-size:12.5px;padding:0 14px" id="quickExportIdfBtn">Exportar CSV</button>
      </div>
    `;

    const devSearch = container.querySelector("#idfDeviceSearchInput");
    if (devSearch) {
      devSearch.addEventListener("input", (e) => {
        idfDeviceFilter = e.target.value.trim();
        renderIdfContent();
        const inputNow = container.querySelector("#idfDeviceSearchInput");
        if (inputNow) {
          inputNow.focus();
          inputNow.selectionStart = inputNow.selectionEnd = inputNow.value.length;
        }
      });
    }

    const addDevBtn = container.querySelector("#openAddDeviceBtn");
    if (addDevBtn) {
      addDevBtn.addEventListener("click", () => {
        const dialog = document.querySelector("#addDeviceDialog");
        document.querySelector("#addDeviceTitle").textContent = "Agregar equipo al IDF";
        document.querySelector("#addDeviceDesc").textContent = "Registra un nuevo switch, patch panel, UPS o componente al inventario físico del gabinete.";
        document.querySelector("#submitDeviceBtn").textContent = "Agregar al rack";
        document.querySelector("#editingDeviceIdx").value = "";

        document.querySelector("#addDeviceTargetLabel").value = idf.name;
        document.querySelector("#newDeviceDesc").value = "";
        document.querySelector("#newDeviceRu").value = "U";
        document.querySelector("#newDeviceBrand").value = "";
        document.querySelector("#newDeviceModel").value = "";
        document.querySelector("#newDeviceSerial").value = "";
        document.querySelector("#newDeviceMac").value = "";
        document.querySelector("#newDevicePorts").value = "48 + 4 fibra";
        document.querySelector("#newDeviceType").value = "Switch Acceso L2 PoE+";
        document.querySelector("#newDeviceStatus").value = "online";
        dialog.showModal();
      });
    }

    container.querySelectorAll("[data-edit-device-idx]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const rawIdx = e.currentTarget.getAttribute("data-edit-device-idx");
        const targetDev = filteredDevices[Number(rawIdx)];
        if (!targetDev) return;

        const realIdx = idf.devices.indexOf(targetDev);
        if (realIdx === -1) return;

        const dialog = document.querySelector("#addDeviceDialog");
        document.querySelector("#addDeviceTitle").textContent = "Modificar equipo del rack";
        document.querySelector("#addDeviceDesc").textContent = `Editando especificaciones de "${targetDev.desc}" en ${idf.name}.`;
        document.querySelector("#submitDeviceBtn").textContent = "Guardar cambios";
        document.querySelector("#editingDeviceIdx").value = String(realIdx);

        document.querySelector("#addDeviceTargetLabel").value = idf.name;
        document.querySelector("#newDeviceDesc").value = targetDev.desc || "";
        document.querySelector("#newDeviceRu").value = targetDev.ru || "";
        document.querySelector("#newDeviceBrand").value = targetDev.brand && targetDev.brand !== "—" ? targetDev.brand : "";
        document.querySelector("#newDeviceModel").value = targetDev.model && targetDev.model !== "—" ? targetDev.model : "";
        document.querySelector("#newDeviceSerial").value = targetDev.serial && targetDev.serial !== "—" ? targetDev.serial : "";
        document.querySelector("#newDeviceMac").value = targetDev.mac && targetDev.mac !== "—" ? targetDev.mac : "";
        document.querySelector("#newDevicePorts").value = targetDev.ports && targetDev.ports !== "—" ? targetDev.ports : "";
        document.querySelector("#newDeviceType").value = targetDev.type || "Switch Acceso L2 PoE+";
        document.querySelector("#newDeviceStatus").value = targetDev.status || "online";

        dialog.showModal();
      });
    });

    container.querySelectorAll("[data-delete-device-idx]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const rawIdx = e.currentTarget.getAttribute("data-delete-device-idx");
        const targetDev = filteredDevices[Number(rawIdx)];
        if (!targetDev) return;

        const confirmed = window.confirm(`¿Confirmas que deseas eliminar el equipo "${targetDev.desc}" (${targetDev.brandModel} en ${targetDev.ru}) del gabinete ${idf.name}?`);
        if (!confirmed) return;

        const realIdx = idf.devices.indexOf(targetDev);
        if (realIdx > -1) {
          idf.devices.splice(realIdx, 1);
          fetch('/api/idfs/device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idf_id: idf.id, devices: idf.devices })
          }).catch(e => console.warn("No se pudo persistir eliminación en backend", e));
          showToast(`Equipo "${targetDev.desc}" eliminado de ${idf.name}`);
          renderIdfContent();
        }
      });
    });

    const exportBtn = container.querySelector("#quickExportIdfBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const csvRows = [
          ["Dispositivo", "Nivel", "Marca_Modelo", "Serie", "MAC", "Puertos", "Estado"].join(",")
        ];
        idf.devices.forEach(dev => {
          csvRows.push([
            `"${dev.desc}"`,
            `"${dev.ru}"`,
            `"${dev.brandModel}"`,
            `"${dev.serial}"`,
            `"${dev.mac}"`,
            `"${dev.ports}"`,
            `"${dev.status}"`
          ].join(","));
        });
        const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Inventario_${idf.name.replace(" ", "_")}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast(`Inventario de ${idf.name} exportado a CSV`);
      });
    }

  } else if (currentIdfTab === "incidents") {
    // Vista: REPORTE DE INCIDENTES Y MONITOREO DE CLIMATIZACIÓN (MINI SPLIT)
    const hasMiniSplit = idf.lastMiniSplit;
    const miniSplitBanner = hasMiniSplit ? `
      <div class="idf-telemetry-banner" style="background:#fdfaf5;border:1.5px solid var(--pantone-468);border-radius:10px;padding:14px 18px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div>
          <span style="font-size:10.5px;font-weight:800;color:var(--pantone-7421);letter-spacing:1px;text-transform:uppercase;">CLIMATIZACIÓN DE RACK (MINI SPLIT)</span>
          <div style="display:flex;align-items:center;gap:10px;margin-top:2px;">
            <strong style="font-size:22px;font-family:var(--font-mono);color:var(--pantone-7421);">${hasMiniSplit.temp} °C</strong>
            <span class="telemetry-tag ${hasMiniSplit.status}">
              ${hasMiniSplit.status === "normal" ? "● Óptimo" : hasMiniSplit.status === "warn" ? "▲ Precaución (Elevada)" : "● Alerta Crítica"}
            </span>
          </div>
          <small style="color:#777;font-size:12px;">Última bitácora registrada el ${hasMiniSplit.date}</small>
        </div>
      </div>
    ` : "";

    const incHtml = idf.incidents.length > 0
      ? idf.incidents.map(inc => `
        <article class="incident-card ${inc.severity} ${inc.status}">
          <div>
            <span class="severity-pill ${inc.severity}">${inc.severity === "critical" ? "Crítica" : inc.severity === "medium" ? "Media" : "Baja"}</span>
            ${inc.temp ? `<span class="telemetry-tag ${inc.temp >= 28 ? 'critical' : (inc.temp >= 24 ? 'warn' : 'normal')}">${inc.temp} °C</span>` : ""}
          </div>
          <div class="incident-info">
            <strong>${inc.title}</strong>
            <p>${inc.description}</p>
            <small>Folio: <strong>${inc.id}</strong> · Equipo: <em>${inc.device}</em> · ${inc.date} · Técnico: ${inc.tech}</small>
          </div>
          <div class="incident-actions">
            <span class="status-badge ${inc.status}">${inc.status === "resolved" ? "✓ Resuelto" : inc.status === "in_progress" ? "⏳ En atención" : "● Abierto"}</span>
            ${inc.status !== "resolved" ? `<button class="secondary-button" style="height:32px;font-size:12px;padding:0 12px;margin-top:4px" data-resolve-incident="${inc.id}">Marcar resuelto</button>` : ""}
          </div>
        </article>
      `).join("")
      : `
        <div class="empty-state" style="padding:40px 20px">
          <span style="font-size:28px">✓</span>
          <strong>Sin incidentes pendientes</strong>
          <p>No se registran fallas ni alarmas activas en ${idf.name}.</p>
        </div>
      `;

    container.innerHTML = `
      <div class="idf-view-header">
        <h3>Reportes de Incidentes y Climatización — ${idf.name}</h3>
        <div class="idf-header-actions">
          <button class="primary-button" type="button" id="openNewIncidentBtnHeader" style="background:var(--pantone-7420);color:#ffffff;border-color:var(--pantone-7420);height:38px;padding:0 20px;font-size:13.5px;border-radius:999px;font-weight:700">
            + Levantar reporte en ${idf.name}
          </button>
        </div>
      </div>

      ${miniSplitBanner}

      <div class="incident-card-list">
        ${incHtml}
      </div>
    `;

    container.querySelector("#openNewIncidentBtnHeader")?.addEventListener("click", () => openQuickReport(idf.id));
    container.querySelector("#openNewIncidentBtn")?.addEventListener("click", () => openQuickReport(idf.id));
    container.querySelector("#openQrStationBtnIncidents")?.addEventListener("click", () => openSingleQrModal(idf.id));

    container.querySelectorAll("[data-resolve-incident]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const incId = e.currentTarget.getAttribute("data-resolve-incident");
        const incObj = idf.incidents.find(i => i.id === incId);
        if (incObj) {
          incObj.status = "resolved";
          showToast(`Incidente ${incId} marcado como resuelto`);
          updateIdfChipsBar();
          renderIdfContent();
        }
      });
    });

  } else if (currentIdfTab === "qr") {
    // Vista: CÓDIGO QR DEL GABINETE CON CONFIGURACIÓN DE IP (Diseño exacto Imagen 1)
    const protocol = window.location.protocol || "http:";
    if (!currentQrServerHost) {
      currentQrServerHost = window.__SERVER_IP || window.location.host || "localhost:3000";
    }
    const host = currentQrServerHost;
    const directUrl = `${protocol}//${host}/#reporte?idf=${idf.id}`;

    let qrSvg = "";
    if (window.QRCode && typeof window.QRCode.generateSvg === "function") {
      qrSvg = window.QRCode.generateSvg(directUrl, {
        size: 220,
        colorDark: "#000000",
        colorLight: "#ffffff",
        margin: 2
      });
    } else {
      qrSvg = `<div style="padding:20px;font-family:monospace;font-size:12px;color:#333;">${directUrl}</div>`;
    }

    const safeZone = idf.zone && idf.zone !== "—" ? idf.zone : "Rack de Telecomunicaciones";

    container.innerHTML = `
      <div class="idf-qr-layout-wrap">
        <div class="idf-qr-view-header">
          <span class="eyebrow">DISTRIBUCIÓN Y GABINETES</span>
          <h3>Código QR del Gabinete — ${idf.name}</h3>
          <p class="idf-qr-subtitle">Etiquetado físico para racks y enlace directo a bitácora móvil</p>
        </div>

        <div class="idf-qr-grid">
          <!-- PANEL IZQUIERDO: Conectividad y Planilla Completa -->
          <div class="idf-qr-card-panel">
            <div>
              <div class="idf-qr-panel-head">
                <span class="panel-eyebrow">CONECTIVIDAD MÓVIL</span>
                <h4>Servidor y Escaneo Wi-Fi</h4>
                <p>Configura la dirección de acceso para que los técnicos abran la bitácora desde sus smartphones.</p>
              </div>

              <div class="idf-qr-form-group">
                <label for="idfQrHostInput"><strong>Dirección IP / Host del servidor:</strong></label>
                <div class="qr-host-input-wrap">
                  <input type="text" id="idfQrHostInput" value="${currentQrServerHost}" placeholder="ej. 192.168.100.86:3000" autocomplete="off" />
                  <button class="secondary-button" id="idfResetQrHostBtn" type="button" title="Detectar dirección IP local">Detectar</button>
                </div>
                <small class="field-hint" style="display:block;margin-top:8px;font-size:12px;color:#776e65;line-height:1.4">
                  Si escaneas con tu celular en la red Wi-Fi, ingresa la IP local de esta máquina (ej. 192.168.X.X:3000) para que el enlace abra directamente.
                </small>
              </div>
            </div>

            <div class="idf-qr-panel-divider"></div>

            <div class="idf-qr-panel-section">
              <div>
                <span class="panel-eyebrow">DOCUMENTACIÓN NOC</span>
                <h4>Planilla de Gabinetes</h4>
                <p>Imprime o guarda en PDF la hoja con los 13 códigos QR de todos los racks (IDF 1 a 12 y PACS).</p>
              </div>
              <button class="primary-button idf-qr-btn-full" id="idfQrPrintSheetsBtn" type="button">
                <span aria-hidden="true">⎙</span> Imprimir planilla de QRs
              </button>
            </div>

            <div class="idf-qr-panel-divider"></div>

            <div class="idf-qr-panel-section">
              <div>
                <span class="panel-eyebrow">ATENCIÓN EN SITIO</span>
                <h4>Bitácora de Incidentes</h4>
                <p>Abre el formulario para registrar un mantenimiento o inspección en este gabinete.</p>
              </div>
              <button class="secondary-button idf-qr-btn-full" id="idfQrReportDirectBtn" type="button">
                Levantar reporte en ${idf.name}
              </button>
            </div>
          </div>

          <!-- PANEL DERECHO: Tarjeta de Etiqueta del Rack (IDF Seleccionado) -->
          <article class="single-qr-card idf-qr-single-tag">
            <div class="single-qr-header">
              <span class="tag-noc-label">S.G.R.S. · INFRAESTRUCTURA NOC</span>
              <h3 class="single-qr-title" style="margin-top:4px;font-size:26px">${idf.name}</h3>
              <span class="tag-zone-label">${safeZone}</span>
            </div>

            <div class="single-qr-svg-wrap" style="width:220px;height:220px;margin:10px auto;">
              ${qrSvg}
            </div>

            <div class="single-qr-url-box">
              <span class="single-qr-url-text">${directUrl}</span>
              <button type="button" class="secondary-button idf-qr-copy-btn" id="idfQrCopyUrlBtn">Copiar</button>
            </div>

            <div class="single-qr-hint" style="font-size:11.5px;color:#666;margin:4px 0 0 0;font-weight:500;text-align:center;">
              Escaneo directo para bitácora técnica y Mini Split
            </div>
          </article>
        </div>
      </div>
    `;

    const hostInput = container.querySelector("#idfQrHostInput");
    if (hostInput) {
      hostInput.addEventListener("input", (e) => {
        currentQrServerHost = e.target.value.trim();
        const activeHost = currentQrServerHost || window.location.host || "localhost:3000";
        const newUrl = `${protocol}//${activeHost}/#reporte?idf=${idf.id}`;
        const svgWrap = container.querySelector(".single-qr-svg-wrap");
        if (svgWrap && window.QRCode && typeof window.QRCode.generateSvg === "function") {
          svgWrap.innerHTML = window.QRCode.generateSvg(newUrl, {
            size: 220,
            colorDark: "#000000",
            colorLight: "#ffffff",
            margin: 2
          });
        }
        const urlDisplay = container.querySelector(".single-qr-url-box span");
        if (urlDisplay) urlDisplay.textContent = newUrl;
      });
    }

    container.querySelector("#idfResetQrHostBtn")?.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/ip");
        if (res.ok) {
          const data = await res.json();
          if (data.ip) {
            currentQrServerHost = data.ip;
            window.__SERVER_IP = data.ip;
          }
        }
      } catch (err) {
        currentQrServerHost = window.location.host || "localhost:3000";
      }
      renderIdfContent();
      showToast(`Host detectado: ${currentQrServerHost}`);
    });

    container.querySelector("#idfQrPrintSheetsBtn")?.addEventListener("click", () => {
      const dialog = document.querySelector("#qrStationDialog");
      const qrHostInput = document.querySelector("#qrHostInput");
      if (qrHostInput) {
        qrHostInput.value = currentQrServerHost || window.__SERVER_IP || window.location.host || "localhost:3000";
      }
      if (typeof renderQrStationCards === "function") {
        renderQrStationCards();
      }

      // Enviar directamente al cuadro de impresión / guardar como PDF sin abrir modal en pantalla
      document.body.classList.add("printing-qr-sheets");
      const wasOpen = dialog && dialog.hasAttribute("open");
      if (dialog && !wasOpen) {
        dialog.setAttribute("open", "");
      }

      window.print();

      window.setTimeout(() => {
        document.body.classList.remove("printing-qr-sheets");
        if (dialog && !wasOpen) {
          dialog.removeAttribute("open");
        }
      }, 1000);
    });

    container.querySelector("#idfQrReportDirectBtn")?.addEventListener("click", () => openQuickReport(idf.id));
    container.querySelector("#idfQrCardSimulateBtn")?.addEventListener("click", () => openQuickReport(idf.id));

    const triggerPrintSingle = () => {
      const modal = document.querySelector("#singleQrModal");
      if (typeof openSingleQrModal === "function") {
        openSingleQrModal(idf.id);
      }
      document.body.classList.add("printing-single-qr");
      const wasOpen = modal && modal.hasAttribute("open");
      if (modal && !wasOpen) {
        modal.setAttribute("open", "");
      }

      window.print();

      window.setTimeout(() => {
        document.body.classList.remove("printing-single-qr");
        if (modal && !wasOpen) {
          modal.removeAttribute("open");
        }
      }, 1000);
    };

    container.querySelector("#idfQrCardPrintBtn")?.addEventListener("click", triggerPrintSingle);

    container.querySelector("#idfQrCopyUrlBtn")?.addEventListener("click", () => {
      const activeHost = currentQrServerHost || window.location.host || "localhost:3000";
      const newUrl = `${protocol}//${activeHost}/#reporte?idf=${idf.id}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(newUrl).then(() => {
          showToast(`Enlace de ${idf.name} copiado`);
        }).catch(() => {
          showToast(`Enlace: ${newUrl}`);
        });
      } else {
        showToast(`Enlace: ${newUrl}`);
      }
    });
  }
}

function initIdfEvents() {
  const tabs = document.querySelectorAll(".idf-tab-link[data-idf-tab]");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      currentIdfTab = tab.dataset.idfTab;
      updateIdfSubnavTabs();
      renderIdfContent();
    });
  });

  updateIdfChipsBar();
  updateIdfSubnavTabs();
  renderIdfContent();
}

/* ==========================================================================
   ENRUTADOR SPA ASÍNCRONO (VIEWS FETCH + CACHE)
   ========================================================================== */

async function fetchViewHtml(viewId) {
  const routeAliases = {
    disponible: "disponibilidad",
    "ip-disponible": "disponibilidad",
    disponibles: "disponibilidad",
    ipam: "disponibilidad",
    direcciones: "disponibilidad",
    alertas: "resumen",
    topologia: "resumen",
    reportes: "idf",
    qr: "idf"
  };
  const normalizedId = routeAliases[viewId] || viewId;
  if (viewCache[normalizedId]) return viewCache[normalizedId];

  try {
    const response = await fetch(`views/${normalizedId}.html?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const html = await response.text();
    viewCache[normalizedId] = html;
    return html;
  } catch (err) {
    console.warn(`Error al cargar views/${normalizedId}.html vía fetch:`, err);
    return `<div class="empty-state" style="padding:40px 20px">
      <span>!</span>
      <strong>Error al cargar módulo (${normalizedId})</strong>
      <p>Asegúrate de servir el proyecto con un servidor local (ej. <code>python -m http.server 8000</code>).</p>
    </div>`;
  }
}

async function switchView(viewId, updateHash = true) {
  const routeAliases = {
    disponible: "disponibilidad",
    "ip-disponible": "disponibilidad",
    disponibles: "disponibilidad",
    ipam: "disponibilidad",
    direcciones: "disponibilidad",
    alertas: "resumen",
    topologia: "resumen",
    reportes: "idf",
    qr: "idf"
  };
  if (viewId === "qr" || viewId === "reportes") {
    currentIdfTab = "qr";
  }
  const normalizedId = routeAliases[viewId] || viewId;
  const targetId = viewConfig[normalizedId] ? normalizedId : "resumen";
  const config = viewConfig[targetId];
  currentActiveView = targetId;

  // 1. Actualizar barra lateral
  document.querySelectorAll(".nav-item").forEach(link => {
    const isTarget = link.dataset.view === targetId || (targetId === "disponibilidad" && (link.dataset.view === "disponible" || link.dataset.view === "disponibilidad"));
    link.classList.toggle("active", isTarget);
    if (isTarget) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  // 2. Actualizar Topbar
  const topbarTitle = document.querySelector("#topbarTitle");
  const topbarEyebrow = document.querySelector("#topbarEyebrow");
  if (topbarTitle && config) topbarTitle.textContent = config.title;
  if (topbarEyebrow && config) topbarEyebrow.textContent = config.eyebrow;

  // 3. Actualizar URL
  if (updateHash && window.location.hash !== `#${targetId}`) {
    history.pushState(null, "", `#${targetId}`);
  }

  // 4. Cargar e inyectar HTML de la vista
  const container = document.querySelector("#viewContainer");
  if (container) {
    container.innerHTML = `<div class="view-loader"><span class="spinner"></span>Cargando módulo...</div>`;
    const html = await fetchViewHtml(targetId);
    container.innerHTML = html;

    // 5. Inicializadores específicos de la vista cargada
    if (targetId === "resumen") {
      initResumenEvents();
      document.querySelectorAll("[data-navigate]").forEach(card => {
        card.addEventListener("click", () => switchView(card.dataset.navigate));
      });
      document.querySelectorAll(".view-link[data-view]").forEach(link => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          switchView(link.dataset.view);
        });
      });
    } else if (targetId === "dispositivos") {
      initDevicesEvents();
    } else if (targetId === "idf") {
      initIdfEvents();
    } else if (targetId === "actividad") {
      const btn = document.querySelector("#exportLogBtn");
      if (btn) btn.addEventListener("click", () => showToast("Exportando bitácora completa a CSV..."));
    } else if (targetId === "qr") {
      initQrView();
    } else if (targetId === "disponibilidad" || targetId === "disponible" || targetId === "ip-disponible" || targetId === "ipam") {
      initDisponibilidadEvents();
    }
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
  closeMenu();
}

// Eventos de barra lateral
document.querySelectorAll(".nav-item[data-view]").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.body.classList.remove("mobile-report-mode");
    switchView(link.dataset.view);
  });
});

function findIdf(targetId) {
  if (!targetId) return idfData[0] || defaultFallbackIdf;
  const clean = String(targetId).toLowerCase().trim();
  const cleanAlnum = clean.replace(/[^a-z0-9]/g, "");
  const numOnly = clean.replace(/[^0-9]/g, "");
  const isPacs = clean.includes("pacs");

  // 1. Buscar coincidencia exacta o flexible en idfData
  if (Array.isArray(idfData) && idfData.length > 0) {
    const found = idfData.find(i => {
      const iId = String(i.id || "").toLowerCase().trim();
      const iName = String(i.name || "").toLowerCase().trim();
      const iIdAlnum = iId.replace(/[^a-z0-9]/g, "");
      const iNameAlnum = iName.replace(/[^a-z0-9]/g, "");
      const iNum = iId.replace(/[^0-9]/g, "");

      if (isPacs && (iId.includes("pacs") || iName.includes("pacs"))) return true;
      if (clean === iId || clean === iName) return true;
      if (cleanAlnum === iIdAlnum || cleanAlnum === iNameAlnum) return true;
      if (numOnly && numOnly === iNum) return true;
      return false;
    });
    if (found) return found;
  }

  // 2. Fallback dinámico inteligente: si idfData aún no cargó o no se encontró en el array,
  // construir dinámicamente el IDF con el ID y nombre solicitado en lugar de forzar idf-1
  const id = isPacs ? "idf-pacs" : (numOnly ? `idf-${numOnly}` : (clean.startsWith("idf-") ? clean : `idf-${clean}`));
  const name = isPacs ? "PACS" : (numOnly ? `IDF ${numOnly}` : clean.toUpperCase());
  return {
    id,
    name,
    zone: "Zona Operativa",
    rack: "Gabinete 42U",
    devices: [],
    incidents: []
  };
}

function handleHashRouting() {
  const rawHash = window.location.hash.replace(/^#/, "").trim();
  if (!rawHash) {
    document.body.classList.remove("mobile-report-mode");
    switchView("resumen", false);
    return;
  }

  const [routePart, queryPart] = rawHash.split("?");
  const params = new URLSearchParams(queryPart || "");
  const normalizedRoute = (routePart === "disponible" || routePart === "ip-disponible" || routePart === "ipam" || routePart === "disponibles") ? "disponibilidad" : routePart;

  if (normalizedRoute === "reporte") {
    const rawTarget = params.get("idf") || currentIdfId || "idf-1";
    const targetIdf = findIdf(rawTarget);
    currentIdfId = targetIdf.id;
    // Activar modo móvil siempre al entrar por la ruta directa de reporte (escaneo QR)
    document.body.classList.add("mobile-report-mode");
    switchView("idf", false).then(() => {
      const finalIdf = findIdf(rawTarget);
      currentIdfId = finalIdf.id;
      openQuickReport(finalIdf.id);
    });
    return;
  }

  document.body.classList.remove("mobile-report-mode");

  if (normalizedRoute === "qr" || normalizedRoute === "reportes") {
    currentIdfTab = "qr";
    if (params.has("idf")) {
      const found = findIdf(params.get("idf"));
      currentIdfId = found.id;
    }
    switchView("idf", false);
    return;
  }

  if (normalizedRoute === "idf") {
    if (params.has("idf")) {
      const found = findIdf(params.get("idf"));
      currentIdfId = found.id;
    }
    if (params.has("tab")) {
      const reqTab = params.get("tab");
      if (reqTab === "inventory" || reqTab === "incidents" || reqTab === "qr") {
        currentIdfTab = reqTab;
      }
    }
    switchView("idf", false);
    return;
  }

  if (viewConfig[normalizedRoute]) {
    switchView(normalizedRoute, false);
  } else {
    switchView("resumen", false);
  }
}

// Soporte de navegación atrás/adelante y cambio de hash
window.addEventListener("popstate", handleHashRouting);
window.addEventListener("hashchange", handleHashRouting);

/* ==========================================================================
   DIÁLOGOS GLOBALES Y NOTIFICACIONES
   ========================================================================== */

const sidebar = document.querySelector("#sidebar");
const backdrop = document.querySelector("#drawerBackdrop");
const menuButton = document.querySelector("#menuButton");
function closeMenu() {
  if (sidebar) sidebar.classList.remove("open");
  if (backdrop) backdrop.hidden = true;
  if (menuButton) menuButton.setAttribute("aria-expanded", "false");
}
if (menuButton) {
  menuButton.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    backdrop.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  });
}
if (backdrop) backdrop.addEventListener("click", closeMenu);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && sidebar && sidebar.classList.contains("open")) closeMenu();
});

// Modal de Movimiento
const movementDialog = document.querySelector("#movementDialog");
const movementBtn = document.querySelector("#movementButton");
if (movementBtn && movementDialog) {
  movementBtn.addEventListener("click", () => movementDialog.showModal());
}
const closeMoveBtn = document.querySelector("#closeDialog");
if (closeMoveBtn && movementDialog) closeMoveBtn.addEventListener("click", () => movementDialog.close());
const cancelMoveBtn = document.querySelector("#cancelDialog");
if (cancelMoveBtn && movementDialog) cancelMoveBtn.addEventListener("click", () => movementDialog.close());
document.querySelectorAll("[data-movement]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (movementDialog) movementDialog.close();
    showToast(`Flujo de ${btn.dataset.movement} listo para conectar con API`);
  });
});

// ==========================================================================
// MÓDULO: BITÁCORA TÉCNICA RÁPIDA (QR) Y ESTACIÓN DE CÓDIGOS QR
// ==========================================================================

const quickReportDialog = document.querySelector("#quickReportDialog");
const closeQuickReportBtn = document.querySelector("#closeQuickReportBtn");
const cancelQuickReportBtn = document.querySelector("#cancelQuickReportBtn");
const quickReportForm = document.querySelector("#quickReportForm");
const reportTempInput = document.querySelector("#reportMiniSplitTemp");
const reportTempPill = document.querySelector("#tempStatusPill");

if (closeQuickReportBtn && quickReportDialog) {
  closeQuickReportBtn.addEventListener("click", () => quickReportDialog.close());
}
if (cancelQuickReportBtn && quickReportDialog) {
  cancelQuickReportBtn.addEventListener("click", () => quickReportDialog.close());
}

// Indicador dinámico de temperatura en tiempo real
if (reportTempInput && reportTempPill) {
  reportTempInput.addEventListener("input", () => {
    const val = parseFloat(reportTempInput.value);
    if (isNaN(val)) {
      reportTempPill.className = "temp-pill normal";
      reportTempPill.textContent = "16°C – 23°C (Normal)";
      return;
    }
    if (val < 24) {
      reportTempPill.className = "temp-pill normal";
      reportTempPill.textContent = `${val}°C · Climatización óptima`;
    } else if (val < 28) {
      reportTempPill.className = "temp-pill warn";
      reportTempPill.textContent = `${val}°C · Temperatura elevada`;
    } else {
      reportTempPill.className = "temp-pill critical";
      reportTempPill.textContent = `${val}°C · Alarma: Sobrecalentamiento`;
    }
  });
}

function openQuickReport(targetIdfId) {
  const idf = findIdf(targetIdfId || currentIdfId);
  currentIdfId = idf.id;
  if (!quickReportDialog) return;

  const targetIdInput = document.querySelector("#reportTargetIdfId");
  const labelInput = document.querySelector("#reportIdfLabel");
  const dateInput = document.querySelector("#reportDateInput");
  const timeInput = document.querySelector("#reportTimeInput");
  const tempInput = document.querySelector("#reportMiniSplitTemp");
  const descInput = document.querySelector("#reportIncidentDesc");

  if (targetIdInput) targetIdInput.value = idf.id;
  if (labelInput) {
    labelInput.value = (idf.zone && idf.zone !== "—") ? `${idf.name} · ${idf.zone}` : idf.name;
  }

  // Llenado automático de fecha y hora actual
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  if (dateInput) dateInput.value = dateStr;
  if (timeInput) timeInput.value = timeStr;
  if (tempInput) tempInput.value = "";
  if (descInput) descInput.value = "";

  if (reportTempPill) {
    reportTempPill.className = "temp-pill normal";
    reportTempPill.textContent = "16°C – 23°C (Normal)";
  }

  quickReportDialog.showModal();
  setTimeout(() => {
    tempInput?.focus();
  }, 100);
}

// Envío del Formulario de Reporte Rápido / Mini-Split
let _reportSubmitting = false;
if (quickReportForm) {
  quickReportForm.addEventListener("submit", (e) => {
    e.preventDefault();
    // Debounce: evitar envíos duplicados
    if (_reportSubmitting) return;
    _reportSubmitting = true;
    const submitBtn = quickReportForm.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Enviando..."; }
    setTimeout(() => {
      _reportSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "✓ Guardar reporte"; }
    }, 2500);

    const targetId = document.querySelector("#reportTargetIdfId")?.value || currentIdfId;
    const idf = idfData.find(i => i.id === targetId) || getSelectedIdf();
    const rawTemp = document.querySelector("#reportMiniSplitTemp").value;
    const tempVal = parseFloat(rawTemp);
    const descVal = document.querySelector("#reportIncidentDesc").value.trim();
    const techVal = document.querySelector("#reportTechInput").value.trim() || "Israel R.";
    const dateVal = document.querySelector("#reportDateInput").value;
    const timeVal = document.querySelector("#reportTimeInput").value;

    // Validación: temperatura obligatoria y numérica
    if (!rawTemp || isNaN(tempVal)) {
      showToast("⚠ Ingresa la temperatura del Mini Split (valor numérico)");
      _reportSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "✓ Guardar reporte"; }
      document.querySelector("#reportMiniSplitTemp")?.focus();
      return;
    }

    const isWarn = tempVal >= 24 && tempVal < 28;
    const isCrit = tempVal >= 28;
    const hasAnomaly = descVal.length > 0;

    // Actualizar siempre la telemetría del Mini Split en el gabinete
    idf.lastMiniSplit = {
      temp: tempVal,
      date: `${dateVal} ${timeVal}`,
      status: isCrit ? "critical" : (isWarn ? "warn" : "normal")
    };

    // OPCIÓN A: Solo crear tarjeta de incidente si hay anomalía real o sobrecalentamiento
    if (isCrit || isWarn || hasAnomaly) {
      let severity = "medium";
      let status = "open";
      let title = "";

      if (isCrit) {
        severity = "critical";
        title = hasAnomaly ? `Falla Crítica / Mini Split (${tempVal}°C)` : `Alerta Crítica: Mini Split a ${tempVal}°C (Sobrecalentamiento)`;
      } else if (isWarn) {
        severity = "warn";
        title = hasAnomaly ? `Incidencia / Mini Split (${tempVal}°C)` : `Temperatura elevada: Mini Split a ${tempVal}°C`;
      } else {
        severity = "medium";
        title = `Incidencia reportada en ${idf.name}`;
      }

      const description = hasAnomaly
        ? descVal
        : `Alerta automática por climatización fuera de rango óptimo (${tempVal}°C).`;

      const folio = `FOL-${idf.name.replace(/\s+/g, "")}-${Date.now().toString(36).toUpperCase().slice(-5)}`;

      const newInc = {
        id: folio,
        date: `${dateVal} ${timeVal}`,
        severity,
        device: `Mini Split (${tempVal}°C)`,
        temp: tempVal,
        title,
        description,
        status,
        tech: techVal
      };
      
      idf.incidents.unshift(newInc);

      // Guardar en el servidor (Persistencia)
      fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idf_id: idf.id,
          incident: newInc,
          telemetry: idf.lastMiniSplit
        })
      }).catch(err => console.error("Error al guardar reporte:", err));

      showToast(`✓ Incidencia ${folio} registrada para ${idf.name} (${tempVal}°C)`);
    } else {
      // Lectura óptima / rutinaria sin anomalías: solo actualiza el banner superior de climatización
      fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idf_id: idf.id,
          incident: null,
          telemetry: idf.lastMiniSplit
        })
      }).catch(err => console.error("Error al guardar telemetría:", err));

      showToast(`✓ Climatización registrada: ${tempVal}°C (Óptimo) en ${idf.name}`);
    }

    const isMobile = window.innerWidth <= 768 || document.body.classList.contains("mobile-report-mode") || window.location.hash.includes("reporte");
    if (quickReportDialog) quickReportDialog.close();

    if (isMobile) {
      document.body.classList.add("mobile-report-mode");
      const modal = document.querySelector("#reportSuccessModal");
      if (modal) {
        const idfNameEl = document.querySelector("#successIdfName");
        if (idfNameEl) idfNameEl.textContent = idf.name;
        
        const sumIdfEl = document.querySelector("#successSummaryIdf");
        if (sumIdfEl) sumIdfEl.textContent = idf.name;
        
        const sumTempEl = document.querySelector("#successSummaryTemp");
        if (sumTempEl) sumTempEl.textContent = `${tempVal}°C`;
        
        const tempPill = document.querySelector("#successSummaryTempPill");
        if (tempPill) {
          tempPill.className = `temp-pill ${isCrit ? "critical" : (isWarn ? "warn" : "normal")}`;
          tempPill.textContent = isCrit ? "Alarma" : (isWarn ? "Elevada" : "Óptimo");
        }
        
        const sumDateEl = document.querySelector("#successSummaryDate");
        if (sumDateEl) sumDateEl.textContent = `${dateVal} ${timeVal}`;
        
        const sumTechEl = document.querySelector("#successSummaryTech");
        if (sumTechEl) sumTechEl.textContent = techVal;
        
        const sumIncEl = document.querySelector("#successSummaryIncident");
        if (sumIncEl) sumIncEl.textContent = hasAnomaly ? descVal : "Sin anomalías";
        
        modal.showModal();
      }
    } else {
      currentIdfId = idf.id;
      currentIdfTab = "incidents";
      updateIdfChipsBar();
      if (currentActiveView === "idf") {
        renderIdfContent();
      } else {
        switchView("idf");
      }
    }
  });
}

// Botones del Modal de Éxito
const finishReportBtn = document.querySelector("#finishReportBtn");
const newReportBtn = document.querySelector("#newReportBtn");
const reportSuccessModal = document.querySelector("#reportSuccessModal");
const visitConcludedMsg = document.querySelector("#visitConcludedMsg");

if (finishReportBtn) {
  finishReportBtn.addEventListener("click", () => {
    if (document.body.classList.contains("mobile-report-mode")) {
      finishReportBtn.style.display = "none";
      if (newReportBtn) newReportBtn.style.display = "none";
      if (visitConcludedMsg) visitConcludedMsg.style.display = "block";
    } else {
      if (reportSuccessModal) reportSuccessModal.close();
      switchView("resumen");
    }
  });
}

if (newReportBtn) {
  newReportBtn.addEventListener("click", () => {
    if (reportSuccessModal) reportSuccessModal.close();
    openQuickReport(currentIdfId);
  });
}

// Estación de Códigos QR para Racks e IDFs
const qrStationDialog = document.querySelector("#qrStationDialog");
const closeQrStationBtn = document.querySelector("#closeQrStationBtn");
const qrHostInput = document.querySelector("#qrHostInput");
const resetQrHostBtn = document.querySelector("#resetQrHostBtn");
const printQrSheetsBtn = document.querySelector("#printQrSheetsBtn");

if (closeQrStationBtn && qrStationDialog) {
  closeQrStationBtn.addEventListener("click", () => qrStationDialog.close());
}

function renderQrStationCards() {
  const grid = document.querySelector("#qrCardsGrid");
  if (!grid) return;

  const protocol = window.location.protocol || "http:";
  let currentHost = qrHostInput ? qrHostInput.value.trim() : "";
  if (!currentHost) {
    currentHost = window.__SERVER_IP || window.location.host || "localhost:3000";
    if (qrHostInput) qrHostInput.value = currentHost;
  }

  grid.replaceChildren();

  idfData.forEach(idf => {
    const directUrl = `${protocol}//${currentHost}/#reporte?idf=${idf.id}`;
    const card = document.createElement("article");
    card.className = "qr-card";

    const header = document.createElement("div");
    header.className = "qr-card-header";
    header.innerHTML = `
      <span class="qr-card-sys">S.G.R.S. · NOC</span>
      <h3 class="qr-card-title">${idf.name}</h3>
      <p class="qr-card-zone">${idf.zone}</p>
    `;

    const svgWrap = document.createElement("div");
    svgWrap.className = "qr-card-svg";
    if (window.QRCode && typeof window.QRCode.generateSvg === "function") {
      svgWrap.innerHTML = window.QRCode.generateSvg(directUrl, {
        size: 170,
        colorDark: "#000000",
        colorLight: "#ffffff",
        margin: 2
      });
    } else {
      svgWrap.textContent = directUrl;
    }

    const linkPreview = document.createElement("div");
    linkPreview.className = "qr-card-link";
    linkPreview.textContent = directUrl;

    const hint = document.createElement("span");
    hint.className = "qr-card-hint";
    hint.textContent = "Escanear para bitácora y Mini Split";

    const actions = document.createElement("div");
    actions.className = "qr-card-actions qr-no-print";
    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "secondary-button qr-card-test-btn";
    testBtn.textContent = "Abrir reporte directo";
    testBtn.addEventListener("click", () => {
      qrStationDialog?.close();
      openQuickReport(idf.id);
    });
    actions.appendChild(testBtn);

    card.append(header, svgWrap, linkPreview, hint, actions);
    grid.appendChild(card);
  });
}

function openQrStation() {
  if (!qrStationDialog) return;
  if (qrHostInput && !qrHostInput.value) {
    qrHostInput.value = window.__SERVER_IP || window.location.host || "localhost:3000";
  }
  renderQrStationCards();
  qrStationDialog.showModal();
}

if (qrHostInput) {
  qrHostInput.addEventListener("input", () => {
    renderQrStationCards();
  });
}

if (resetQrHostBtn && qrHostInput) {
  resetQrHostBtn.addEventListener("click", () => {
    qrHostInput.value = window.__SERVER_IP || window.location.host || "localhost:3000";
    renderQrStationCards();
    showToast(`Host detectado: ${qrHostInput.value}`);
  });
}

if (printQrSheetsBtn) {
  printQrSheetsBtn.addEventListener("click", () => {
    window.print();
  });
}

// ==========================================================================
// MODAL DE CÓDIGO QR INDIVIDUAL POR GABINETE (DISEÑO EXACTO IMAGEN 2)
// ==========================================================================

const singleQrModal = document.querySelector("#singleQrModal");
const closeSingleQrModalBtn = document.querySelector("#closeSingleQrModalBtn");

if (closeSingleQrModalBtn && singleQrModal) {
  closeSingleQrModalBtn.addEventListener("click", () => {
    singleQrModal.close();
  });
}

if (singleQrModal) {
  singleQrModal.addEventListener("click", (e) => {
    const rect = singleQrModal.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      singleQrModal.close();
    }
  });
}

function openSingleQrModal(targetIdfId) {
  const idf = findIdf(targetIdfId || currentIdfId);
  if (!idf) return;

  const modal = document.querySelector("#singleQrModal");
  const content = document.querySelector("#singleQrCardContent");
  if (!modal || !content) return;

  const protocol = window.location.protocol || "http:";
  const host = window.__SERVER_IP || window.location.host || "localhost:3000";
  const directUrl = `${protocol}//${host}/#reporte?idf=${idf.id}`;

  let qrSvg = "";
  if (window.QRCode && typeof window.QRCode.generateSvg === "function") {
    qrSvg = window.QRCode.generateSvg(directUrl, {
      size: 210,
      colorDark: "#000000",
      colorLight: "#ffffff",
      margin: 2
    });
  } else {
    qrSvg = `<div style="padding:20px;font-family:monospace;font-size:11px;color:#333;">${directUrl}</div>`;
  }

  content.innerHTML = `
    <article class="single-qr-card">
      <div class="single-qr-header">
        <h3 class="single-qr-title" id="singleQrCabinetTitle">${idf.name}</h3>
      </div>

      <div class="single-qr-svg-wrap">
        ${qrSvg}
      </div>

      <div class="single-qr-url">${directUrl}</div>

      <div class="single-qr-hint">Escaneo directo para bitácora técnica y Mini Split</div>

      <div class="single-qr-actions">
        <button type="button" class="single-qr-report-btn" id="singleQrOpenReportBtn">
          Abrir formulario de reporte
        </button>
        <button type="button" class="single-qr-print-btn" id="singleQrPrintBtn">
          Imprimir etiqueta de rack
        </button>
      </div>
    </article>
  `;

  content.querySelector("#singleQrOpenReportBtn")?.addEventListener("click", () => {
    modal.close();
    openQuickReport(idf.id);
  });

  content.querySelector("#singleQrPrintBtn")?.addEventListener("click", () => {
    document.body.classList.add("printing-single-qr");
    window.print();
    window.setTimeout(() => {
      document.body.classList.remove("printing-single-qr");
    }, 1000);
  });

  modal.showModal();
}


// Modal de Agregar Dispositivo al Rack
const addDeviceDialog = document.querySelector("#addDeviceDialog");
const closeAddDev = document.querySelector("#closeAddDeviceDialog");
const cancelAddDev = document.querySelector("#cancelAddDeviceBtn");
const addDeviceForm = document.querySelector("#addDeviceForm");

if (closeAddDev && addDeviceDialog) closeAddDev.addEventListener("click", () => addDeviceDialog.close());
if (cancelAddDev && addDeviceDialog) cancelAddDev.addEventListener("click", () => addDeviceDialog.close());

if (addDeviceForm) {
  addDeviceForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const idf = getSelectedIdf();
    const editingIdxStr = document.querySelector("#editingDeviceIdx").value;
    const desc = document.querySelector("#newDeviceDesc").value.trim();
    let ru = document.querySelector("#newDeviceRu").value.trim();
    const brand = document.querySelector("#newDeviceBrand").value.trim();
    const model = document.querySelector("#newDeviceModel").value.trim();
    const serial = document.querySelector("#newDeviceSerial").value.trim() || "—";
    const mac = document.querySelector("#newDeviceMac").value.trim() || "—";
    const ports = document.querySelector("#newDevicePorts").value.trim() || "—";
    const type = document.querySelector("#newDeviceType").value;
    const status = document.querySelector("#newDeviceStatus").value;

    if (ru && !ru.toLowerCase().startsWith("u") && ru.toLowerCase() !== "base") {
      ru = "U" + ru;
    }

    const brandModel = `${brand} ${model}`.trim() || "—";

    let icon = "▤";
    if (type.includes("Switch")) icon = "⌘";
    else if (type.includes("Firewall")) icon = "◇";
    else if (type.includes("Módem")) icon = "⌁";
    else if (type.includes("UPS")) icon = "↯";
    else if (type.includes("Baterías")) icon = "▥";
    else if (type.includes("Patch")) icon = "▦";
    else if (type.includes("Fibra")) icon = "⌬";
    else if (type.includes("Tierra")) icon = "⏚";

    if (editingIdxStr !== "" && !isNaN(Number(editingIdxStr))) {
      const idx = Number(editingIdxStr);
      if (idf.devices[idx]) {
        idf.devices[idx].desc = desc;
        idf.devices[idx].type = type;
        idf.devices[idx].icon = icon;
        idf.devices[idx].ru = ru || "—";
        idf.devices[idx].brandModel = brandModel;
        idf.devices[idx].brand = brand || "—";
        idf.devices[idx].model = model || "—";
        idf.devices[idx].serial = serial;
        idf.devices[idx].mac = mac;
        idf.devices[idx].ports = ports;
        idf.devices[idx].status = status;
        showToast(`Equipo "${desc}" modificado exitosamente`);
      }
    } else {
      idf.devices.push({
        desc,
        type,
        icon,
        ru: ru || "—",
        brandModel,
        brand: brand || "—",
        model: model || "—",
        serial,
        partNo: "—",
        mac,
        ports,
        status,
        lastCheck: "En servicio"
      });
      showToast(`Equipo "${desc}" agregado al inventario de ${idf.name}`);
    }

    // Persistir la lista completa de dispositivos del gabinete en backend
    fetch('/api/idfs/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idf_id: idf.id, devices: idf.devices })
    }).catch(e => console.warn("No se pudo persistir equipo en backend", e));
    addDeviceDialog.close();
    renderIdfContent();
  });
}

// Toast System
function showToast(message) {
  const region = document.querySelector("#toastRegion");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  const indicator = document.createElement("i");
  const copy = document.createElement("span");
  copy.textContent = message;
  toast.append(indicator, copy);
  region.replaceChildren(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

// Botón de refresco global
const refreshBtn = document.querySelector("#refreshButton");
if (refreshBtn) {
  refreshBtn.addEventListener("click", event => {
    event.currentTarget.setAttribute("aria-busy", "true");
    event.currentTarget.disabled = true;
    window.setTimeout(() => {
      event.currentTarget.removeAttribute("aria-busy");
      event.currentTarget.disabled = false;
      showToast("Datos sincronizados hace un momento");
    }, 650);
  });
}

const userBtn = document.querySelector("#userButton");
if (userBtn) {
  userBtn.addEventListener("click", () => {
    showToast("Administración de perfil en desarrollo");
  });
}

// ==========================================================================
// MÓDULO: DISPONIBILIDAD IP (IPAM) — CONTROL DE DIRECCIONAMIENTO
// ==========================================================================

let ipPoolData = [];

let currentIpamVlan = "all";
let currentIpamStatus = "all";
let currentIpamSearch = "";
let currentIpamViewMode = "table";
let selectedIpForRelease = null;

// Modal global de Gestión IP
const ipManagementDialog = document.querySelector("#ipManagementDialog");
const closeIpDialogBtn = document.querySelector("#closeIpDialogBtn");
const cancelIpDialogBtn = document.querySelector("#cancelIpDialogBtn");
const ipManagementForm = document.querySelector("#ipManagementForm");
const quickReleaseFromDialogBtn = document.querySelector("#quickReleaseFromDialogBtn");

// Modal global de Confirmar Liberación
const ipReleaseConfirmDialog = document.querySelector("#ipReleaseConfirmDialog");
const cancelReleaseConfirmBtn = document.querySelector("#cancelReleaseConfirmBtn");
const confirmReleaseActionBtn = document.querySelector("#confirmReleaseActionBtn");

if (closeIpDialogBtn && ipManagementDialog) closeIpDialogBtn.addEventListener("click", () => ipManagementDialog.close());
if (cancelIpDialogBtn && ipManagementDialog) cancelIpDialogBtn.addEventListener("click", () => ipManagementDialog.close());
if (cancelReleaseConfirmBtn && ipReleaseConfirmDialog) cancelReleaseConfirmBtn.addEventListener("click", () => ipReleaseConfirmDialog.close());

if (confirmReleaseActionBtn) {
  confirmReleaseActionBtn.addEventListener("click", () => {
    if (selectedIpForRelease) {
      executeReleaseIp(selectedIpForRelease);
    }
  });
}

if (quickReleaseFromDialogBtn) {
  quickReleaseFromDialogBtn.addEventListener("click", () => {
    const ipAddr = document.querySelector("#ipAddressInput")?.value;
    if (ipAddr) {
      ipManagementDialog?.close();
      openConfirmRelease(ipAddr);
    }
  });
}

if (ipManagementForm) {
  ipManagementForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const ipAddr = document.querySelector("#ipAddressInput").value;
    const status = document.querySelector("#ipStatusInput").value;
    const hostname = document.querySelector("#ipHostInput").value.trim();
    const type = document.querySelector("#ipTypeCustom").value;
    const mac = document.querySelector("#ipMacInput").value.trim();
    const vlan = document.querySelector("#ipVlanInput").value;
    const location = document.querySelector("#ipLocationCustom").value;
    const notes = document.querySelector("#ipNotesInput").value.trim();

    const record = ipPoolData.find(i => i.ip === ipAddr);
    if (!record) return;

    const prevStatus = record.status;
    record.status = status;
    record.vlan = vlan;
    record.location = location;
    record.notes = notes || "—";

    if (status === "available") {
      record.hostname = "—";
      record.type = "—";
      record.mac = "—";
      showToast(`✓ Dirección ${ipAddr} marcada como LIBRE`);
    } else {
      record.hostname = hostname || "—";
      record.type = type;
      record.mac = mac || "—";
      if (prevStatus === "available") {
        showToast(`✓ IP ${ipAddr} asignada a ${hostname} exitosamente`);
      } else {
        showToast(`✓ Asignación de ${ipAddr} modificada exitosamente`);
      }
    }

    ipManagementDialog.close();
    fetch('/api/ips/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    }).catch(e => console.warn("No se pudo persistir cambio de IP en backend", e));
    renderIpAvailability();
  });
}

function updateIpInputColor(inputEl, status) {
  if (!inputEl) return;
  inputEl.classList.remove("ip-available-highlight", "ip-occupied-highlight", "ip-reserved-highlight");
  if (status === "available") inputEl.classList.add("ip-available-highlight");
  else if (status === "occupied") inputEl.classList.add("ip-occupied-highlight");
  else if (status === "reserved") inputEl.classList.add("ip-reserved-highlight");
}

function openEditIpModal(ipAddress) {
  const record = ipPoolData.find(i => i.ip === ipAddress);
  if (!record || !ipManagementDialog) return;

  const title = document.querySelector("#ipDialogTitle");
  const addrInput = document.querySelector("#ipAddressInput");
  const statusInput = document.querySelector("#ipStatusInput");
  const hostInput = document.querySelector("#ipHostInput");
  const typeInput = document.querySelector("#ipTypeCustom");
  const macInput = document.querySelector("#ipMacInput");
  const vlanInput = document.querySelector("#ipVlanInput");
  const locInput = document.querySelector("#ipLocationCustom");
  const notesInput = document.querySelector("#ipNotesInput");

  if (title) title.textContent = `Gestión de Dirección IP`;
  if (addrInput) {
    addrInput.value = record.ip;
    updateIpInputColor(addrInput, record.status);
  }
  if (statusInput) statusInput.value = record.status;
  if (hostInput) hostInput.value = record.hostname !== "—" ? record.hostname : "";
  if (typeInput && record.type !== "—") typeInput.value = record.type;
  if (macInput) macInput.value = record.mac !== "—" ? record.mac : "";
  if (vlanInput) vlanInput.value = record.vlan;
  if (locInput) locInput.value = record.location;
  if (notesInput) notesInput.value = record.notes !== "—" ? record.notes : "";

  if (quickReleaseFromDialogBtn) {
    quickReleaseFromDialogBtn.style.display = record.status === "occupied" ? "inline-flex" : "none";
  }

  ipManagementDialog.showModal();
}

function openAssignIpModal(ipAddress) {
  let record = ipPoolData.find(i => i.ip === ipAddress);
  if (!record) {
    // Buscar la primera disponible
    record = ipPoolData.find(i => i.status === "available") || ipPoolData[0];
  }
  if (!record || !ipManagementDialog) return;

  const title = document.querySelector("#ipDialogTitle");
  const addrInput = document.querySelector("#ipAddressInput");
  const statusInput = document.querySelector("#ipStatusInput");
  const hostInput = document.querySelector("#ipHostInput");
  const typeInput = document.querySelector("#ipTypeCustom");
  const macInput = document.querySelector("#ipMacInput");
  const vlanInput = document.querySelector("#ipVlanInput");
  const locInput = document.querySelector("#ipLocationCustom");
  const notesInput = document.querySelector("#ipNotesInput");

  if (title) title.textContent = `Asignar Dirección IP`;
  if (addrInput) {
    addrInput.value = record.ip;
    updateIpInputColor(addrInput, record.status);
  }
  if (statusInput) statusInput.value = "occupied";
  if (hostInput) {
    hostInput.value = "";
    setTimeout(() => hostInput.focus(), 150);
  }
  if (typeInput) typeInput.value = "";
  if (macInput) macInput.value = "";
  if (vlanInput) vlanInput.value = record.vlan;
  if (locInput) locInput.value = record.location;
  if (notesInput) notesInput.value = "";

  if (quickReleaseFromDialogBtn) {
    quickReleaseFromDialogBtn.style.display = "none";
  }

  ipManagementDialog.showModal();
}

function openConfirmRelease(ipAddress) {
  const record = ipPoolData.find(i => i.ip === ipAddress);
  if (!record || !ipReleaseConfirmDialog) return;

  selectedIpForRelease = ipAddress;
  const ipText = document.querySelector("#confirmReleaseIpText");
  const hostText = document.querySelector("#confirmReleaseHostText");
  if (ipText) ipText.textContent = record.ip;
  if (hostText) hostText.textContent = `${record.hostname} (${record.type})`;

  ipReleaseConfirmDialog.showModal();
}

function executeReleaseIp(ipAddress) {
  const record = ipPoolData.find(i => i.ip === ipAddress);
  if (!record) return;

  const previousHost = record.hostname;
  record.status = "available";
  record.hostname = "—";
  record.type = "—";
  record.mac = "—";
  record.notes = `Liberada para reasignación el ${new Date().toLocaleDateString("es-MX")}`;

  if (ipReleaseConfirmDialog) ipReleaseConfirmDialog.close();
  selectedIpForRelease = null;

  showToast(`✓ Dirección ${ipAddress} liberada (desasignada de ${previousHost})`);
  renderIpAvailability();
  fetch('/api/ips/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip: ipAddress, action: 'release', status: 'available' })
  }).catch(e => console.warn("No se pudo persistir liberación de IP en backend", e));
}

function exportIpamCsv() {
  const headers = ["Direccion_IP", "Estado", "Hostname", "Tipo_Equipo", "MAC_Address", "VLAN", "Ubicacion", "Notas"];
  const rows = ipPoolData.map(item => [
    `"${item.ip}"`,
    `"${item.status === "available" ? "Libre" : item.status === "occupied" ? "Ocupada" : "Reservada"}"`,
    `"${item.hostname}"`,
    `"${item.type}"`,
    `"${item.mac}"`,
    `"${item.vlan}"`,
    `"${item.location}"`,
    `"${item.notes.replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Inventario_Disponibilidad_IP_SGRS.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("✓ Exportando Inventario_Disponibilidad_IP_SGRS.csv...");
}

function renderIpAvailability() {
  const container = document.querySelector("#ipamTableRows");
  if (!container && !document.querySelector("#ipamMatrixCellsContainer")) return;

  // Segmento seleccionado
  const allInVlan = ipPoolData.filter(item => currentIpamVlan === "all" || item.vlan === currentIpamVlan);
  const total = allInVlan.length;
  const occupiedCount = allInVlan.filter(i => i.status === "occupied").length;
  const availableCount = allInVlan.filter(i => i.status === "available").length;
  const reservedCount = allInVlan.filter(i => i.status === "reserved").length;

  const kpiTotal = document.querySelector("#kpiTotalIps");
  const kpiTotalBadge = document.querySelector("#kpiTotalBadge");
  const kpiTotalBar = document.querySelector("#kpiTotalBar");
  const kpiOcc = document.querySelector("#kpiOccupiedIps");
  const kpiOccPct = document.querySelector("#kpiOccupiedPct");
  const kpiOccBar = document.querySelector("#kpiOccupiedBar");
  const kpiAvail = document.querySelector("#kpiAvailableIps");
  const kpiAvailPct = document.querySelector("#kpiAvailablePct");
  const kpiAvailBar = document.querySelector("#kpiAvailableBar");
  const kpiRes = document.querySelector("#kpiReservedIps");
  const kpiResPct = document.querySelector("#kpiReservedPct");
  const kpiResBar = document.querySelector("#kpiReservedBar");
  const kpiSubDesc = document.querySelector("#kpiSubnetDesc");

  const occPctVal = total ? Math.round((occupiedCount / total) * 100) : 0;
  const availPctVal = total ? Math.round((availableCount / total) * 100) : 0;
  const resPctVal = total ? Math.round((reservedCount / total) * 100) : 0;

  if (kpiTotal) kpiTotal.textContent = total;
  if (kpiTotalBadge) kpiTotalBadge.textContent = currentIpamVlan === "all" ? "100% Red" : "100% Segmento";
  if (kpiTotalBar) kpiTotalBar.style.width = "100%";
  if (kpiOcc) kpiOcc.textContent = occupiedCount;
  if (kpiOccPct) kpiOccPct.textContent = `${occPctVal}%`;
  if (kpiOccBar) kpiOccBar.style.width = `${occPctVal}%`;
  if (kpiAvail) kpiAvail.textContent = availableCount;
  if (kpiAvailPct) kpiAvailPct.textContent = `${availPctVal}%`;
  if (kpiAvailBar) kpiAvailBar.style.width = `${availPctVal}%`;
  if (kpiRes) kpiRes.textContent = reservedCount;
  if (kpiResPct) kpiResPct.textContent = `${resPctVal}%`;
  if (kpiResBar) kpiResBar.style.width = `${resPctVal}%`;
  if (kpiSubDesc) kpiSubDesc.textContent = currentIpamVlan === "all" ? "Segmentos 38 y 40" : `Segmento ${currentIpamVlan}`;

  // Actualizar contadores en botones de filtro
  const countAll = document.querySelector("#countStatusAll");
  const countAvail = document.querySelector("#countStatusAvailable");
  const countOcc = document.querySelector("#countStatusOccupied");
  const countRes = document.querySelector("#countStatusReserved");
  if (countAll) countAll.textContent = total;
  if (countAvail) countAvail.textContent = availableCount;
  if (countOcc) countOcc.textContent = occupiedCount;
  if (countRes) countRes.textContent = reservedCount;

  // Actualizar badge en la barra lateral
  const globalFreeCount = ipPoolData.filter(i => i.status === "available").length;
  const navBadge = document.querySelector("#ipAvailableNavCount");
  if (navBadge) navBadge.textContent = `${globalFreeCount} Libres`;

  // Filtrado de visualización
  const query = currentIpamSearch.toLowerCase();
  const displayed = allInVlan.filter(item => {
    if (currentIpamStatus !== "all" && item.status !== currentIpamStatus) return false;
    if (query) {
      return (
        item.ip.toLowerCase().includes(query) ||
        item.hostname.toLowerCase().includes(query) ||
        item.type.toLowerCase().includes(query) ||
        item.mac.toLowerCase().includes(query) ||
        item.location.toLowerCase().includes(query) ||
        item.vlan.toLowerCase().includes(query) ||
        item.notes.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Switch de vistas (Tabla vs Matriz)
  const tableView = document.querySelector("#ipamTableViewSection");
  const gridView = document.querySelector("#ipamGridViewSection");
  const emptyState = document.querySelector("#ipamTableEmptyState");

  if (currentIpamViewMode === "table") {
    if (tableView) tableView.style.display = "block";
    if (gridView) gridView.style.display = "none";

    if (container) {
      if (displayed.length === 0) {
        container.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
      } else {
        if (emptyState) emptyState.style.display = "none";
        container.innerHTML = displayed.map(item => {
          const statusPill = item.status === "available"
            ? `<span class="ip-status-pill available"><span class="dot-status available"></span> Libre</span>`
            : item.status === "occupied"
            ? `<span class="ip-status-pill occupied"><span class="dot-status occupied"></span> Ocupada</span>`
            : `<span class="ip-status-pill reserved"><span class="dot-status reserved"></span> Reservada</span>`;

          let actionsHtml = "";
          if (item.status === "occupied") {
            actionsHtml = `
              <button type="button" class="ip-action-btn btn-modificar" data-edit-ip="${item.ip}" title="Modificar parámetros del host">✎</button>
              <button type="button" class="ip-action-btn btn-liberar" data-release-ip="${item.ip}" title="Liberar esta IP y desasignar equipo">✕</button>
            `;
          } else if (item.status === "available") {
            actionsHtml = `
              <button type="button" class="ip-action-btn btn-asignar" data-assign-ip="${item.ip}" title="Asignar esta IP libre a un equipo">＋</button>
            `;
          } else {
            actionsHtml = `
              <button type="button" class="ip-action-btn btn-modificar" data-edit-ip="${item.ip}" title="Modificar parámetros">✎</button>
            `;
          }

          return `
            <tr>
              <td><strong class="ip-text">${item.ip}</strong></td>
              <td>${statusPill}</td>
              <td><strong>${item.hostname}</strong></td>
              <td><span style="color:${item.type === '—' ? '#999' : 'inherit'}">${item.type}</span></td>
              <td><span class="ip-mac">${item.mac}</span></td>
              <td><small style="color:var(--text-muted)">${item.location}</small></td>
              <td class="ip-actions-cell">${actionsHtml}</td>
            </tr>
          `;
        }).join("");

        // Eventos de botones en la tabla
        container.querySelectorAll("[data-release-ip]").forEach(btn => {
          btn.addEventListener("click", () => openConfirmRelease(btn.getAttribute("data-release-ip")));
        });
        container.querySelectorAll("[data-edit-ip]").forEach(btn => {
          btn.addEventListener("click", () => openEditIpModal(btn.getAttribute("data-edit-ip")));
        });
        container.querySelectorAll("[data-assign-ip]").forEach(btn => {
          btn.addEventListener("click", () => openAssignIpModal(btn.getAttribute("data-assign-ip")));
        });
      }
    }
  } else {
    // Modo Matriz / Heatmap
    if (tableView) tableView.style.display = "none";
    if (gridView) gridView.style.display = "block";

    const matrixContainer = document.querySelector("#ipamMatrixCellsContainer");
    if (matrixContainer) {
      matrixContainer.innerHTML = displayed.map(item => {
        const lastOctet = item.ip.split(".").pop();
        const tooltip = `${item.ip} · ${item.status === 'available' ? 'LIBRE (Clic para asignar)' : item.hostname + ' [' + item.type + '] - Clic para editar'}`;
        return `
          <div 
            class="ip-cell ${item.status}" 
            data-matrix-ip="${item.ip}" 
            title="${tooltip}" 
            role="button" 
            tabindex="0"
          >
            <span class="cell-num">.${lastOctet}</span>
          </div>
        `;
      }).join("");

      matrixContainer.querySelectorAll("[data-matrix-ip]").forEach(cell => {
        cell.addEventListener("click", () => {
          const ipAddr = cell.getAttribute("data-matrix-ip");
          const record = ipPoolData.find(i => i.ip === ipAddr);
          if (record?.status === "available") {
            openAssignIpModal(ipAddr);
          } else {
            openEditIpModal(ipAddr);
          }
        });
      });
    }
  }
}

// ==========================================================================
// MÓDULO: VISTA EMBEBIDA DE CÓDIGOS QR (views/qr.html)
// ==========================================================================

function initQrView() {
  const grid = document.querySelector("#qrViewCardsGrid");
  const hostInput = document.querySelector("#qrViewHostInput");
  const resetHostBtn = document.querySelector("#resetQrViewHostBtn");
  const filterInput = document.querySelector("#qrFilterInput");
  const printBtn = document.querySelector("#printQrViewBtn");

  if (!grid) return;

  // Asegurar que el host esté configurado
  if (hostInput && !hostInput.value) {
    hostInput.value = window.__SERVER_IP || window.location.host || "localhost:3000";
  }

  function renderQrViewCards() {
    if (!grid) return;
    const protocol = window.location.protocol || "http:";
    const currentHost = hostInput ? hostInput.value.trim() : (window.__SERVER_IP || window.location.host || "localhost:3000");
    const filterQuery = filterInput ? filterInput.value.trim().toLowerCase() : "";

    const filteredIdfs = idfData.filter(idf => {
      if (!filterQuery) return true;
      return idf.name.toLowerCase().includes(filterQuery) ||
             idf.id.toLowerCase().includes(filterQuery) ||
             (idf.zone && idf.zone.toLowerCase().includes(filterQuery));
    });

    grid.replaceChildren();

    filteredIdfs.forEach(idf => {
      const directUrl = `${protocol}//${currentHost}/#reporte?idf=${idf.id}`;
      const card = document.createElement("article");
      card.className = "qr-card";

      const header = document.createElement("div");
      header.className = "qr-card-header";
      header.innerHTML = `
        <span class="qr-card-sys">S.G.R.S. · NOC</span>
        <h3 class="qr-card-title">${idf.name}</h3>
        <p class="qr-card-zone">${idf.zone || "—"}</p>
      `;

      const svgWrap = document.createElement("div");
      svgWrap.className = "qr-card-svg";
      if (window.QRCode && typeof window.QRCode.generateSvg === "function") {
        svgWrap.innerHTML = window.QRCode.generateSvg(directUrl, {
          size: 170,
          colorDark: "#000000",
          colorLight: "#ffffff",
          margin: 2
        });
      } else {
        svgWrap.textContent = directUrl;
      }

      const linkPreview = document.createElement("div");
      linkPreview.className = "qr-card-link";
      linkPreview.textContent = directUrl;

      const hint = document.createElement("span");
      hint.className = "qr-card-hint";
      hint.textContent = "Escanear para bitácora y Mini Split";

      const actions = document.createElement("div");
      actions.className = "qr-card-actions qr-no-print";

      const testBtn = document.createElement("button");
      testBtn.type = "button";
      testBtn.className = "secondary-button qr-card-test-btn";
      testBtn.textContent = "Abrir reporte directo";
      testBtn.addEventListener("click", () => openQuickReport(idf.id));

      const viewQrBtn = document.createElement("button");
      viewQrBtn.type = "button";
      viewQrBtn.className = "secondary-button";
      viewQrBtn.textContent = "Ver QR individual";
      viewQrBtn.style.cssText = "height:34px;font-size:12px;padding:0 14px";
      viewQrBtn.addEventListener("click", () => openSingleQrModal(idf.id));

      actions.append(testBtn, viewQrBtn);
      card.append(header, svgWrap, linkPreview, hint, actions);
      grid.appendChild(card);
    });

    if (filteredIdfs.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="padding:30px 20px;grid-column:1/-1"><span>⌕</span><strong>Sin resultados</strong><p>No se encontraron gabinetes con ese filtro.</p></div>';
    }
  }

  // Eventos
  if (hostInput) {
    hostInput.addEventListener("input", renderQrViewCards);
  }

  if (resetHostBtn) {
    resetHostBtn.addEventListener("click", () => {
      if (hostInput) {
        hostInput.value = window.__SERVER_IP || window.location.host || "localhost:3000";
      }
      renderQrViewCards();
      showToast(`Host detectado: ${hostInput?.value || "localhost:3000"}`);
    });
  }

  if (filterInput) {
    filterInput.addEventListener("input", renderQrViewCards);
  }

  if (printBtn) {
    printBtn.addEventListener("click", () => window.print());
  }

  renderQrViewCards();
}

function initDisponibilidadEvents() {
  const subnetTabs = document.querySelector("#ipamSubnetTabs");
  const searchInput = document.querySelector("#ipSearchInput");
  const clearBtn = document.querySelector("#ipClearSearchBtn");
  const statusFilters = document.querySelectorAll(".ipam-filter-btn");
  const tableSwitch = document.querySelector("#viewModeTableBtn");
  const gridSwitch = document.querySelector("#viewModeGridBtn");
  const quickAssignBtn = document.querySelector("#openQuickAssignBtn");
  const exportCsvBtn = document.querySelector("#exportIpamCsvBtn");
  const ipAddrInput = document.querySelector("#ipAddressInput");

  if (ipAddrInput) {
    ipAddrInput.addEventListener("input", (e) => {
      const typedIp = e.target.value.trim();
      const record = ipPoolData.find(i => i.ip === typedIp);
      if (record) {
        updateIpInputColor(e.target, record.status);
      } else {
        updateIpInputColor(e.target, "unknown");
      }
    });
  }

  if (subnetTabs) {
    subnetTabs.querySelectorAll(".ipam-subnet-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        subnetTabs.querySelectorAll(".ipam-subnet-pill").forEach(p => {
          p.classList.remove("active");
          p.setAttribute("aria-selected", "false");
        });
        pill.classList.add("active");
        pill.setAttribute("aria-selected", "true");
        currentIpamVlan = pill.dataset.vlan;
        renderIpAvailability();
      });
    });
  }

  statusFilters.forEach(btn => {
    btn.addEventListener("click", () => {
      statusFilters.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentIpamStatus = btn.dataset.status;
      renderIpAvailability();
    });
  });

  if (searchInput) {
    searchInput.value = currentIpamSearch;
    if (clearBtn) clearBtn.style.display = currentIpamSearch ? "block" : "none";

    searchInput.addEventListener("input", (e) => {
      currentIpamSearch = e.target.value.trim();
      if (clearBtn) clearBtn.style.display = currentIpamSearch ? "block" : "none";
      renderIpAvailability();
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      currentIpamSearch = "";
      clearBtn.style.display = "none";
      renderIpAvailability();
      searchInput.focus();
    });
  }

  if (tableSwitch && gridSwitch) {
    tableSwitch.addEventListener("click", () => {
      currentIpamViewMode = "table";
      tableSwitch.classList.add("active");
      gridSwitch.classList.remove("active");
      renderIpAvailability();
    });

    gridSwitch.addEventListener("click", () => {
      currentIpamViewMode = "grid";
      gridSwitch.classList.add("active");
      tableSwitch.classList.remove("active");
      renderIpAvailability();
    });
  }

  if (quickAssignBtn) {
    quickAssignBtn.addEventListener("click", () => {
      openAssignIpModal();
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      exportIpamCsv();
    });
  }

  renderIpAvailability();
}

// Carga inicial y asíncrona de datos desde el backend (o data/*.json)
async function loadInitialData() {
  try {
    const [idfsRes, ipsRes, devsRes, repRes, ipRes] = await Promise.allSettled([
      fetch('/api/idfs').then(r => r.ok ? r.json() : fetch('/data/idfs.json').then(r2 => r2.json())),
      fetch('/api/ips').then(r => r.ok ? r.json() : fetch('/data/ips.json').then(r2 => r2.json())),
      fetch('/api/devices').then(r => r.ok ? r.json() : fetch('/data/devices.json').then(r2 => r2.json())),
      fetch('/api/reports').then(r => r.ok ? r.json() : fetch('/data/reports.json').then(r2 => r2.json())),
      fetch('/api/ip').then(r => r.ok ? r.json() : { ip: window.location.host || 'localhost:3000' })
    ]);

    if (idfsRes.status === 'fulfilled' && Array.isArray(idfsRes.value)) {
      idfData = idfsRes.value;
    }
    if (ipsRes.status === 'fulfilled' && Array.isArray(ipsRes.value)) {
      ipPoolData = ipsRes.value;
    }
    if (devsRes.status === 'fulfilled' && Array.isArray(devsRes.value)) {
      devices = devsRes.value;
    }

    // Actualizar conteo de IPs libres en la barra lateral
    const initialIpNavBadge = document.querySelector("#ipAvailableNavCount");
    if (initialIpNavBadge && Array.isArray(ipPoolData) && ipPoolData.length > 0) {
      const freeCount = ipPoolData.filter(i => i.status === "available").length;
      initialIpNavBadge.textContent = `${freeCount} Libres`;
    }

    // Actualizar conteo de dispositivos activos en la barra lateral
    const devNavBadge = document.querySelector(".nav-item[data-view='dispositivos'] .nav-count");
    if (devNavBadge && Array.isArray(devices) && devices.length > 0) {
      const onlineCount = devices.filter(d => d.status === "online").length;
      devNavBadge.textContent = onlineCount || devices.length;
    }

    // IP de red detectada para generar los códigos QR
    if (ipRes.status === 'fulfilled' && ipRes.value && ipRes.value.ip) {
      const { ip } = ipRes.value;
      window.__SERVER_IP = ip;
      currentQrServerHost = ip;
      const qrHostInput = document.querySelector("#qrHostInput");
      const qrViewHostInput = document.querySelector("#qrViewHostInput");
      const idfQrHostInput = document.querySelector("#idfQrHostInput");
      if (qrHostInput) qrHostInput.value = ip;
      if (qrViewHostInput) qrViewHostInput.value = ip;
      if (idfQrHostInput) idfQrHostInput.value = ip;
    }

    // Historial de reportes e incidencias QR y telemetría
    if (repRes.status === 'fulfilled' && repRes.value) {
      const reportsDict = repRes.value;
      for (let idfId in reportsDict) {
        const idf = idfData.find(i => i.id === idfId);
        if (idf) {
          const srvData = reportsDict[idfId];
          if (!idf.incidents) idf.incidents = [];
          if (srvData.telemetry) {
            idf.lastMiniSplit = srvData.telemetry;
          }
          if (srvData.incidents && srvData.incidents.length > 0) {
            const existingIds = new Set(idf.incidents.map(i => i.id));
            for (let inc of [...srvData.incidents].reverse()) {
              if (!existingIds.has(inc.id)) {
                idf.incidents.unshift(inc);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Error al cargar datos desde el backend:", err);
  }
}

function initResumenEvents() {
  // 1. Sincronizar conteo de dispositivos con inventario de FortiGate
  const devConnectedVal = document.querySelector("#resumenDevConnectedVal");
  const devConnectedBar = document.querySelector("#resumenDevConnectedBar");
  if (Array.isArray(devices) && devices.length > 0) {
    const online = devices.filter(d => d.status === "online").length;
    const total = devices.length;
    if (devConnectedVal) devConnectedVal.innerHTML = `${online} <small>/ ${total}</small>`;
    if (devConnectedBar) devConnectedBar.style.width = `${((online / total) * 100).toFixed(1)}%`;
  }

  // 2. Monitoreo de salud en vivo de las APIs (FortiGate y OmniVista)
  fetch("/api/health")
    .then(r => r.json())
    .then(data => {
      const fortiBadge = document.querySelector("#badgeFortiStatus");
      const omniBadge = document.querySelector("#badgeOmniStatus");
      const fwStatus = document.querySelector("#routeFwStatus");

      if (fortiBadge) {
        if (data.forti) {
          fortiBadge.className = "status-pill online";
          fortiBadge.innerHTML = "<i></i>FortiGate: 8001 En línea";
          if (fwStatus) fwStatus.textContent = "En línea";
        } else {
          fortiBadge.className = "status-pill offline";
          fortiBadge.innerHTML = "<i></i>FortiGate: 8001 Desconectado";
          if (fwStatus) fwStatus.textContent = "Alerta";
        }
      }

      if (omniBadge) {
        if (data.omni) {
          omniBadge.className = "status-pill online";
          omniBadge.innerHTML = "<i></i>OmniVista: 8000 En línea";
        } else {
          omniBadge.className = "status-pill offline";
          omniBadge.innerHTML = "<i></i>OmniVista: 8000 Desconectado";
        }
      }
    })
    .catch(() => {});
}

async function initApp() {
  // 1. Cargar catálogo completo del backend primero para tener los 13 IDFs y dispositivos en memoria
  await loadInitialData();

  // 2. Inicializar eventos globales de modales
  initDeviceDetailModalEvents();

  // 3. Iniciar enrutador con los datos del backend listos
  handleHashRouting();

  // 4. Inicializar tarjetas de códigos QR si la función existe
  if (typeof renderQrStationCards === "function") {
    renderQrStationCards();
  }
}

initApp();
