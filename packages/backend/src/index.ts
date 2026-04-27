// src/index.ts - Versión completa y segura (27 Abril 2026)
// Corrige el 404 + mantiene lógica importante para producción

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import cors from 'cors';
import axios from 'axios';

console.log('DATABASE_URL cargada:', process.env.DATABASE_URL ? 'Sí' : 'NO');

// ==================== SETUP ====================
const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || ['http://localhost:5173', 'https://nexoswebfrontend.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const port = Number(process.env.PORT) || 10000;

// ==================== MIDDLEWARE SEGURO ====================
const authenticate = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido (Bearer <token>)' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  // Seguridad: Verificar que el email esté confirmado
  if (!user.email_confirmed_at) {
    return res.status(403).json({ error: 'Por favor confirma tu email antes de usar la app' });
  }

  req.user = user;

  // Buscar o crear usuario en Prisma
  let dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, role: true },
  });

  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        id: user.id,
        email: user.email!,
        role: 'USER',           // Por defecto es USER
      },
    });
    console.log(`✅ Usuario creado automáticamente en Prisma: ${user.email}`);
  }

  req.dbUser = dbUser;
  next();
};

// ==================== RUTAS CRÍTICAS ====================

app.get('/health', (req, res) => res.json({ status: 'OK' }));

// Usada por el Dashboard al loguearse
app.get('/users/me', authenticate, async (req: any, res: any) => {
  res.json({ 
    user: { 
      id: req.user.id, 
      email: req.user.email, 
      role: req.dbUser.role 
    } 
  });
});

