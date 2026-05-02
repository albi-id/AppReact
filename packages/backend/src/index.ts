// src/index.ts - Versión completa, segura y corregida (build fix + 404 solucionado)
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


// HU-07: Solicitar servicio (USER) + Matching automático
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
      return res.status(400).json({ error: 'pickupLat y pickupLng deben ser números válidos' });
    }

    const newService = await prisma.service.create({
      data: {
        requesterId: req.user.id,
        type: type as any,
        pickupLat: pickupLat,
        pickupLng: pickupLng,
        status: 'REQUESTED',
      },
    });

    console.log(`✅ Servicio REQUESTED creado: ${newService.id} - Tipo: ${type}`);

    // Matching automático después de 1.5 segundos
    setTimeout(async () => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
          await axios.post(`https://app-nexos-backend.onrender.com/services/match`, 
            { serviceId: newService.id },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          console.log(`🔄 Matching automático ejecutado para servicio ${newService.id}`);
        }
      } catch (e: any) {
        console.error('❌ Error en matching automático:', e.message);
      }
    }, 1500);

    res.json({
      message: "Servicio solicitado correctamente",
      service: newService,
    });

  } catch (error: any) {
    console.error('Error al solicitar servicio:', error);
    res.status(500).json({ error: 'Error interno al crear solicitud' });
  }
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

// HU-09: Rechazar oferta + fallback automático al siguiente conductor más cercano
app.patch('/services/:serviceId/reject', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden rechazar' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.driverId !== req.user.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    // Marcar como rechazado y liberar conductor
    await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'REJECTED', 
        driverId: null 
      },
    });

    console.log(`🚫 Conductor ${req.user.id} rechazó servicio ${serviceId}`);

    // Buscar conductores disponibles del mismo tipo
    const drivers = await prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        vehicleType: service.type,
        userId: { not: req.user.id }   // Excluir al que rechazó
      },
      include: { user: true },
    });

    if (drivers.length === 0) {
      return res.json({ 
        message: 'Oferta rechazada. No hay más conductores disponibles en este momento.', 
        status: 'REJECTED' 
      });
    }

    // Función Haversine para calcular distancia
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + 
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    // Ordenar por cercanía
    const candidates = drivers
      .map(driver => {
        const loc = driver.lastLocation as { lat: number; lng: number } | null;
        if (!loc) return { driver, distanceKm: Infinity };
        const distanceKm = getDistance(
          service.pickupLat!, 
          service.pickupLng!, 
          loc.lat, 
          loc.lng
        );
        return { driver, distanceKm };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const nextDriver = candidates[0].driver;

    // Asignar al siguiente conductor más cercano
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        driverId: nextDriver.userId,
        status: 'OFFERED',
      },
    });

    console.log(`🔄 Servicio ${serviceId} reasignado automáticamente al conductor ${nextDriver.userId}`);

    res.json({
      message: 'Oferta rechazada. Asignada al siguiente conductor más cercano.',
      nextDriverId: nextDriver.userId,
      distanceKm: candidates[0].distanceKm.toFixed(2),
      status: 'OFFERED'
    });

  } catch (error: any) {
    console.error('Error al rechazar servicio:', error);
    res.status(500).json({ error: 'Error interno al rechazar' });
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

// HU-05: Activar/desactivar disponibilidad (En Línea)
app.patch('/driver/availability', authenticate, async (req: any, res: any) => {
  const { isOnline } = req.body;

  if (typeof isOnline !== 'boolean') {
    return res.status(400).json({ error: 'isOnline debe ser true o false' });
  }

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden cambiar disponibilidad' });
    }

    const updatedProfile = await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: {
        isOnline,
        updatedAt: new Date(),
      },
    });

    console.log(`Driver ${req.user.id} cambió estado a ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

    res.json({
      message: `Disponibilidad actualizada a ${isOnline ? 'En Línea' : 'Fuera de Línea'}`,
      isOnline: updatedProfile.isOnline,
    });
  } catch (error: any) {
    console.error('Error en /driver/availability:', error);
    
    // Si el perfil no existe, lo creamos
    if (error.code === 'P2025') {
      const newProfile = await prisma.driverProfile.create({
        data: {
          userId: req.user.id,
          vehicleType: 'MOTO', // valor por defecto
          isOnline,
        },
      });
      res.json({ 
        message: `Perfil creado y disponibilidad actualizada a ${isOnline ? 'En Línea' : 'Fuera de Línea'}`,
        isOnline 
      });
    } else {
      res.status(500).json({ error: 'Error interno' });
    }
  }
});

// HU-06.1: Obtener perfil del conductor (importante para leer isOnline correctamente)
app.get('/driver/profile', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo los conductores pueden ver su perfil' });
    }

    const profile = await prisma.driverProfile.findUnique({
      where: { userId: req.user.id },
      select: {
        id: true,
        vehicleType: true,
        isOnline: true,
        lastLocation: true,
        updatedAt: true,
      },
    });

    // Si no tiene perfil, lo creamos con estado OFFLINE por defecto
    if (!profile) {
      const newProfile = await prisma.driverProfile.create({
        data: {
          userId: req.user.id,
          vehicleType: 'MOTO',
          isOnline: false,        // importante: por defecto OFFLINE
        },
      });
      return res.json(newProfile);
    }

    res.json(profile);
  } catch (error: any) {
    console.error('Error al obtener perfil del conductor:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-06.2: Actualizar ubicación en tiempo real del conductor
app.patch('/driver/location', authenticate, async (req: any, res: any) => {
  const { lat, lng } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat y lng deben ser números válidos' });
  }

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden actualizar ubicación' });
    }

    const updated = await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: {
        lastLocation: { lat, lng },
        updatedAt: new Date(),
      },
    });

    console.log(`📍 Ubicación actualizada - Conductor ${req.user.id}: (${lat}, ${lng})`);

    res.json({
      message: 'Ubicación actualizada correctamente',
      location: { lat, lng }
    });
  } catch (error: any) {
    console.error('Error actualizando ubicación:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-07: Solicitar servicio (USER) + Matching automático
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
      return res.status(400).json({ error: 'pickupLat y pickupLng deben ser números válidos' });
    }

    const newService = await prisma.service.create({
      data: {
        requesterId: req.user.id,
        type: type as any,
        pickupLat: pickupLat,
        pickupLng: pickupLng,
        status: 'REQUESTED',
      },
    });

    console.log(`✅ Servicio REQUESTED creado: ${newService.id} - Tipo: ${type}`);

    // Matching automático
    setTimeout(async () => {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
          await axios.post(`https://app-nexos-backend.onrender.com/services/match`, 
            { serviceId: newService.id },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          console.log(`🔄 Matching automático ejecutado para servicio ${newService.id}`);
        }
      } catch (e: any) {
        console.error('❌ Error en matching automático:', e.message);
      }
    }, 1500);

    res.json({
      message: "Servicio solicitado correctamente",
      service: newService,
    });

  } catch (error: any) {
    console.error('Error al solicitar servicio:', error);
    res.status(500).json({ error: 'Error interno al crear solicitud' });
  }
});

