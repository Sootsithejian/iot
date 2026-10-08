import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || `http://${location.hostname}:4000/api`;
// El socket se conecta al origen del backend (la misma URL sin el /api final)
const SOCKET_URL = API.replace(/\/api\/?$/, '');

// Identificador anónimo por celular/navegador
function obtenerClienteId() {
  let id = localStorage.getItem('clienteId');
  if (!id) {
    id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    localStorage.setItem('clienteId', id);
  }
  return id;
}
const clienteId = obtenerClienteId();

const PISOS = [1, 2];

// Geometría del plano (viewBox 380 x 360). n = número del lugar dentro del piso (1 a 6)
const COLS = [105, 210, 315];
const info = (n) => ({ cx: COLS[(n - 1) % 3], col: (n - 1) % 3, arriba: n <= 3 });
const centroY = (arriba) => (arriba ? 82 : 278);
const rectY = (arriba) => (arriba ? 24 : 220);

const COLOR = {
  libre: { fill: '#dcfce7', stroke: '#16a34a' },
  ocupado: { fill: '#fee2e2', stroke: '#dc2626' },
  reservado: { fill: '#dbeafe', stroke: '#2563eb' },
};

const json = { 'Content-Type': 'application/json' };

const mismaHora = (a, b) => !!a && !!b && new Date(a).getTime() === new Date(b).getTime();

// Aplica un evento en tiempo real a la lista de lugares.
// El evento es neutro (no trae de quién es la reservación): "mia" se deduce comparando
// la hora de vencimiento con la de mi propia reservación.
function aplicarEvento(lista, ev) {
  return lista.map((l) => {
    if (l.id !== ev.id) return l;
    const mia = l.mia && ev.estado === 'reservado' && mismaHora(ev.expiraEn, l.expiraEn);
    return {
      ...l,
      estado: ev.estado,
      expiraEn: ev.expiraEn,
      sensorEnLinea: ev.sensorEnLinea,
      mia,
      reservacionId: mia ? l.reservacionId : null,
    };
  });
}