// Servicios del solicitante
app.get('/services/my', authenticate, async (req: any, res: any) => {
  try {
    const services = await prisma.service.findMany({
      where: { requesterId: req.user.id },
      include: { driver: { select: { id: true, email: true } } },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    });
    res.json({ message: 'Mis servicios', services });
  } catch (error: any) {
    console.error('Error en /services/my:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Servicios del conductor
app.get('/services/driver/my', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden ver sus servicios asignados' });
    }

    const services = await prisma.service.findMany({
      where: { driverId: req.user.id },
      include: { requester: { select: { id: true, email: true } } },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    });

    res.json({ message: 'Mis servicios asignados', services });
  } catch (error: any) {
    console.error('Error en /services/driver/my:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ==================== RUTAS DEL FLUJO PRINCIPAL ====================

// HU-04: Perfil de conductor
app.post('/driver/profile', authenticate, async (req: any, res: any) => {
  const { vehicleType } = req.body;
  if (!vehicleType || !['TAXI', 'TRAFIC', 'MOTO'].includes(vehicleType)) {
    return res.status(400).json({ error: 'vehicleType debe ser TAXI, TRAFIC o MOTO' });
  }

  try {
    let userRole = req.dbUser.role;
    if (userRole === 'USER') {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { role: 'DRIVER' },
      });
      userRole = 'DRIVER';
    }

    const profile = await prisma.driverProfile.upsert({
      where: { userId: req.user.id },
      update: { vehicleType, updatedAt: new Date() },
      create: { userId: req.user.id, vehicleType },
    });

    res.json({ message: 'Perfil de conductor creado/actualizado', profile, role: userRole });
  } catch (error: any) {
    console.error('Error en /driver/profile:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-05: En Línea / Fuera de Línea
app.patch('/driver/availability', authenticate, async (req: any, res: any) => {
  const { isOnline } = req.body;
  if (typeof isOnline !== 'boolean') {
    return res.status(400).json({ error: 'isOnline debe ser boolean' });
  }

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden cambiar disponibilidad' });
    }

    const updatedProfile = await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: { isOnline, updatedAt: new Date() },
    });

    res.json({
      message: `Disponibilidad actualizada a ${isOnline ? 'online' : 'offline'}`,
      profile: updatedProfile,
    });
  } catch (error: any) {
    console.error('Error en /driver/availability:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-07: Solicitar servicio + Matching automático
app.post('/services/request', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo usuarios solicitantes pueden pedir servicio' });
    }

    const { type, pickupLat, pickupLng } = req.body;
    if (!type || !['MOTO', 'TAXI', 'TRAFIC'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser MOTO, TAXI o TRAFIC' });
    }
    if (typeof pickupLat !== 'number' || typeof pickupLng !== 'number') {
      return res.status(400).json({ error: 'Coordenadas inválidas' });
    }

    const newService = await prisma.service.create({
      data: {
        requesterId: req.user.id,
        type: type as any,
        pickupLat,
        pickupLng,
        status: 'REQUESTED',
      },
    });

    console.log(`✅ Servicio REQUESTED creado: ${newService.id}`);

    // Matching automático
    setTimeout(async () => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
          await axios.post(`https://app-nexos-backend.onrender.com/services/match`, 
            { serviceId: newService.id },
            { headers: { Authorization: `Bearer ${token}` } }
          );
        }
      } catch (e) {
        console.error('Error en matching automático:', e);
      }
    }, 1500);

    res.json({ message: "Servicio solicitado correctamente", service: newService });
  } catch (error: any) {
    console.error('Error al solicitar servicio:', error);
    res.status(500).json({ error: 'Error interno al crear solicitud' });
  }
});

// Accept, Reject, Arrive, Finish-wait (versiones estables)
app.patch('/services/:serviceId/accept', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  try {
    if (req.dbUser.role !== 'DRIVER') return res.status(403).json({ error: 'Solo conductores pueden aceptar' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.driverId !== req.user.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes aceptar este servicio' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'ACCEPTED', acceptedAt: new Date() }
    });

    res.json({ message: 'Oferta aceptada correctamente', service: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.patch('/services/:serviceId/reject', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  try {
    if (req.dbUser.role !== 'DRIVER') return res.status(403).json({ error: 'Solo conductores pueden rechazar' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.driverId !== req.user.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'REJECTED', driverId: null }
    });

    // Fallback al siguiente conductor más cercano
    const drivers = await prisma.driverProfile.findMany({
      where: { isOnline: true, vehicleType: service.type, userId: { not: req.user.id } },
      include: { user: true },
    });

    if (drivers.length === 0) {
      return res.json({ message: 'No hay más conductores disponibles', status: 'REJECTED' });
    }

    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const candidates = drivers.map(d => {
      const loc = d.lastLocation as any;
      const distance = loc ? getDistance(service.pickupLat!, service.pickupLng!, loc.lat, loc.lng) : Infinity;
      return { driver: d, distance };
    }).sort((a, b) => a.distance - b.distance);

    const next = candidates[0].driver;

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { driverId: next.userId, status: 'OFFERED' }
    });

    res.json({ message: 'Asignado al siguiente conductor', nextDriverId: next.userId, status: 'OFFERED' });
  } catch (error: any) {
    console.error('Error al rechazar:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.patch('/services/:serviceId/arrive', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  try {
    if (req.dbUser.role !== 'DRIVER') return res.status(403).json({ error: 'Solo conductores' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.driverId !== req.user.id || service.status !== 'ACCEPTED') {
      return res.status(403).json({ error: 'Acción no permitida' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'ARRIVED', arrivedAt: new Date() }
    });

    res.json({ message: 'Llegada marcada', service: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.patch('/services/:serviceId/finish-wait', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  try {
    if (req.dbUser.role !== 'DRIVER') return res.status(403).json({ error: 'Solo conductores' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.driverId !== req.user.id || service.status !== 'ARRIVED') {
      return res.status(403).json({ error: 'Acción no permitida' });
    }

    const waitMinutes = service.arrivedAt 
      ? Math.round((Date.now() - service.arrivedAt.getTime()) / 60000)
      : 5;

    const rates = { MOTO: 5, TAXI: 10, TRAFIC: 20 };
    let amount = Math.max(50, waitMinutes * (rates[service.type as keyof typeof rates] || 8));

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'COMPLETED', waitEndAt: new Date(), amount }
    });

    res.json({ message: 'Servicio finalizado', service: updated, importe: amount });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ==================== INICIO DEL SERVIDOR ====================
app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
  console.log(`→ /users/me`);
  console.log(`→ /services/my`);
  console.log(`→ /services/driver/my`);
});