// HU-08: Matching automático - Asignar al conductor más cercano
app.post('/services/match', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.body;

  if (!serviceId) {
    return res.status(400).json({ error: 'serviceId requerido' });
  }

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { requester: true },
    });

    if (!service || service.status !== 'REQUESTED') {
      return res.status(404).json({ error: 'Servicio no encontrado o ya procesado' });
    }

    const drivers = await prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        vehicleType: service.type,
      },
      include: { user: true },
    });

    if (drivers.length === 0) {
      return res.json({ message: 'No hay conductores disponibles en este momento', candidates: [] });
    }

    // Función para calcular distancia (Haversine)
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const candidates = drivers
      .map(driver => {
        const loc = driver.lastLocation as { lat: number; lng: number } | null;
        if (!loc) return { driver, distanceKm: Infinity };
        const distanceKm = getDistance(service.pickupLat!, service.pickupLng!, loc.lat, loc.lng);
        return { driver, distanceKm };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);

    const closest = candidates[0];

    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        driverId: closest.driver.userId,
        status: 'OFFERED',
      },
    });

    res.json({
      message: 'Oferta enviada al conductor más cercano',
      driverId: closest.driver.userId,
      distanceKm: closest.distanceKm.toFixed(2),
      service: updatedService,
    });
  } catch (error: any) {
    console.error('Error en matching:', error);
    res.status(500).json({ error: 'Error interno en matching' });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});