export default function App() {
  const [lugares, setLugares] = useState([]);
  const [cargado, setCargado] = useState(false);
  const [piso, setPiso] = useState(null); // null = pantalla de inicio
  const [error, setError] = useState('');
  const [enVivo, setEnVivo] = useState(false);
  const [ahora, setAhora] = useState(Date.now());

  const desfase = useRef(0); // diferencia entre el reloj del servidor y el de este dispositivo
  const enVuelo = useRef(false); // hay un GET en curso
  const repetir = useRef(false); // se pidió otro GET mientras había uno en curso
  const buffer = useRef([]); // eventos recibidos mientras el GET está en curso

  // GET con la foto completa del estacionamiento
  const cargar = useCallback(async () => {
    if (enVuelo.current) {
      repetir.current = true;
      return;
    }
    enVuelo.current = true;
    buffer.current = [];
    try {
      const r = await fetch(`${API}/lugares?clienteId=${clienteId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      desfase.current = data.serverTime - Date.now();
      // Eventos que llegaron durante el fetch y son más nuevos que la foto
      const pendientes = buffer.current.filter((e) => e.seq > data.seq);
      setLugares(pendientes.reduce(aplicarEvento, data.lugares));
      setCargado(true);
      setError('');
    } catch {
      // Si el GET falló, al menos aplica los eventos que sí llegaron
      const pendientes = buffer.current;
      if (pendientes.length) setLugares((prev) => pendientes.reduce(aplicarEvento, prev));
      setError('Sin conexión con el servidor');
    } finally {
      buffer.current = [];
      enVuelo.current = false;
      if (repetir.current) {
        repetir.current = false;
        cargar();
      }
    }
  }, []);

  useEffect(() => {
    cargar(); // fetch inicial, en paralelo a la apertura del socket
    const socket = io(SOCKET_URL);

    // Se ejecuta en la primera conexión y en cada reconexión:
    // vuelve a sincronizar lo que pudo pasar mientras no había conexión
    socket.on('connect', () => {
      setEnVivo(true);
      cargar();
    });
    socket.on('disconnect', () => setEnVivo(false));
    socket.on('lugar:actualizado', (ev) => {
      if (enVuelo.current) buffer.current.push(ev);
      else setLugares((prev) => aplicarEvento(prev, ev));
    });

    const respaldo = setInterval(cargar, 30000); // respaldo lento (también refresca el indicador de sensores)
    const reloj = setInterval(() => setAhora(Date.now()), 1000); // para vencer reservaciones en el cliente
    const alVolver = () => {
      if (document.visibilityState === 'visible') cargar(); // el celular despertó
    };
    document.addEventListener('visibilitychange', alVolver);

    return () => {
      socket.disconnect();
      clearInterval(respaldo);
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  // Las reservaciones vencen en el cliente, sin esperar ningún evento del servidor
  const ahoraServidor = ahora + desfase.current;
  const vista = useMemo(
    () =>
      lugares.map((l) => {
        const vencida =
          l.estado === 'reservado' && l.expiraEn && new Date(l.expiraEn).getTime() <= ahoraServidor;
        return vencida ? { ...l, estado: 'libre', mia: false, reservacionId: null } : l;
      }),
    [lugares, ahoraServidor]
  );

  const mio = vista.find((l) => l.mia);

  // Si ya tienes una reservación, entra directo al piso de tu espacio
  useEffect(() => {
    if (mio) setPiso(mio.nivel);
  }, [mio?.id]);

  const delPiso = vista.filter((l) => l.nivel === piso);
  const resumen = (n) => {
    const l = vista.filter((x) => x.nivel === n);
    return {
      total: l.length,
      libres: l.filter((x) => x.estado === 'libre').length,
      sensores: l.filter((x) => x.sensorEnLinea).length,
    };
  };

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

  // Panel de pruebas: simula el sensor de un lugar
  const simular = async (l) => {
    await fetch(`${API}/simular`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ lugar: l.id, ocupado: l.estado !== 'ocupado' }),
    });
    cargar();
  };

  const contenedor = { maxWidth: 420, margin: '0 auto', padding: 12 };
  const indicador = (
    <p style={{ textAlign: 'center', fontSize: 12, margin: '0 0 4px', color: enVivo ? '#16a34a' : '#9ca3af' }}>
      {enVivo ? '● En vivo' : '○ Reconectando...'}
    </p>
  );

  // ============ PANTALLA DE INICIO ============
  if (piso === null) {
    return (
      <div style={contenedor}>
        <h1 style={{ textAlign: 'center', margin: '24px 0 4px' }}>Estacionamiento</h1>
        {indicador}
        <p style={{ textAlign: 'center', color: '#6b7280', margin: '0 0 24px' }}>
          ¿En qué piso quieres estacionarte?
        </p>
        {error && <p style={{ color: '#dc2626', textAlign: 'center' }}>{error}</p>}
        {!cargado && !error && <p style={{ textAlign: 'center', color: '#6b7280' }}>Cargando...</p>}

        {cargado &&
          PISOS.map((n) => {
            const r = resumen(n);
            const lleno = r.libres === 0;
            return (
              <button
                key={n}
                onClick={() => setPiso(n)}
                disabled={lleno}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 12,
                  padding: 16, borderRadius: 16, border: '2px solid #2563eb',
                  background: lleno ? '#f3f4f6' : '#fff', opacity: lleno ? 0.6 : 1,
                  cursor: lleno ? 'not-allowed' : 'pointer',
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Piso {n}</div>
                <div style={{ fontSize: 16, color: lleno ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                  {lleno ? 'Lleno' : `${r.libres} de ${r.total} lugares libres`}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                  Sensores en línea: {r.sensores} de {r.total}
                </div>
              </button>
            );
          })}
      </div>
    );
  }

  // ============ PANTALLA DEL MAPA ============
  const miInfo = mio ? info(mio.numero) : null;
  const distancia = mio ? 10 + info(mio.numero).col * 8 + 5 + (mio.nivel - 1) * 25 : 0;

  return (
    <div style={contenedor}>
      <button
        onClick={() => setPiso(null)}
        style={{ border: 'none', background: 'none', color: '#2563eb', fontWeight: 700, fontSize: 15, padding: '4px 0' }}
      >
        ← Cambiar de piso
      </button>
      <h2 style={{ textAlign: 'center', margin: '4px 0' }}>Piso {piso}</h2>
      {indicador}
      <p style={{ textAlign: 'center', color: '#6b7280', margin: '0 0 8px' }}>
        {mio && mio.nivel === piso
          ? 'Sigue la ruta señalada hasta tu espacio'
          : 'Toca un espacio libre para reservarlo'}
      </p>
      {error && <p style={{ color: '#dc2626', textAlign: 'center' }}>{error}</p>}

      {mio && mio.nivel !== piso && (
        <p style={{ textAlign: 'center', color: '#2563eb', fontWeight: 600 }}>
          Tu espacio está en el piso {mio.nivel}
        </p>
      )}

      <svg viewBox="0 0 380 360" style={{ width: '100%', background: '#e5e7eb', borderRadius: 12 }}>
        <rect x="0" y="140" width="380" height="80" fill="#9ca3af" />
        <line x1="60" y1="180" x2="370" y2="180" stroke="#fff" strokeWidth="2" strokeDasharray="14 10" />

        {delPiso.map((l) => {
          const { cx, arriba } = info(l.numero);
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
              <text x={cx} y={by + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={c.stroke}>{l.numero}</text>
              {/* Indicador del sensor: verde = en línea, gris = sin señal */}
              <circle cx={cx + 36} cy={rectY(arriba) + 10} r="5" fill={l.sensorEnLinea ? '#16a34a' : '#9ca3af'} stroke="#fff" strokeWidth="1.5" />
            </g>
          );
        })}

        {mio && mio.nivel === piso && (
          <>
            <defs>
              <marker id="flecha" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="#1d4ed8" />
              </marker>
            </defs>
            <polyline
              points={`52,180 ${miInfo.cx},180 ${miInfo.cx},${miInfo.arriba ? 110 : 250}`}
              fill="none" stroke="#1d4ed8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"
              strokeDasharray="14 10" markerEnd="url(#flecha)"
            />
          </>
        )}

        <rect x="0" y="167" width="52" height="26" rx="8" fill="#111827" />
        <text x="26" y="184" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">
          {piso === 1 ? 'ENTRADA' : 'RAMPA'}
        </text>
      </svg>

      <p style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 0' }}>
        <span style={{ color: '#16a34a' }}>●</span> sensor en línea &nbsp;
        <span style={{ color: '#9ca3af' }}>●</span> sin señal del sensor
      </p>

      {mio && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginTop: 12 }}>
          <strong>Espacio {mio.numero} · Piso {mio.nivel}</strong>
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
          {delPiso.map((l) => (
            <button key={l.id} onClick={() => simular(l)} style={{ padding: '6px 10px' }}>
              Lugar {l.numero} (ESP32 id {l.id}): {l.estado === 'ocupado' ? 'liberar' : 'ocupar'}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}