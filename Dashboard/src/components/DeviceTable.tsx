import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  ArrowUpDown,
  Laptop,
  Smartphone,
  Server,
  Network,
  Radio,
  Download,
  Info,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { UnifiedDevice } from '../types';

interface DeviceTableProps {
  devices: UnifiedDevice[];
  isLoading: boolean;
  onSelectDevice: (device: UnifiedDevice) => void;
}

export const DeviceTable: React.FC<DeviceTableProps> = ({
  devices,
  isLoading,
  onSelectDevice,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'offline' | 'infrastructure'>('all');
  const [sortKey, setSortKey] = useState<keyof UnifiedDevice>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Filtrado y ordenamiento en memoria reactivo
  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();

    return devices
      .filter(dev => {
        if (filter === 'online') return dev.status === 'online';
        if (filter === 'offline') return dev.status === 'offline';
        if (filter === 'infrastructure') return dev.type.includes('Switch') || dev.type.includes('Access Point');
        return true;
      })
      .filter(dev => {
        if (!q) return true;
        return (
          dev.name.toLowerCase().includes(q) ||
          dev.ip.toLowerCase().includes(q) ||
          dev.mac.toLowerCase().includes(q) ||
          dev.vendor.toLowerCase().includes(q) ||
          dev.location.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const valA = String(a[sortKey] ?? '').toLowerCase();
        const valB = String(b[sortKey] ?? '').toLowerCase();
        return valA.localeCompare(valB) * (sortAsc ? 1 : -1);
      });
  }, [devices, search, filter, sortKey, sortAsc]);

  // Paginación
  const totalPages = Math.max(1, Math.ceil(filteredDevices.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedDevices = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredDevices.slice(start, start + pageSize);
  }, [filteredDevices, currentPage, pageSize]);

  const handleSort = (key: keyof UnifiedDevice) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const getDeviceIcon = (type: string, vendor: string) => {
    const t = (type + ' ' + vendor).toLowerCase();
    if (t.includes('switch')) return <Network className="w-3.5 h-3.5 text-[#34d5e7]" />;
    if (t.includes('point') || t.includes('ap')) return <Radio className="w-3.5 h-3.5 text-[#54d39a]" />;
    if (t.includes('phone') || t.includes('apple') || t.includes('android')) return <Smartphone className="w-3.5 h-3.5 text-[#f0b35a]" />;
    if (t.includes('server')) return <Server className="w-3.5 h-3.5 text-[#ef6b62]" />;
    return <Laptop className="w-3.5 h-3.5 text-[#829aaa]" />;
  };

  const exportCSV = () => {
    const headers = ['Nombre', 'Dirección IP', 'Dirección MAC', 'Fabricante', 'Tipo', 'Ubicación', 'Estado', 'Origen'];
    const rows = filteredDevices.map(d => [
      `"${d.name}"`,
      `"${d.ip}"`,
      `"${d.mac}"`,
      `"${d.vendor}"`,
      `"${d.type}"`,
      `"${d.location}"`,
      `"${d.status}"`,
      `"${d.source}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `inventario_sgrs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] space-y-4">
      {/* Header with Title and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">INVENTARIO ACTIVO</p>
          <h2 className="text-base font-bold text-[#edf7fb]">Dispositivos en la red</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#122432] border border-[#203746] text-xs font-medium text-[#829aaa] hover:text-[#edf7fb] hover:border-[#34d5e7]/40 transition-colors"
            title="Exportar inventario filtrado a CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* Toolbar: Search and Filter Tabs */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#829aaa]" />
          <input
            type="search"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre, IP, MAC o fabricante…"
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-[#09141e] border border-[#203746] text-xs text-[#edf7fb] placeholder-[#829aaa]/60 focus:outline-none focus:border-[#34d5e7] transition-colors"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setPage(1);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#829aaa] hover:text-[#edf7fb]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter buttons */}
        <div className="inline-flex rounded-lg bg-[#09141e] p-1 border border-[#203746] text-xs">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'online', label: 'En línea' },
            { id: 'offline', label: 'Fuera de línea' },
            { id: 'infrastructure', label: 'Switches / APs' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setFilter(tab.id as typeof filter);
                setPage(1);
              }}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                filter === tab.id
                  ? 'bg-[#122432] text-[#34d5e7] border border-[#203746] shadow-xs'
                  : 'text-[#829aaa] hover:text-[#edf7fb]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-lg border border-[#172b38] bg-[#071018]/50">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#09141e] text-[#829aaa] font-semibold border-b border-[#172b38] uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-3 px-4">
                <button onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-[#edf7fb]">
                  Dispositivo <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-3 px-4">
                <button onClick={() => handleSort('ip')} className="flex items-center gap-1 hover:text-[#edf7fb]">
                  Dirección IP <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-3 px-4">Dirección MAC</th>
              <th className="py-3 px-4">Fabricante / Tipo</th>
              <th className="py-3 px-4">Ubicación / Interfaz</th>
              <th className="py-3 px-4">
                <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-[#edf7fb]">
                  Estado <ArrowUpDown className="w-3 h-3" />
                </button>
              </th>
              <th className="py-3 px-4 text-right">Detalle</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#172b38] font-medium">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[#829aaa]">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-[#34d5e7] border-t-transparent animate-spin" />
                    <span>Cargando inventario en vivo...</span>
                  </div>
                </td>
              </tr>
            ) : paginatedDevices.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-[#829aaa]">
                  No se encontraron dispositivos coincidentes con los filtros actuales.
                </td>
              </tr>
            ) : (
              paginatedDevices.map(dev => (
                <tr
                  key={dev.id}
                  onClick={() => onSelectDevice(dev)}
                  className="hover:bg-[#122432]/60 cursor-pointer transition-colors group"
                >
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded bg-[#122432] border border-[#203746] flex items-center justify-center">
                        {getDeviceIcon(dev.type, dev.vendor)}
                      </div>
                      <span className="font-bold text-[#edf7fb] group-hover:text-[#34d5e7] transition-colors">
                        {dev.name}
                      </span>
                    </div>
                  </td>

                  <td className="py-2.5 px-4 font-mono text-[#34d5e7]">{dev.ip || '—'}</td>
                  <td className="py-2.5 px-4 font-mono text-[#829aaa] text-[11px]">{dev.mac}</td>
                  <td className="py-2.5 px-4 text-[#edf7fb] truncate max-w-[140px]" title={dev.vendor}>
                    {dev.vendor || dev.type}
                  </td>
                  <td className="py-2.5 px-4 text-[#829aaa] truncate max-w-[120px]">{dev.location}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        dev.status === 'online'
                          ? 'bg-[#54d39a]/10 text-[#54d39a] border-[#54d39a]/30'
                          : 'bg-[#829aaa]/10 text-[#829aaa] border-[#829aaa]/30'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          dev.status === 'online' ? 'bg-[#54d39a]' : 'bg-[#829aaa]'
                        }`}
                      />
                      {dev.status === 'online' ? 'En línea' : 'Desconectado'}
                    </span>
                  </td>

                  <td className="py-2.5 px-4 text-right">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onSelectDevice(dev);
                      }}
                      className="p-1 hover:text-[#34d5e7] text-[#829aaa] transition-colors"
                      title="Ver telemetría completa"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer and Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#829aaa] pt-1">
        <span>
          Mostrando {paginatedDevices.length} de {filteredDevices.length.toLocaleString('es-MX')} dispositivos
          {devices.length > filteredDevices.length && ` (filtrados de ${devices.length.toLocaleString('es-MX')} totales)`}
        </span>

        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded bg-[#122432] border border-[#203746] disabled:opacity-40 hover:text-[#edf7fb]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono">
              Página {currentPage} de {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded bg-[#122432] border border-[#203746] disabled:opacity-40 hover:text-[#edf7fb]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
