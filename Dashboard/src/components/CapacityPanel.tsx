import React from 'react';
import type { SubnetCapacity } from '../types';

interface CapacityPanelProps {
  totalLeases: number;
}

export const CapacityPanel: React.FC<CapacityPanelProps> = ({ totalLeases }) => {
  // Distribución proporcional estimada basada en concesiones activas
  const segments: SubnetCapacity[] = [
    {
      name: 'Corporativo (VLAN 10)',
      used: Math.round(totalLeases * 0.45),
      total: 512,
      colorClass: 'bg-[#34d5e7]',
    },
    {
      name: 'Operaciones (VLAN 20)',
      used: Math.round(totalLeases * 0.30),
      total: 512,
      colorClass: 'bg-[#54d39a]',
    },
    {
      name: 'Invitados (VLAN 30)',
      used: Math.round(totalLeases * 0.15),
      total: 512,
      colorClass: 'bg-[#f0b35a]',
    },
    {
      name: 'Infraestructura (VLAN 99)',
      used: Math.round(totalLeases * 0.10),
      total: 512,
      colorClass: 'bg-[#ef6b62]',
    },
  ];

  return (
    <section className="p-5 rounded-xl bg-[#0e1c28] border border-[#172b38] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-[#829aaa]">CAPACIDAD IPv4</p>
          <h3 className="text-sm font-bold text-[#edf7fb]">Uso por segmento</h3>
        </div>
        <span className="font-mono text-xs text-[#34d5e7] font-semibold">2,048 total</span>
      </div>

      <div className="space-y-3">
        {segments.map(seg => {
          const pct = Math.min(100, Math.round((seg.used / seg.total) * 100));
          return (
            <div key={seg.name} className="space-y-1 text-xs">
              <div className="flex justify-between items-center text-[11px]">
                <span className="font-medium text-[#edf7fb]">{seg.name}</span>
                <span className="font-mono text-[#829aaa]">
                  {seg.used} / {seg.total} ({pct}%)
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#122432] rounded-full overflow-hidden">
                <div
                  className={`h-full ${seg.colorClass} rounded-full transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
