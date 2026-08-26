const devices = [
  { name: "CORE-SW-01", ip: "10.20.0.1", type: "Switch L3", icon: "⌘", location: "Site principal · MDF", status: "online", activity: "Ahora" },
  { name: "AP-SALA-JUNTAS", ip: "10.20.2.48", type: "Access Point", icon: "⌁", location: "Corporativo · Piso 2", status: "online", activity: "Hace 1 min" },
  { name: "SRV-ARCHIVOS-02", ip: "10.20.1.22", type: "Servidor", icon: "▤", location: "Centro de datos · Rack B", status: "online", activity: "Hace 2 min" },
  { name: "CAM-EST-07", ip: "10.20.8.107", type: "Cámara IP", icon: "◉", location: "Estacionamiento norte", status: "offline", activity: "Hace 38 min" },
  { name: "IMP-VENTAS-04", ip: "10.20.4.86", type: "Impresora", icon: "▣", location: "Corporativo · Piso 1", status: "online", activity: "Hace 4 min" },
  { name: "FW-BORDE-01", ip: "10.20.0.254", type: "Firewall", icon: "◇", location: "Site principal · MDF", status: "online", activity: "Ahora" },
  { name: "SW-PISO-03", ip: "10.20.3.2", type: "Switch L2", icon: "⌘", location: "Corporativo · Piso 3", status: "offline", activity: "Hace 12 min" }
];

const rows = document.querySelector("#deviceRows");
const search = document.querySelector("#deviceSearch");
const clearSearch = document.querySelector("#clearSearch");
const emptyState = document.querySelector("#emptyState");
const resultCount = document.querySelector("#resultCount");
let activeFilter = "all";
let sortKey = "name";
let sortAscending = true;

function renderDevices() {
  const query = search.value.trim().toLocaleLowerCase("es-MX");
  const visible = devices
    .filter(device => activeFilter === "all" || device.status === activeFilter)
    .filter(device => [device.name, device.ip, device.type, device.location].some(value => value.toLocaleLowerCase("es-MX").includes(query)))
    .sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey]), "es-MX") * (sortAscending ? 1 : -1));

  const fragment = document.createDocumentFragment();
  visible.forEach(device => {
    const row = document.createElement("tr");
    const deviceCell = document.createElement("td");
    const deviceName = document.createElement("span");
    const deviceIcon = document.createElement("i");
    deviceName.className = "device-name"; deviceIcon.className = "device-type-icon";
    deviceIcon.setAttribute("aria-hidden", "true"); deviceIcon.textContent = device.icon;
    deviceName.append(deviceIcon, document.createTextNode(device.name)); deviceCell.append(deviceName);

    const ipCell = document.createElement("td");
    const ip = document.createElement("span"); ip.className = "ip"; ip.textContent = device.ip; ipCell.append(ip);
    const typeCell = document.createElement("td"); typeCell.textContent = device.type;
    const locationCell = document.createElement("td"); locationCell.textContent = device.location;
    const statusCell = document.createElement("td");
    const status = document.createElement("span"); status.className = `status-pill ${device.status}`;
    status.append(document.createElement("i"), document.createTextNode(device.status === "online" ? "En línea" : "Fuera de línea")); statusCell.append(status);
    const activityCell = document.createElement("td"); activityCell.textContent = device.activity;
    row.append(deviceCell, ipCell, typeCell, locationCell, statusCell, activityCell); fragment.append(row);
  });
  rows.replaceChildren(fragment);
  emptyState.hidden = visible.length > 0;
  resultCount.textContent = visible.length ? `Mostrando ${visible.length} de 248 dispositivos` : "No se encontraron dispositivos";
  clearSearch.classList.toggle("visible", Boolean(search.value));
}

search.addEventListener("input", renderDevices);
clearSearch.addEventListener("click", () => { search.value = ""; renderDevices(); search.focus(); });
document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach(item => { item.classList.toggle("selected", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  renderDevices();
}));
document.querySelectorAll("[data-sort]").forEach(button => button.addEventListener("click", () => {
  if (sortKey === button.dataset.sort) sortAscending = !sortAscending; else { sortKey = button.dataset.sort; sortAscending = true; }
  document.querySelectorAll("th").forEach(th => th.removeAttribute("aria-sort"));
  button.closest("th").setAttribute("aria-sort", sortAscending ? "ascending" : "descending");
  renderDevices();
}));

const sidebar = document.querySelector("#sidebar");
const backdrop = document.querySelector("#drawerBackdrop");
const menuButton = document.querySelector("#menuButton");
function closeMenu() { sidebar.classList.remove("open"); backdrop.hidden = true; menuButton.setAttribute("aria-expanded", "false"); }
menuButton.addEventListener("click", () => { const open = sidebar.classList.toggle("open"); backdrop.hidden = !open; menuButton.setAttribute("aria-expanded", String(open)); });
backdrop.addEventListener("click", closeMenu);
document.querySelectorAll(".nav-item").forEach(link => link.addEventListener("click", () => {
  document.querySelectorAll(".nav-item").forEach(item => { item.classList.remove("active"); item.removeAttribute("aria-current"); });
  link.classList.add("active"); link.setAttribute("aria-current", "page"); closeMenu();
}));

const dialog = document.querySelector("#movementDialog");
const movementButton = document.querySelector("#movementButton");
function closeDialog() { dialog.close(); movementButton.focus(); }
movementButton.addEventListener("click", () => dialog.showModal());
document.querySelector("#closeDialog").addEventListener("click", closeDialog);
document.querySelector("#cancelDialog").addEventListener("click", closeDialog);
document.querySelectorAll("[data-movement]").forEach(button => button.addEventListener("click", () => {
  closeDialog(); showToast(`Flujo de ${button.dataset.movement} listo para conectar`);
}));

function showToast(message) {
  const toast = document.createElement("div"); toast.className = "toast";
  const indicator = document.createElement("i"); const copy = document.createElement("span"); copy.textContent = message;
  toast.append(indicator, copy);
  document.querySelector("#toastRegion").replaceChildren(toast);
  window.setTimeout(() => toast.remove(), 3600);
}
document.querySelector("#refreshButton").addEventListener("click", event => {
  event.currentTarget.setAttribute("aria-busy", "true"); event.currentTarget.disabled = true;
  window.setTimeout(() => { event.currentTarget.removeAttribute("aria-busy"); event.currentTarget.disabled = false; showToast("Datos actualizados hace un momento"); }, 650);
});
document.querySelector("#userButton").addEventListener("click", () => showToast("La administración de perfil se incorporará en el módulo de configuración"));
document.querySelector("#activityOptions").addEventListener("click", () => showToast("Filtros de bitácora listos para la siguiente integración"));
document.addEventListener("keydown", event => { if (event.key === "Escape" && sidebar.classList.contains("open")) closeMenu(); });
renderDevices();
