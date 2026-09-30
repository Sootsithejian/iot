import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || `http://${location.hostname}:4000/api`;

function obtenerClienteId() {
  let id = localStorage.getItem('clienteId');
  if (!id) {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('clienteId', id);
  }
  return id;
}
const clienteId = obtenerClienteId();

const COLS = [105, 210, 315];
const info = (id) => ({ cx: COLS[(id - 1) % 3], col: (id - 1) % 3, arriba: id <= 3 });
const centroY = (arriba) => (arriba ? 82 : 278);
const rectY = (arriba) => (arriba ? 24 : 220);

const COLOR = {
  libre: { fill: '#dcfce7', stroke: '#16a34a' },
  ocupado: { fill: '#fee2e2', stroke: '#dc2626' },
  reservado: { fill: '#dbeafe', stroke: '#2563eb' },
};

const json = { 'Content-Type': 'application/json' };

export default function App() {
  const [lugares, setLugares] = useState([]);
  const [error, setError] = useState('');

  const cargar = async () => {
    try {
      const r = await fetch(`${API}/lugares?clienteId=${clienteId}`);
      setLugares(await r.json());
      setError('');
    } catch {
      setError('Sin conexión con el servidor');
    }
  };

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 3000);
    return () => clearInterval(t);
  }, []);

  const mio = lugares.find((l) => l.mia);

  const reservar = async (l) => {
    if (l.estado !== 'libre') return;
    const r = await fetch(`${API}/reservaciones`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ lugarId: l.id, clienteId }),
    });
    if (r.status === 409) alert('Ese lugar ya fue tomado, elige otro');
    cargar();
  };

  const cancelar = async () => {
    await fetch(`${API}/reservaciones/${mio.reservacionId}`, { method: 'DELETE' });
    cargar();
  };

  const simular = async (l) => {
    await fetch(`${API}/simular`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ lugar: l.id, ocupado: l.estado !== 'ocupado' }),
    });
    cargar();
  };

  const distancia = mio ? 10 + info(mio.id).col * 8 + 5 : 0;

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: 12 }}>
      <h2 style={{ textAlign: 'center', margin: '8px 0' }}>Ruta al espacio</h2>
      <p style={{ textAlign: 'center', color: '#6b7280', margin: '0 0 8px' }}>
        {mio ? 'Sigue la ruta señalada hasta tu espacio' : 'Toca un espacio libre para reservarlo'}
      </p>
      {error && <p style={{ color: '#dc2626', textAlign: 'center' }}>{error}</p>}

      <svg viewBox="0 0 380 360" style={{ width: '100%', background: '#e5e7eb', borderRadius: 12 }}>
        <rect x="0" y="140" width="380" height="80" fill="#9ca3af" />
        <line x1="60" y1="180" x2="370" y2="180" stroke="#fff" strokeWidth="2" strokeDasharray="14 10" />

        {lugares.map((l) => {
          const { cx, arriba } = info(l.id);
          const c = COLOR[l.estado];
          const cy = centroY(arriba);
          const by = arriba ? 12 : 348;
          return (
            <g key={l.id} onClick={() => reservar(l)} style={{ cursor: l.estado === 'libre' ? 'pointer' : 'default' }}>
              <rect
                x={cx - 45} y={rectY(arriba)} width="90" height="116" rx="6" fill={c.fill}
                stroke={l.mia ? '#2563eb' : 'none'} strokeWidth="3" strokeDasharray={l.mia ? '8 5' : undefined}
              />
              {l.estado === 'ocupado' && (
                <rect x={cx - 20} y={cy - 35} width="40" height="70" rx="14" fill="#9ca3af" />
              )}
              {l.estado === 'libre' && (
                <>
                  <circle cx={cx} cy={cy} r="16" fill="#fff" />
                  <text x={cx} y={cy + 6} textAnchor="middle" fontSize="18" fontWeight="700" fill="#16a34a">P</text>
                </>
              )}
              <circle cx={cx} cy={by} r="10" fill="#fff" stroke={c.stroke} strokeWidth="2" />
              <text x={cx} y={by + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={c.stroke}>{l.id}</text>
            </g>
          );
        })}

        {mio && (
  <>
    <defs>
      <marker id="flecha" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#1d4ed8" />
      </marker>
    </defs>
    <polyline
      points={`52,180 ${info(mio.id).cx},180 ${info(mio.id).cx},${info(mio.id).arriba ? 110 : 250}`}
      fill="none" stroke="#1d4ed8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray="14 10" markerEnd="url(#flecha)"
    />
  </>
)}

        <rect x="0" y="167" width="52" height="26" rx="8" fill="#111827" />
        <text x="26" y="184" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">ENTRADA</text>
      </svg>

      {mio && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginTop: 12 }}>
          <strong>Espacio {mio.id} · Nivel {mio.nivel}</strong>
          <div style={{ color: '#6b7280', fontSize: 14 }}>Distancia aprox: {distancia} m</div>
          <div style={{ color: '#6b7280', fontSize: 14 }}>Tienes 10 min para llegar</div>
          <button
            onClick={cancelar}
            style={{ marginTop: 10, width: '100%', padding: 10, borderRadius: 10, border: '2px solid #dc2626', background: '#fff', color: '#dc2626', fontWeight: 700 }}
          >
            Cancelar selección
          </button>
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary>Panel de pruebas (simular sensores)</summary>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {lugares.map((l) => (
            <button key={l.id} onClick={() => simular(l)} style={{ padding: '6px 10px' }}>
              Lugar {l.id}: {l.estado === 'ocupado' ? 'liberar' : 'ocupar'}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}