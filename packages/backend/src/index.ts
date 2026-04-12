// src/index.ts
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import cors from 'cors';
import axios from 'axios';

console.log('DATABASE_URL cargada:', process.env.DATABASE_URL ? 'Sí' : 'NO');

// Middleware de autenticación (para rutas protegidas)
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

  // Guardamos el usuario autenticado
  req.user = user;

  // Rol desde Prisma
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });

  if (!dbUser) {
    return res.status(404).json({ error: 'Usuario no encontrado en DB' });
  }

  req.dbUser = dbUser;
  next();
};


// Prisma Client clásico (lee DATABASE_URL del .env automáticamente)
const prisma = new PrismaClient();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const app = express();
//app.use(cors({
//  origin: 'http://localhost:5173',  // Permite solo tu frontend Vite
//}));


app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',   // ← debe leer la variable
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


const port = Number(process.env.PORT) || 10000;


app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', prismaReady: true });
});

// Lista usuarios (prueba Prisma)
app.get('/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (e) {
    console.error('Error Prisma:', e);
    res.status(500).json({ error: 'Prisma error' });
  }
});

// Helper para validar email
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Registro con validaciones mejoradas
app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }

  const emailLower = email.toLowerCase().trim();

  if (!isValidEmail(emailLower)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    // Verificar si ya existe en Supabase Auth (opcional, pero bueno)
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const userExists = existingUser.users.some(u => u.email?.toLowerCase() === emailLower);

    if (userExists) {
      return res.status(409).json({ error: 'Este email ya está registrado' });
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: emailLower,
      password,
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    if (!authData.user) {
      return res.status(500).json({ error: 'No se pudo crear el usuario' });
    }

    await prisma.user.create({
      data: {
        id: authData.user.id,
        email: emailLower,
        password: 'hashed_by_supabase',
        role: 'USER',
      },
    });

    res.status(201).json({
      message: 'Usuario registrado correctamente',
      userId: authData.user.id,
      email: emailLower,
      role: 'USER',
    });
  } catch (error: any) {
    console.error('Error register:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Login con validación de email
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }

  if (!isValidEmail(email.toLowerCase().trim())) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });

// ← AGREGAR ESTE LOG AQUÍ (justo después de signInWithPassword)
    console.log('Login attempt:', {
      email,
      confirmed: authData?.user?.email_confirmed_at,
      error: authError?.message || null,
    });
    //


    if (authError || !authData.user || !authData.session) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const user = await prisma.user.findUnique({
      where: { id: authData.user.id },
      select: { id: true, email: true, role: true },
    });

    res.json({
      message: 'Login exitoso',
      token: authData.session.access_token,
      user,
      expiresIn: authData.session.expires_in,
    });
  } catch (error: any) {
    console.error('Error login:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Cierre de sesión (HU-03) - versión correcta para Supabase v2
app.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido (Bearer <token>)' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verificamos que el token sea válido (opcional pero recomendado)
    const { data: { user }, error: verifyError } = await supabase.auth.getUser(token);

    if (verifyError || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    // En API REST, no podemos "cerrar" la sesión en Supabase desde el server (signOut es client-side).
    // Lo que hacemos es:
    // - El cliente borra el token localmente
    // - Opcional: invalidar refresh token si usas refresh (no es común en API simple)

    // Respuesta exitosa (el cliente debe borrar el token)
    res.json({ message: 'Sesión cerrada. Borra el token en el cliente.' });
  } catch (error: any) {
    console.error('Error en /logout:', error);
    res.status(500).json({ error: 'Error interno al cerrar sesión' });
  }
});

