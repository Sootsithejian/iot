import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const MINUTOS_RESERVA = 10;
const prisma = new PrismaClient();

const app = express();
app.use(cors());
app.use(express.json());

// Lista de lugares con su estado: libre, reservado u ocupado
app.get('/api/lugares', async (req, res) => {
  try {
    const clienteId = req.query.clienteId || '';
    const lugares = await prisma.lugar.findMany({
      orderBy: { id: 'asc' },
      include: {
        reservaciones: {
          where: { estado: 'activa', expiraEn: { gt: new Date() } },
          take: 1,
        },
      },
    });

    res.json(
      lugares.map((l) => {
        const r = l.reservaciones[0];
        const mia = !!r && r.clienteId === clienteId && !l.ocupado;
        return {
          id: l.id,
          nivel: l.nivel,
          estado: l.ocupado ? 'ocupado' : r ? 'reservado' : 'libre',
          mia,
          reservacionId: mia ? r.id : null,
          expiraEn: mia ? r.expiraEn : null,
        };
      })
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Aquí manda datos el ESP32: { "lugar": 2, "ocupado": true }
const manejarSensor = async (req,res) => {
  const { lugar, ocupado } = req.body;
  if (!Number.isInteger(lugar) || typeof ocupado !== 'boolean') {
    return res.status(400).json({ error: 'Se espera { lugar: número, ocupado: true/false }' });
  }
  try {
    await prisma.lugar.update({
      where: { id: lugar },
      data: { ocupado, ultimaLectura: new Date() },
    });

    // Si llegó un coche y había reservación, queda cumplida
    if (ocupado) {
      await prisma.reservacion.updateMany({
        where: { lugarId: lugar, estado: 'activa' },
        data: { estado: 'cumplida' },
      });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Lugar no existe' });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

const SENSOR_KEY = process.env.SENSOR_KEY;
app.post(
  '/api/sensores',
  (req, res, next) => {
    if (SENSOR_KEY && req.get('x-api-key') !== SENSOR_KEY) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    next();
  },
  manejarSensor
);

// Solo para el panel de pruebas de la página (sin clave). Se activa con SIMULADOR=true
if (process.env.SIMULADOR === 'true') {
  app.post('/api/simular', manejarSensor);
}

// Reservar un lugar (transacción con bloqueo para evitar dobles reservas)
app.post('/api/reservaciones', async (req, res) => {
  const { lugarId, clienteId } = req.body;
  if (!Number.isInteger(lugarId) || !clienteId) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  try {
    const reservacion = await prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw`SELECT id, ocupado FROM lugares WHERE id = ${lugarId} FOR UPDATE`;
      if (filas.length === 0) throw new Error('NO_EXISTE');

      const activa = await tx.reservacion.findFirst({
        where: { lugarId, estado: 'activa', expiraEn: { gt: new Date() } },
      });
      if (filas[0].ocupado || activa) throw new Error('TOMADO');

      // Un cliente solo puede tener una reservación a la vez
      await tx.reservacion.updateMany({
        where: { clienteId, estado: 'activa' },
        data: { estado: 'cancelada' },
      });

      return tx.reservacion.create({
        data: {
          lugarId,
          clienteId,
          expiraEn: new Date(Date.now() + MINUTOS_RESERVA * 60 * 1000),
        },
      });
    });
    res.status(201).json({ id: reservacion.id });
  } catch (e) {
    if (e.message === 'NO_EXISTE') return res.status(404).json({ error: 'Lugar no existe' });
    if (e.message === 'TOMADO') return res.status(409).json({ error: 'Ese lugar ya fue tomado' });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Cancelar selección
app.delete('/api/reservaciones/:id', async (req, res) => {
  try {
    await prisma.reservacion.updateMany({
      where: { id: Number(req.params.id), estado: 'activa' },
      data: { estado: 'cancelada' },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log(`Parking API en http://localhost:${PORT}`));