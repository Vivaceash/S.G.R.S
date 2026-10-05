// Explicit, isolated design fixtures. Never used as an automatic fallback for an API failure.
export function createDemo() {
  const segments = [
    { id: 10, name: 'Quetzalcóatl', assigned: 142, connected: 118, average: 125, description: 'Segmento ejecutivo y administrativo · Recursos institucionales' },
    { id: 20, name: 'Tonatiuh', assigned: 218, connected: 197, average: 204, description: 'Segmento clínico y médico · Sistemas de salud y expedientes' },
    { id: 30, name: 'Ehécatl', assigned: 89, connected: 72, average: 78, description: 'Segmento operativo general · Recursos compartidos' },
  ].map(s => {
    const pct = Math.round(s.assigned / 254 * 100);
    const satStatus = pct >= 80 ? 'critical' : pct >= 50 ? 'warning' : 'normal';
    return {
      ...s,
      interface: s.name,
      vlan: `VLAN ${s.id}`,
      subnet: `192.168.${s.id}.0/24`,
      default_gateway: `192.168.${s.id}.1`,
      netmask: '255.255.255.0',
      capacity: 254,
      active_leases: s.assigned,
      available_ips: 254 - s.assigned,
      utilization_percent: pct,
      saturation_status: satStatus,
      status: 'normal',
    };
  });
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
  const idfs = Array.from({ length: 13 }, (_, i) => ({ id: `idf-${i + 1}`, name: i === 12 ? 'Servidores PACS' : `IDF-${String(i + 1).padStart(2, '0')}`, zone: ['Planta baja', 'Primer piso', 'Segundo piso'][i % 3], rack: 'Rack de telecomunicaciones', devices: [], incidents: [], mobile_token: `demo-token-${i + 1}` }));
  const reports = { 'idf-3': { incidents: [{ id: 'IDF-2026-001', title: 'Inspección de gabinete', description: 'Revisión de enlaces y climatización.', tech: 'María Torres', date: '2026-09-06T16:24:00Z', temp: 22, severity: 'low', status: 'resolved', device: 'Gabinete' }], telemetry: { temp: 22, date: '2026-09-06T16:24:00Z', status: 'normal' } } };
  const nowUnix = Math.floor(Date.now() / 1000);
  const sampleUptimes = [19380, 310500, 7200, 86400 * 4 + 14400, 2700, 48000, 180000];
  const sampleSerials = ['8HG7Y23', 'SN-SAMS-9921', 'A2482LL/A', '5CD91244PQ', 'XM-REDMI-8812'];
  const sampleUsers = ['carlos.mendozaal', 'ana.ramirezal', 'pedro.sanchezal', 'laura.jimenezal', 'luis.gonzalezal'];
  const sampleHostnames = ['PC-MED-PISO3', 'CEL-ENF-URG', 'TAB-TEC-MANT', 'LAPTOP-DIR-ADM', 'CEL-SERV-GRAL'];

  const devices = people.map((p, i) => {
    const uptime = sampleUptimes[i % sampleUptimes.length];
    return {
      id: `device-${i}`,
      name: `${p[4]}-${p[1]}`,
      hostname: sampleHostnames[i],
      detected_device: `${p[5]} ${p[4] === 'Laptop' ? 'Latitude 5420' : p[4]}`,
      serial: sampleSerials[i],
      user: sampleUsers[i],
      os: p[4] === 'Laptop' ? 'Windows 11' : (p[4] === 'Tablet' ? 'iPadOS' : 'Android 14'),
      ip: `192.168.${[10, 20, 30][i % 3]}.${100 + i}`,
      type: p[4] === 'Laptop' ? 'Computadora' : p[4],
      vendor: p[5],
      location: `IDF-0${(i % 5) + 1} -> 1/1/${20 + i}`,
      status: 'online',
      mac: `00:1A:2B:3C:4D:0${i}`,
      interface: p[6],
      fortigate: 'FGT-NOC-TORRE-A',
      activity: 'Ahora',
      uptime_seconds: uptime,
      first_connected_at: nowUnix - uptime,
      total_connected_seconds: uptime * 2 + 7200,
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
        status: 'Online',
      },
    };
  });

  const demoPrinters = [
    {
      id: 'device-prn-1',
      name: 'IMP-HOSP-PISO3',
      hostname: 'IMP-HOSP-PISO3',
      detected_device: 'HP LaserJet Enterprise M608',
      serial: 'CNB1N99281',
      user: 'servicio.soporte',
      os: 'HP FutureSmart Firmware',
      ip: '192.168.20.50',
      type: 'Impresora',
      vendor: 'HP',
      model: 'LaserJet Enterprise M608',
      location: 'IDF-02 -> 1/1/12 (Piso 3)',
      status: 'online',
      mac: '00:1E:0B:44:55:66',
      interface: 'Tonatiuh',
      fortigate: 'FGT-NOC-TORRE-A',
      activity: 'Ahora',
      uptime_seconds: 310500,
      first_connected_at: nowUnix - 310500,
      total_connected_seconds: 620000,
      omnivista: {
        matched: true,
        mac: '001E0B445566',
        device_name: 'IMP-HOSP-PISO3',
        account: 'soporte.impresion',
        location: 'IDF-02 -> 1/1/12',
        ap_name: 'AP-Tonatiuh',
        ssid: 'Tonatiuh',
        profile: '__SSID-Tonatiuh',
        category: 'Printer',
        family: 'HP',
        os: 'Printer Firmware',
        status: 'Online',
      },
    },
    {
      id: 'device-prn-2',
      name: 'IMP-ADMIN-PISO1',
      hostname: 'IMP-ADMIN-PISO1',
      detected_device: 'Kyocera ECOSYS M3655idn',
      serial: 'KM-ECOSYS-38291',
      user: 'ricardo.martinezal',
      os: 'KPDL3 / NetManager',
      ip: '192.168.10.45',
      type: 'Impresora',
      vendor: 'Kyocera',
      model: 'ECOSYS M3655idn',
      location: 'IDF-01 -> 1/1/8 (Piso 1)',
      status: 'online',
      mac: '00:17:C8:11:22:33',
      interface: 'Quetzalcóatl',
      fortigate: 'FGT-NOC-TORRE-A',
      activity: 'Ahora',
      uptime_seconds: 19380,
      first_connected_at: nowUnix - 19380,
      total_connected_seconds: 48000,
      omnivista: {
        matched: true,
        mac: '0017C8112233',
        device_name: 'IMP-ADMIN-PISO1',
        account: 'ricardo.martinezal',
        location: 'IDF-01 -> 1/1/8',
        ap_name: 'AP-Quetzalcóatl',
        ssid: 'Quetzalcóatl',
        profile: '__SSID-Quetzalcóatl',
        category: 'Printer',
        family: 'Kyocera',
        os: 'Printer Firmware',
        status: 'Online',
      },
    },
  ];

  const allDevices = [...devices, ...demoPrinters];
  const demoAps = [
    { id: 'ap-1', name: 'AP-1F:20', model: 'OAW-AP1321', ip: '192.168.5.27', mac: 'dc:08:56:d3:1f:20', serial: 'SSZ234101685', status: 'online', status_raw: 'Up', location: 'IDF-12 -> 2/1/6', idf_tag: 'IDF-12', clients: 8, channels: ['6(2.4G)', '48(5G All)'], ssids: ['Admin(2.4G)', 'Admin(5G)', 'Quetzalcoatl(2.4G)', 'Tonatiuh(5G)'], version: '4.0.7.7081', last_seen: 1790078751404 },
    { id: 'ap-2', name: 'Pasillo Central', model: 'OAW-AP1321', ip: '192.168.5.60', mac: 'dc:08:56:d3:16:80', serial: 'SSZ234101616', status: 'online', status_raw: 'Up', location: 'IDF-11 -> 1/1/48', idf_tag: 'IDF-11', clients: 14, channels: ['1(2.4G)', '149(5G All)'], ssids: ['Admin(2.4G)', 'Admin(5G)', 'Quetzalcoatl(5G)', 'Tonatiuh(5G)'], version: '4.0.7.7081', last_seen: 1790078751268 },
    { id: 'ap-3', name: 'AP-21:20', model: 'OAW-AP1321', ip: '192.168.5.113', mac: 'dc:08:56:d3:21:20', serial: 'SSZ234101701', status: 'online', status_raw: 'Up', location: 'IDF-4 -> 4/1/35', idf_tag: 'IDF-4', clients: 5, channels: ['1(2.4G)', '153(5G All)'], ssids: ['Admin(2.4G)', 'Tonatiuh(5G)'], version: '4.0.7.7081', last_seen: 1790078751681 },
    { id: 'ap-4', name: 'AP-Urgencias-01', model: 'OAW-AP1321', ip: '192.168.5.115', mac: 'dc:08:56:d3:21:40', serial: 'SSZ234101705', status: 'online', status_raw: 'Up', location: 'IDF-1 -> 1/1/24', idf_tag: 'IDF-1', clients: 22, channels: ['11(2.4G)', '36(5G All)'], ssids: ['Admin(2.4G)', 'Quetzalcoatl(2.4G)', 'Tonatiuh(5G)'], version: '4.0.7.7081', last_seen: 1790078750000 },
    { id: 'ap-5', name: 'AP-Consulta-Externa', model: 'OAW-AP1311', ip: '192.168.5.120', mac: 'dc:08:56:d3:22:10', serial: 'SSZ234101750', status: 'online', status_raw: 'Up', location: 'IDF-2 -> 2/1/10', idf_tag: 'IDF-2', clients: 19, channels: ['6(2.4G)', '157(5G All)'], ssids: ['Admin(2.4G)', 'Tonatiuh(5G)'], version: '4.0.7.7081', last_seen: 1790078740000 },
    { id: 'ap-6', name: 'AP-Terapia-Intensiva', model: 'OAW-AP1321', ip: '192.168.5.132', mac: 'dc:08:56:d3:23:05', serial: 'SSZ234101802', status: 'offline', status_raw: 'Down', location: 'IDF-3 -> 1/1/15', idf_tag: 'IDF-3', clients: 0, channels: [], ssids: [], version: '4.0.7.7081', last_seen: 1790078000000 },
  ];
  return { segments, resources, requests, ips, idfs, reports, devices: allDevices, aps: demoAps, health: { forti: true, omni: true }, updatedAt: '2026-09-06T16:24:00Z' };
}