// HU-04: Alta / actualización de perfil conductor (protegido)
app.post('/driver/profile', authenticate, async (req: any, res: any) => {
  const { vehicleType } = req.body;

  if (!vehicleType || !['TAXI', 'TRAFIC', 'MOTO'].includes(vehicleType)) {
    return res.status(400).json({ error: 'vehicleType debe ser TAXI, TRAFIC o MOTO' });
  }

  try {
    let userRole = req.dbUser.role;

    // Si era USER, lo promovemos a DRIVER
    if (userRole === 'USER') {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { role: 'DRIVER' },
      });
      userRole = 'DRIVER';
    }

    if (userRole !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden tener perfil de conductor' });
    }

    // Crear o actualizar perfil
    const profile = await prisma.driverProfile.upsert({
      where: { userId: req.user.id },
      update: {
        vehicleType,
        updatedAt: new Date(),
      },
      create: {
        userId: req.user.id,
        vehicleType,
      },
    });

    res.json({
      message: 'Perfil de conductor creado/actualizado',
      profile,
      role: userRole,
    });
  } catch (error: any) {
    console.error('Error en /driver/profile:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-05: Activar/desactivar disponibilidad (online/offline)
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

    res.json({
      message: `Disponibilidad actualizada a ${isOnline ? 'online' : 'offline'}`,
      profile: updatedProfile,
    });
  } catch (error: any) {
    console.error('Error en /driver/availability:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-06: Enviar ubicación del conductor (solo si está online)
app.patch('/driver/location', authenticate, async (req: any, res: any) => {
  const { lat, lng } = req.body;

  // Validación básica
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat y lng deben ser números' });
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Coordenadas inválidas' });
  }

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden enviar ubicación' });
    }

    const profile = await prisma.driverProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!profile || !profile.isOnline) {
      return res.status(403).json({ error: 'Debes estar online para enviar ubicación' });
    }

    // Actualizar ubicación
    const updatedProfile = await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: {
        lastLocation: { lat, lng },  // JSON simple
        updatedAt: new Date(),
      },
    });

    res.json({
      message: 'Ubicación actualizada correctamente',
      location: updatedProfile.lastLocation,
    });
  } catch (error: any) {
    console.error('Error en /driver/location:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-07: Solicitar servicio por tipo de vehículo (solo USER)
//app.post('/services/request', authenticate, async (req: any, res: any) => {
  //const { vehicleType, lat, lng } = req.body;

  // Validaciones
  //if (!vehicleType || !['TAXI', 'TRAFIC', 'MOTO'].includes(vehicleType)) {
    //return res.status(400).json({ error: 'vehicleType debe ser TAXI, TRAFIC o MOTO' });
 // }

  //if (typeof lat !== 'number' || typeof lng !== 'number') {
    //return res.status(400).json({ error: 'lat y lng deben ser números' });
  //}

  //if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    //return res.status(400).json({ error: 'Coordenadas inválidas' });
  //}

 // try {
   // if (req.dbUser.role !== 'USER') {
     // return res.status(403).json({ error: 'Solo usuarios solicitantes pueden pedir servicio' });
  //  }

    //const newService = await prisma.service.create({
      //data: {
        //requesterId: req.user.id,
      //  type: vehicleType,
        //pickupLat: lat,
       // pickupLng: lng,
        //status: 'REQUESTED',
       // requestedAt: new Date(),
      //},
   // });

  //  res.status(201).json({
    //  message: 'Servicio solicitado correctamente',
     // service: {
      //  id: newService.id,
      //  type: newService.type,
      //  status: newService.status,
       // pickup: { lat: newService.pickupLat, lng: newService.pickupLng },
     //   requestedAt: newService.requestedAt,
   //   },
  //  });
  //} catch (error: any) {
 //   console.error('Error al solicitar servicio:', error);
 //   res.status(500).json({ error: 'Error interno al crear solicitud' });
 // }
//});
// HU-07: Solicitar servicio (USER)
app.post('/services/request', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo usuarios solicitantes pueden pedir servicio' });
    }

    const { type, pickupLat, pickupLng } = req.body;

    if (!type || !pickupLat || !pickupLng) {
      return res.status(400).json({ error: 'type, pickupLat y pickupLng son requeridos' });
    }

    const newService = await prisma.service.create({
      data: {
        requesterId: req.user.id,
        type: type as any,
        pickupLat: parseFloat(pickupLat),
        pickupLng: parseFloat(pickupLng),
        status: 'REQUESTED',
      },
    });

    // ←←← NUEVO: Llamar automáticamente al matching después de crear el servicio
    // Esto hace que se asigne al conductor más cercano
    setTimeout(async () => {
      try {
        await axios.post(`${process.env.BACKEND_URL || 'http://localhost:3000'}/services/match`, 
          { serviceId: newService.id },
          { headers: { Authorization: `Bearer ${req.headers.authorization?.split(' ')[1]}` } }
        );
      } catch (e) {
        console.error('Error en matching automático:', e);
      }
    }, 1000);

    res.json({
      message: "Servicio solicitado correctamente",
      service: newService,
    });

  } catch (error: any) {
    console.error('Error al solicitar servicio:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-08: Asignación automática al más cercano (con fallback si rechaza)
app.post('/services/match', authenticate, async (req: any, res: any) => {
  const { serviceId, excludedDriverIds = [] } = req.body; // excludedDriverIds para fallback si rechazan

  if (!serviceId) {
    return res.status(400).json({ error: 'serviceId requerido' });
  }

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo solicitantes pueden pedir matching' });
    }

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
        userId: { notIn: excludedDriverIds }, // excluye rechazados
      },
      include: { user: true },
    });

    if (drivers.length === 0) {
      return res.json({ message: 'No hay conductores disponibles ahora', candidates: [] });
    }

    // Función Haversine (fallback)
    const getDistanceFallback = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    // Calcula distancias y ordena
    const candidates = drivers
      .map(driver => {
        const loc = driver.lastLocation as { lat: number; lng: number } | null;
        if (!loc) return { driver, distanceKm: Infinity, etaMinutes: null };
        const distanceKm = getDistanceFallback(service.pickupLat!, service.pickupLng!, loc.lat, loc.lng);
        return { driver, distanceKm, etaMinutes: Math.round(distanceKm * 1.5) }; // 40 km/h promedio
      })
      .filter(c => c.distanceKm !== Infinity)
      .sort((a, b) => a.distanceKm - b.distanceKm);

    if (candidates.length === 0) {
      return res.json({ message: 'No hay conductores con ubicación válida', candidates: [] });
    }

    // Asigna al más cercano
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
      etaMinutes: closest.etaMinutes,
      service: updatedService,
    });
  } catch (error: any) {
    console.error('Error en match:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-09: Rechazo del conductor y fallback al siguiente
app.patch('/services/:serviceId/reject', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden rechazar servicios' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { driver: true },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.status !== 'OFFERED' || service.driverId !== req.user.id) {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    // Marcar como rechazado por este conductor
    await prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'REJECTED',
        driverId: null, // quita asignación
      },
    });

    // Buscar el siguiente conductor más cercano (reutilizamos lógica de match)
    const drivers = await prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        vehicleType: service.type,
        userId: { not: req.user.id }, // excluye el que rechazó
      },
      include: { user: true },
    });

    if (drivers.length === 0) {
      // No hay más candidatos → service rechazado definitivamente
      return res.json({
        message: 'Servicio rechazado. No hay más conductores disponibles.',
        status: 'REJECTED',
      });
    }

    // Ordenar por distancia (reutilizamos Haversine)
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
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
      .map(d => {
        const loc = d.lastLocation as { lat: number; lng: number } | null;
        if (!loc) return { driver: d, distance: Infinity };
        const distance = getDistance(
          service.pickupLat!,
          service.pickupLng!,
          loc.lat,
          loc.lng
        );
        return { driver: d, distance };
      })
      .filter(c => c.distance !== Infinity)
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length === 0) {
      return res.json({
        message: 'Servicio rechazado. No hay conductores con ubicación válida.',
        status: 'REJECTED',
      });
    }

    // Asignar al siguiente
    const nextDriver = candidates[0].driver;
    await prisma.service.update({
      where: { id: serviceId },
      data: {
        driverId: nextDriver.userId,
        status: 'OFFERED',
      },
    });

    res.json({
      message: 'Servicio rechazado. Asignado al siguiente conductor más cercano.',
      nextDriverId: nextDriver.userId,
      distanceKm: candidates[0].distance.toFixed(2),
      status: 'OFFERED',
    });
  } catch (error: any) {
    console.error('Error en reject/fallback:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


// HU-09: Rechazo del conductor y fallback automático al siguiente
app.patch('/services/:serviceId/reject', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    // Solo conductores pueden rechazar
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden rechazar servicios' });
    }

    // Buscar el servicio y verificar que esté asignado a este conductor
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { driver: true },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.driverId !== req.user.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'Este servicio no está asignado a ti o no está en estado OFFERED' });
    }

    // Marcar como rechazado por este conductor
    await prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'REJECTED',
        driverId: null, // quita la asignación actual
      },
    });

    // Buscar candidatos restantes (excluyendo al que rechazó)
    const drivers = await prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        vehicleType: service.type,
        userId: { not: req.user.id }, // excluye al que rechazó
      },
      include: { user: true },
    });

    if (drivers.length === 0) {
      // No hay más candidatos → servicio rechazado definitivamente
      return res.json({
        message: 'Servicio rechazado. No hay más conductores disponibles.',
        status: 'REJECTED',
      });
    }

    // Ordenar por distancia (reutilizamos Haversine simple por ahora)
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
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
        if (!loc) return { driver, distance: Infinity };
        const distance = getDistance(
          service.pickupLat!,
          service.pickupLng!,
          loc.lat,
          loc.lng
        );
        return { driver, distance };
      })
      .filter(c => c.distance !== Infinity)
      .sort((a, b) => a.distance - b.distance);

    if (candidates.length === 0) {
      return res.json({
        message: 'Servicio rechazado. No hay conductores con ubicación válida.',
        status: 'REJECTED',
      });
    }

    // Asignar al siguiente más cercano
    const nextDriver = candidates[0].driver;
    await prisma.service.update({
      where: { id: serviceId },
      data: {
        driverId: nextDriver.userId,
        status: 'OFFERED',
      },
    });

    res.json({
      message: 'Servicio rechazado. Asignado automáticamente al siguiente conductor.',
      nextDriverId: nextDriver.userId,
      distanceKm: candidates[0].distance.toFixed(2),
      status: 'OFFERED',
    });
  } catch (error: any) {
    console.error('Error en rechazo/fallback:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


// HU-10: Obtener ETA y notificación de asignación (solo solicitante del service)
app.get('/services/:serviceId/eta', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        requester: true,
        driver: { include: { driverProfile: true } },
      },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'Solo el solicitante puede ver ETA de este servicio' });
    }

    if (!service.driverId || !service.driver?.driverProfile?.lastLocation) {
      return res.json({
        message: 'Aún no hay conductor asignado o sin ubicación',
        etaMinutes: null,
        distanceKm: null,
      });
    }

    const driverLoc = service.driver.driverProfile.lastLocation as { lat: number; lng: number } | null;
    if (!driverLoc) {
      return res.json({
        message: 'Conductor asignado, pero sin ubicación disponible',
        etaMinutes: null,
        distanceKm: null,
      });
    }

    let distanceKm: number = 0;
    let etaMinutes: number | null = null;

    const geoapifyKey = process.env.GEOAPIFY_API_KEY;
    if (geoapifyKey) {
      try {
        const origin = `${service.pickupLat},${service.pickupLng}`;
        const destination = `${driverLoc.lat},${driverLoc.lng}`;
        const mode = service.type === 'MOTO' ? 'bicycle' : 'drive';
        const url = `https://api.geoapify.com/v1/routing?waypoints=${origin}|${destination}&mode=${mode}&apiKey=${geoapifyKey}`;

        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const leg = data.features?.[0]?.properties?.legs?.[0];
          if (leg) {
            distanceKm = leg.distance / 1000;
            etaMinutes = Math.round(leg.time / 60);
          }
        }
      } catch (geoError) {
        console.warn('Geoapify ETA falló:', geoError);
      }
    }

    // Fallback Haversine si Geoapify no dio resultado
    if (etaMinutes === null) {
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

      distanceKm = getDistance(
        service.pickupLat!,
        service.pickupLng!,
        driverLoc.lat,
        driverLoc.lng
      );
      etaMinutes = Math.round(distanceKm * 1.5); // Asumimos 40 km/h promedio
    }

    res.json({
      message: 'Conductor asignado',
      driverId: service.driverId,
      etaMinutes,
      distanceKm: distanceKm.toFixed(2),
      status: service.status,
    });
  } catch (error: any) {
    console.error('Error en /services/eta:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


// HU-11: Cancelación del servicio por el solicitante
app.delete('/services/:serviceId', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { driver: true },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'Solo el solicitante puede cancelar este servicio' });
    }

    // Solo se puede cancelar en estados iniciales o asignados
    const allowedStates = ['REQUESTED', 'OFFERED', 'ACCEPTED'];
    if (!allowedStates.includes(service.status)) {
      return res.status(403).json({ error: `No se puede cancelar un servicio en estado ${service.status}` });
    }

    // Actualizar status a CANCELED
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'CANCELED',
        driverId: null, // si estaba asignado, lo desasignamos
      },
    });

    // Opcional: notificar al conductor si estaba asignado
    if (service.driverId) {
      console.log(`Notificación pendiente: Conductor ${service.driverId} informado de cancelación`);
      // Aquí iría Socket.IO o push notification en el futuro
    }

    res.json({
      message: 'Servicio cancelado correctamente',
      service: updatedService,
    });
  } catch (error: any) {
    console.error('Error al cancelar servicio:', error);
    res.status(500).json({ error: 'Error interno al cancelar' });
  }
});

