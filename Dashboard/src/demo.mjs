// Explicit, isolated design fixtures. Never used as an automatic fallback for an API failure.
export function createDemo() {
  const segments = [
    { id: 10, name: 'Quetzalcóatl', assigned: 142, connected: 118, average: 125, description: 'Segmento ejecutivo y administrativo · Recursos institucionales' },
    { id: 20, name: 'Tonatiuh', assigned: 218, connected: 197, average: 204, description: 'Segmento clínico y médico · Sistemas de salud y expedientes' },
    { id: 30, name: 'Ehécatl', assigned: 89, connected: 72, average: 78, description: 'Segmento operativo general · Recursos compartidos' },
  ].map(s => ({ ...s, interface: s.name, vlan: `VLAN ${s.id}`, subnet: `192.168.${s.id}.0/24`, default_gateway: `192.168.${s.id}.1`, netmask: '255.255.255.0', capacity: 254, active_leases: s.assigned, available_ips: 254 - s.assigned, utilization_percent: Math.round(s.assigned / 254 * 100), status: 'normal' }));
  const resourceSpecs = [
    ['Cables Cat6', 'Cable de red categoría 6', 'Cableado estructurado', 30, 15, 'available'],
    ['Access Points', 'Unidades de repuesto', 'Red inalámbrica', 5, 3, 'low'],
    ['Patch Panels', 'Paneles de 24 puertos', 'Cableado estructurado', 2, 1, 'critical'],
    ['Switches', 'Switches de acceso', 'Equipos de red', 2, 1, 'critical'],
    ['Conectores RJ45', 'Jacks y conectores', 'Accesorios', 120, 60, 'available'],
    ['Organizadores', 'Organización de cableado', 'Accesorios', 15, 8, 'low'],
  ];
  const resources = resourceSpecs.map((r, i) => ({ id: `resource-${i}`, name: r[0], description: r[1], category: r[2], quantity: r[3], available: r[4], status: r[5], idf: 'IDF-03', idfId: 'idf-3', zone: 'Segundo piso', modified: '2026-09-06T16:24:00Z', actor: 'María Torres' }));
  const people = [
    ['Dr. Carlos Mendoza', 'cmendoza', 'Médico internista', 'Hospitalización · Piso 3', 'Laptop', 'Dell', 'Quetzalcóatl', 'approved'],
    ['Lic. Ana Ramírez', 'aramirez', 'Enfermera', 'Urgencias', 'Celular', 'Samsung', 'Tonatiuh', 'pending'],
    ['Ing. Pedro Sánchez', 'psanchez', 'Técnico de mantenimiento', 'Mantenimiento', 'Tablet', 'Apple', 'Ehécatl', 'approved'],
    ['Dra. Laura Jiménez', 'ljimenez', 'Directora de área', 'Administración', 'Laptop', 'HP', 'Quetzalcóatl', 'review'],
    ['Luis González', 'lgonzalez', 'Personal de limpieza', 'Servicios generales', 'Celular', 'Xiaomi', 'Ehécatl', 'rejected'],
  ];
  const requests = people.map((p, i) => ({ id: `R-Info-AERW-2026-${357 - i}`, name: p[0], username: p[1], position: p[2], area: p[3], device: p[4], brand: p[5], network: p[6], status: p[7], actor: i % 2 ? 'Roberto Cruz' : 'María Torres', date: `2026-09-0${6 - Math.floor(i / 2)}T16:24:00Z` }));
  const ips = Array.from({ length: 48 }, (_, i) => ({ id: `ip-${i}`, ip: `192.168.${[10, 20, 30][Math.floor(i / 16)]}.${25 + i % 16}`, vlan: `VLAN ${[10, 20, 30][Math.floor(i / 16)]}`, location: ['MDF · Centro de datos', 'IDF-01 · Planta baja', 'Urgencias · Primer piso', 'Hospitalización · Segundo piso'][i % 4], type: ['Equipo de red', 'Administrativo', 'Usuario final', 'Impresoras'][i % 4], status: i < 40 ? 'available' : 'occupied', hostname: i < 40 ? '—' : `Equipo-${i}`, notes: '' }));
  const idfs = Array.from({ length: 13 }, (_, i) => ({ id: `idf-${i + 1}`, name: i === 12 ? 'Servidores PACS' : `IDF-${String(i + 1).padStart(2, '0')}`, zone: ['Planta baja', 'Primer piso', 'Segundo piso'][i % 3], rack: 'Rack de telecomunicaciones', devices: [], incidents: [] }));
  const reports = { 'idf-3': { incidents: [{ id: 'IDF-2026-001', title: 'Inspección de gabinete', description: 'Revisión de enlaces y climatización.', tech: 'María Torres', date: '2026-09-06T16:24:00Z', temp: 22, severity: 'low', status: 'resolved', device: 'Gabinete' }], telemetry: { temp: 22, date: '2026-09-06T16:24:00Z', status: 'normal' } } };
  const devices = people.map((p, i) => ({
    id: `device-${i}`,
    name: `${p[4]}-${p[1]}`,
    ip: `192.168.${[10, 20, 30][i % 3]}.${100 + i}`,
    type: p[4],
    vendor: p[5],
    location: `IDF-0${(i % 5) + 1} -> 1/1/${20 + i}`,
    status: 'online',
    mac: `00:1A:2B:3C:4D:0${i}`,
    interface: p[6],
    activity: 'Ahora',
    omnivista: {
      matched: true,
      mac: `001A2B3C4D0${i}`,
      device_name: `${p[1]} - ${p[4].toLowerCase()}`,
      account: p[1],
      location: `IDF-0${(i % 5) + 1} -> 1/1/${20 + i}`,
      ap_name: `AP-${p[6]}`,
      ssid: p[6],
      profile: `__SSID-${p[6]}`,
      category: p[4] === 'Laptop' ? 'Computer' : 'Mobile',
      family: p[5],
      os: p[4] === 'Laptop' ? 'Windows 11' : 'Android',
      status: 'Online'
    }
  }));
  return { segments, resources, requests, ips, idfs, reports, devices, health: { forti: true, omni: true }, updatedAt: '2026-09-06T16:24:00Z' };
}
