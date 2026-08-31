import React from 'react';
import { ArrowUpRight, ArrowDownRight, AlertTriangle, RefreshCw } from 'lucide-react';
import type { OmniNotification } from '../types';

interface ActivityFeedProps {
  notifications: OmniNotification[];
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ notifications = [] }) => {
  const notifList = Array.isArray(notifications) ? notifications : [];
  // Eventos mapeados de OmniVista o eventos simulados si la lista está vacía
  const events = notifList.length > 0
    ? notifList.slice(0, 5).map((notif, idx) => ({
        id: String(notif.id || idx),
        title: notif.message?.slice(0, 32) || 'Evento de red',
        desc: notif.message || 'Sin detalle de evento',
        time: notif.timestamp || 'Reciente',
        type: notif.severity?.toLowerCase() === 'high' ? 'warn' : 'info',
        source: notif.source || 'OmniVista',
      }))
    : [
        {
          id: '1',
          title: 'Sincronización de Firewall',
          desc: 'Sesión activa con FortiOS v7.4.5.',
          time: 'En vivo',
          type: 'info',
          source: 'FortiGate REST',
        },
        {
          id: '2',
          title: 'Monitoreo de NMS',
          desc: 'OmniVista 2500 enlazado.',
          time: 'En vivo',
          type: 'info',
          source: 'OmniVista API',
        },
        {
          id: '3',
          title: 'Asignación DHCP',
          desc: 'Rango dinámico operativo en VLAN de usuarios.',
          time: 'Hace 5 min',
          type: 'up',
          source: 'DHCP Daemon',
        },
      ];

  const getIcon = (type: string) => {
    switch (type) {
      case 'up':
        return <ArrowUpRight className="w-3.5 h-3.5 text-[#54d39a]" />;
      case 'down':
        return <ArrowDownRight className="w-3.5 h-3.5 text-[#ef6b62]" />;
      case 'warn':
        return <AlertTriangle className="w-3.5 h-3.5 text-[#f0b35a]" />;
      default:
        return <RefreshCw className="w-3.5 h-3.5 text-[#34d5e7]" />;
    }
  };

  return (
    <section className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">BITÁCORA DE RED</p>
          <h3 className="text-sm font-bold text-[#edf7fb]">Actividad reciente</h3>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-[#122432] text-[#34d5e7] border border-[#203746]">
          En vivo
        </span>
      </div>

      <div className="divide-y divide-[#172b38]/60 text-xs">
        {events.map(ev => (
          <div key={ev.id} className="py-2.5 flex items-start gap-3">
            <div className="w-6 h-6 rounded-md bg-[#122432] border border-[#203746] flex items-center justify-center shrink-0 mt-0.5">
              {getIcon(ev.type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[#edf7fb] truncate">{ev.title}</p>
              <p className="text-[#829aaa] text-[11px] truncate">{ev.desc}</p>
              <p className="text-[10px] text-[#829aaa]/70 font-mono mt-0.5">
                {ev.time} · {ev.source}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