// HU-12: Conductor marca llegada al domicilio (inicio de espera)
app.patch('/services/:serviceId/arrive', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    // Solo conductores pueden marcar llegada
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden marcar llegada' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Verificar que este conductor esté asignado y el estado permita llegada
    const allowedStates = ['OFFERED', 'ACCEPTED'];
    if (service.driverId !== req.user.id || !allowedStates.includes(service.status)) {
      return res.status(403).json({ error: 'No puedes marcar llegada en este servicio' });
    }

    // Marcar llegada
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'ARRIVED',
        arrivedAt: new Date(),
      },
    });

    // Opcional: notificar al solicitante (futuro con Socket.IO o push)
    console.log(`Notificación pendiente: Solicitante informado que el conductor llegó`);

    res.json({
      message: 'Llegada confirmada. Iniciado control de espera',
      service: updatedService,
    });
  } catch (error: any) {
    console.error('Error al marcar llegada:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-13: Finalizar espera y calcular importe
app.patch('/services/:serviceId/finish-wait', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden finalizar espera' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.driverId !== req.user.id || service.status !== 'ARRIVED') {
      return res.status(403).json({ error: 'No puedes finalizar espera en este servicio o aún no llegó' });
    }

    if (!service.arrivedAt) {
      return res.status(400).json({ error: 'No se registró hora de llegada' });
    }

    const waitEndAt = new Date();

    // Tiempo de espera en minutos
    const waitDurationMinutes = Math.round(
      (waitEndAt.getTime() - service.arrivedAt.getTime()) / 1000 / 60
    );

    // Tarifas por MINUTO (más realista para pruebas y uso real)
    const tarifasPorMinuto = {
      TAXI: 10,     // 10 ARS/min
      TRAFIC: 20,   // 20 ARS/min
      MOTO: 5,      // 5 ARS/min
    };

    const tarifaMinuto = tarifasPorMinuto[service.type as keyof typeof tarifasPorMinuto] ?? 0;
    // Importe = minutos * tarifa/minuto
    let importe = waitDurationMinutes * tarifaMinuto;

    // Tarifa mínima (para que nunca sea casi 0)
    const minimo = 50; // 50 ARS mínimo
    if (importe < minimo) importe = minimo;

    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'COMPLETED',
        waitEndAt,
        amount: Number(importe.toFixed(2)),
      },
    });

    res.json({
      message: 'Espera finalizada. Importe calculado',
      service: {
        id: updatedService.id,
        status: updatedService.status,
        waitDurationMinutes,
        importe: updatedService.amount,
        currency: 'ARS',
      },
    });
  } catch (error: any) {
    console.error('Error al finalizar espera:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

//hdu 14 toca chema prisma y seed

// HU-15: Pago en efectivo (sin confirmación digital)
app.patch('/services/:serviceId/pay-cash', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Solo el solicitante puede marcar pago en efectivo
    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'Solo el solicitante puede registrar pago en efectivo' });
    }

    // Solo se puede pagar si ya finalizó la espera
    if (service.status !== 'COMPLETED') {
      return res.status(403).json({ error: 'El servicio debe estar completado para registrar pago' });
    }

    if (service.amount === null || service.amount <= 0) {
      return res.status(400).json({ error: 'No hay importe calculado para pagar' });
    }

    // Registrar pago en efectivo
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        paymentMethod: 'CASH',
        paidAt: new Date(),
        // status ya está COMPLETED, no cambiamos más
      },
    });

    res.json({
      message: 'Pago en efectivo registrado. No se requiere confirmación digital.',
      service: {
        id: updatedService.id,
        status: updatedService.status,
        paymentMethod: updatedService.paymentMethod,
        amount: updatedService.amount,
        paidAt: updatedService.paidAt,
      },
    });
  } catch (error: any) {
    console.error('Error al registrar pago en efectivo:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-16: Pago por billetera virtual (simulado con botón)
app.patch('/services/:serviceId/pay-wallet', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    // Traer el servicio incluyendo el solicitante (para acceder a su email)
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        requester: true,  // ESTO ES OBLIGATORIO: trae el objeto requester con email
      },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Solo el solicitante puede pagar
    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'Solo el solicitante puede registrar pago por billetera' });
    }

    // Solo se puede pagar si ya finalizó la espera
    if (service.status !== 'COMPLETED') {
      return res.status(403).json({ error: 'El servicio debe estar completado para pagar' });
    }

    if (service.amount === null || service.amount <= 0) {
      return res.status(400).json({ error: 'No hay importe calculado para pagar' });
    }

    // Simulación de pago (botón confirmado)
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        paymentMethod: 'WALLET',
        paidAt: new Date(),
      },
    });

    // Simulación de email (ahora accede al email real)
    console.log(
      `Email simulado enviado a ${service.requester?.email || 'solicitante'}: Pago por billetera confirmado por ${service.amount} ARS`
    );

    res.json({
      message: 'Pago por billetera virtual confirmado (simulado)',
      service: {
        id: updatedService.id,
        status: updatedService.status,
        paymentMethod: updatedService.paymentMethod,
        amount: updatedService.amount,
        paidAt: updatedService.paidAt,
      },
    });
  } catch (error: any) {
    console.error('Error al registrar pago por billetera:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
 
// HU-17: Notificación de pago confirmado (simulado en consola + log email)
app.patch('/services/:serviceId/confirm-payment', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        requester: true,  // Para obtener el email
      },
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Solo el solicitante puede confirmar pago
    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'Solo el solicitante puede confirmar pago' });
    }

    // Solo se puede confirmar si ya está pagado (después de pay-cash o pay-wallet)
    if (!service.paidAt) {
      return res.status(400).json({ error: 'El servicio aún no tiene pago registrado' });
    }

    // Actualizar status a PAID (estado final)
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        status: 'PAID',
      },
    });

    // Notificación simulada en consola (para app real sería push notification)
    console.log(
      `[NOTIFICACIÓN APP] Solicitante ${service.requester?.email || 'desconocido'}: Pago confirmado por ${service.amount} ARS (${service.paymentMethod})`
    );

    // Email simulado (más detallado)
    console.log(
      `Email simulado enviado a ${service.requester?.email || 'solicitante'}: 
      Pago confirmado!
      Servicio ID: ${serviceId}
      Método: ${service.paymentMethod}
      Importe: ${service.amount} ARS
      Fecha: ${new Date().toLocaleString()}
      ¡Gracias por usar la app!`
    );

    res.json({
      message: 'Pago confirmado. Estado actualizado a PAID.',
      service: {
        id: updatedService.id,
        status: updatedService.status,
        paymentMethod: service.paymentMethod,
        amount: service.amount,
        paidAt: service.paidAt,
      },
    });
  } catch (error: any) {
    console.error('Error al confirmar pago:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-18: Listado de servicios (para admin)
app.get('/admin/services', authenticate, async (req: any, res: any) => {
  try {
    // Solo admin puede ver el listado completo
    if (req.dbUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo administradores pueden ver el listado de servicios' });
    }

    const { status, type, startDate, endDate } = req.query;

    const whereClause: any = {};

    if (status) whereClause.status = status;
    if (type) whereClause.type = type;
    if (startDate || endDate) {
      whereClause.requestedAt = {};
      if (startDate) whereClause.requestedAt.gte = new Date(startDate as string);
      if (endDate) whereClause.requestedAt.lte = new Date(endDate as string);
    }

    const services = await prisma.service.findMany({
      where: whereClause,
      include: {
        requester: { select: { id: true, email: true } },
        driver: { select: { id: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 50, // límite para no cargar todo
    });

    res.json({
      message: 'Listado de servicios',
      total: services.length,
      services,
    });
  } catch (error: any) {
    console.error('Error en listado de servicios:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-19: Listado de conductores (para admin)
app.get('/admin/drivers', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo administradores pueden ver el listado de conductores' });
    }

    const { isOnline, vehicleType } = req.query;

    const whereClause: any = {};

    if (isOnline !== undefined) whereClause.isOnline = isOnline === 'true';
    if (vehicleType) whereClause.vehicleType = vehicleType;

    const drivers = await prisma.driverProfile.findMany({
      where: whereClause,
      include: {
        user: { select: { id: true, email: true, role: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    res.json({
      message: 'Listado de conductores',
      total: drivers.length,
      drivers: drivers.map((d: any) => ({
        userId: d.userId,
        email: d.user.email,
        role: d.user.role,
        vehicleType: d.vehicleType,
        isOnline: d.isOnline,
        lastLocation: d.lastLocation,
        updatedAt: d.updatedAt,
      })),
    });
  } catch (error: any) {
    console.error('Error en listado de conductores:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Endpoint para obtener usuario actual (protegido)
app.get('/users/me', authenticate, async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ user });
  } catch (error: any) {
    console.error('Error en /users/me:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Endpoint para obtener servicios del usuario actual (protegido)
app.get('/services/my', authenticate, async (req: any, res: any) => {
  try {
    const services = await prisma.service.findMany({
      where: {
        requesterId: req.user.id,
      },
      include: {
        driver: { select: { id: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 5,
    });

    res.json({
      message: 'Mis servicios',
      services,
    });
  } catch (error: any) {
    console.error('Error en /services/my:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/resend-confirmation', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email requerido' });
  }

  try {
    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (error) throw error;

    res.json({ message: 'Correo reenviado' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Error al reenviar correo' });
  }
});

app.post('/resend-confirmation', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email requerido' });
  }

  try {
    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (error) throw error;

    res.json({ message: 'Correo reenviado' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Error al reenviar correo' });
  }
});

// Servicios asignados al conductor actual (protegido)
app.get('/services/driver/my', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden ver sus servicios asignados' });
    }

    const services = await prisma.service.findMany({
      where: {
        driverId: req.user.id,
        status: { in: ['OFFERED', 'ACCEPTED', 'ARRIVED', 'COMPLETED'] },
      },
      include: {
        requester: { select: { id: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    });

    res.json({
      message: 'Mis servicios asignados',
      services,
    });
  } catch (error: any) {
    console.error('Error en /services/driver/my:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Aceptar oferta (solo conductor)
app.patch('/services/:serviceId/accept', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden aceptar ofertas' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.driverId !== req.user.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes aceptar este servicio' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'ACCEPTED' },
    });

    res.json({ message: 'Oferta aceptada', service: updated });
  } catch (error: any) {
    console.error('Error accept:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Rechazar oferta (ya lo tenés, pero por si acaso)
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

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'REJECTED', driverId: null },
    });

    res.json({ message: 'Oferta rechazada', service: updated });
  } catch (error: any) {
    console.error('Error reject:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Marcar llegada (ya lo tenés, pero asegúrate)
app.patch('/services/:serviceId/arrive', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'DRIVER') {
      return res.status(403).json({ error: 'Solo conductores pueden marcar llegada' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service || service.driverId !== req.user.id || service.status !== 'ACCEPTED') {
      return res.status(403).json({ error: 'No puedes marcar llegada en este servicio' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'ARRIVED', arrivedAt: new Date() },
    });

    res.json({ message: 'Llegada marcada', service: updated });
  } catch (error: any) {
    console.error('Error arrive:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
  console.log(`→ Health: /health`);
  console.log(`→ Usuarios: /users`);
  console.log(`→ Registro: POST /register`);
});