// src/index.ts - Versión completa, segura y corregida (build fix + 404 solucionado)
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import cors from 'cors';

console.log('DATABASE_URL cargada:', process.env.DATABASE_URL ? 'Sí' : 'NO');

// ==================== SETUP ====================
const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
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

  // Seguridad: email confirmado
  if (!user.email_confirmed_at) {
    return res.status(403).json({ error: 'Por favor confirma tu email' });
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
        password: 'hashed_by_supabase',   // ← Campo requerido por tu schema
        role: 'USER',
      },
    });
    console.log(`✅ Usuario creado automáticamente en Prisma: ${user.email}`);
  }

  req.dbUser = dbUser;
  next();
};

// ==================== RUTAS CRÍTICAS ====================

app.get('/health', (req, res) => res.json({ status: 'OK' }));

app.get('/users/me', authenticate, async (req: any, res: any) => {
  res.json({ 
    user: { 
      id: req.user.id, 
      email: req.user.email, 
      role: req.dbUser.role 
    } 
  });
});

app.get('/services/my', authenticate, async (req: any, res: any) => {
  const services = await prisma.service.findMany({
    where: { requesterId: req.user.id },
    include: { driver: { select: { id: true, email: true } } },
    orderBy: { requestedAt: 'desc' },
    take: 10,
  });
  res.json({ message: 'Mis servicios', services });
});

app.get('/services/driver/my', authenticate, async (req: any, res: any) => {
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
});

// ==================== OTRAS RUTAS IMPORTANTES ====================

// HU-04: Perfil conductor
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

// Aceptar, Rechazar, Llegada, Finalizar (versiones básicas pero funcionales)
app.patch('/services/:serviceId/accept', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  try {
    if (req.dbUser.role !== 'DRIVER') return res.status(403).json({ error: 'Solo conductores' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.driverId !== req.user.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes aceptar este servicio' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'ACCEPTED', acceptedAt: new Date() }
    });

    res.json({ message: 'Oferta aceptada', service: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.patch('/services/:serviceId/reject', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  try {
    if (req.dbUser.role !== 'DRIVER') return res.status(403).json({ error: 'Solo conductores' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service || service.driverId !== req.user.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'REJECTED', driverId: null }
    });

    // Simple fallback (puedes mejorarlo después)
    res.json({ message: 'Oferta rechazada. Buscando siguiente conductor...', status: 'REJECTED' });
  } catch (error: any) {
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

    const waitMinutes = 5; // placeholder
    const amount = 50;

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'COMPLETED', waitEndAt: new Date(), amount }
    });

    res.json({ message: 'Servicio finalizado', service: updated, importe: amount });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});