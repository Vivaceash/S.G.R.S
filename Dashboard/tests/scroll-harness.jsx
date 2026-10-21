import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable, InfiniteMore, useListState } from '../src/components.jsx';
export function mount() {
  const host = document.createElement('div'); document.body.replaceChildren(host);
  function Harness() {
    const state = useListState('scroll-test');
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState([]);
    const [limit, setLimit] = useState(25);
    window.completeQuery = count => { setRows(Array.from({length: count}, (_, i) => ({id: i + 1, name: `Equipo ${i + 1}`}))); setLoading(false); };
    return <><DataTable title="Prueba" rows={rows} columns={[{key: 'name', label: 'Equipo'}]} state={state} loading={loading} />
    <div id="custom-list" style={{height: 200, overflow: 'auto'}}>{Array.from({length: Math.min(limit, 125)}, (_, i) => <p key={i} style={{height: 30}}>Registro {i+1}</p>)}<InfiniteMore count={limit} total={125} onMore={() => setLimit(n => n + 25)} /></div></>;
  }
  createRoot(host).render(<Harness />);
}
