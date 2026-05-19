// src/index.ts - Versión completa, segura y corregida (build fix + 404 solucionado)
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import cors from 'cors';
import axios from 'axios';
import { SERVICE_TYPES, getServiceConfig } from './config/services';  


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


// HU-x: Mis servicios solicitados (para USER)
app.get('/services/my', authenticate, async (req: any, res: any) => {
  try {
    const services = await prisma.service.findMany({
      where: { requesterId: req.user.id },
      include: {
        professional: {
          select: { id: true, fullName: true, profession: true, rating: true }
        }
      },
      orderBy: { requestedAt: 'desc' },
    });

    res.json({
      message: 'Mis servicios solicitados',
      services
    });
  } catch (error: any) {
    console.error('Error en /services/my:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-12: Mis servicios como profesional (para PROFESSIONAL)
// HU-12: Mis servicios como profesional (CORREGIDO)
app.get('/services/professional/my', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden ver sus servicios' });
    }

    // Buscamos primero el registro en la tabla Professional
    const professional = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (!professional) {
      return res.json({
        message: 'Mis servicios como profesional',
        services: []
      });
    }

    const services = await prisma.service.findMany({
      where: { 
        professionalId: professional.id,           // ← CORREGIDO: usamos professional.id
        status: { 
          in: ['OFFERED', 'ACCEPTED', 'ARRIVED', 'COMPLETED'] 
        }
      },
      include: {
        requester: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      },
      orderBy: { requestedAt: 'desc' },
    });

    console.log(`📋 Profesional ${req.user.id} (Professional ID: ${professional.id}) - Servicios: ${services.length}`);

    res.json({
      message: 'Mis servicios como profesional',
      services
    });
  } catch (error: any) {
    console.error('Error en /services/professional/my:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});
  
// ==================== OTRAS RUTAS IMPORTANTES ====================
 
// HU-04: Registro como Profesional (anteriormente Driver)
app.post('/driver/profile', authenticate, async (req: any, res: any) => {
  const { vehicleType, profession } = req.body;

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Debes ser usuario para registrarte' });
    }

    const prof = await prisma.professional.upsert({
      where: { userId: req.user.id },
      update: {
        profession: profession || vehicleType,
        vehicleType: vehicleType || null,
        isActive: false,
        status: 'PENDING',
      },
      create: {
        userId: req.user.id,
        fullName: req.dbUser.email.split('@')[0], // Temporal
        profession: profession || vehicleType || 'Sin definir',
        vehicleType: vehicleType || null,
        isActive: false,
        status: 'PENDING',
      },
    });

    // Cambiar rol a USER (ya no usamos DRIVER)
    await prisma.user.update({
      where: { id: req.user.id },
      data: { role: 'USER' }
    });

    res.json({ 
      message: 'Perfil de profesional creado. Pendiente de aprobación.', 
      professional: prof 
    });

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Error interno' });
  }
});


 // Aceptar servicio
app.patch('/services/:serviceId/accept', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden aceptar' });
    }

    const professional = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (!professional) {
      return res.status(404).json({ error: 'Perfil profesional no encontrado' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId }
    });

    if (!service || service.professionalId !== professional.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes aceptar este servicio' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'ACCEPTED',
        acceptedAt: new Date()
      }
    });

    res.json({ message: 'Servicio aceptado', service: updated });
  } catch (error: any) {
    console.error('Error al aceptar servicio:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-09: Rechazar oferta + fallback automático
app.patch('/services/:serviceId/reject', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden rechazar' });
    }

    const professional = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (!professional) return res.status(404).json({ error: 'Perfil profesional no encontrado' });

    const service = await prisma.service.findUnique({
      where: { id: serviceId }
    });

    if (!service || service.professionalId !== professional.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    // Marcar como rechazado
    await prisma.service.update({
      where: { id: serviceId },
      data: { status: 'REJECTED', professionalId: null }
    });

    // Buscar siguiente profesional más cercano
    const professionals = await prisma.professional.findMany({
      where: {
        isActive: true,
        status: 'APPROVED',
        modalities: { hasSome: ['TIME_BASED'] },
        id: { not: professional.id }
      },
      include: { user: true }
    });

    if (professionals.length === 0) {
      return res.json({ message: 'Oferta rechazada. No hay más profesionales disponibles.' });
    }

    // Ordenar por cercanía (Haversine)
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    const candidates = professionals
      .map(p => {
        const loc = p.lastLocation as any;
        const distance = loc ? getDistance(service.pickupLat!, service.pickupLng!, loc.lat, loc.lng) : Infinity;
        return { professional: p, distance };
      })
      .sort((a, b) => a.distance - b.distance);

    const next = candidates[0].professional;

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { professionalId: next.id, status: 'OFFERED' }
    });

    res.json({
      message: 'Oferta rechazada. Asignada al siguiente profesional más cercano.',
      nextProfessionalId: next.id,
      distanceKm: candidates[0].distance.toFixed(2)
    });

  } catch (error: any) {
    console.error('Error al rechazar:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


app.patch('/services/:serviceId/arrive', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden marcar llegada' });
    }

    const professional = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    if (!professional) return res.status(404).json({ error: 'Perfil no encontrado' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });

    if (!service || service.professionalId !== professional.id || service.status !== 'ACCEPTED') {
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


// HU-13: Finalizar servicio + cálculo de importe (adaptado a Professional)
app.patch('/services/:serviceId/finish', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden finalizar' });
    }

    const professional = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (!professional) {
      return res.status(404).json({ error: 'Perfil profesional no encontrado' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId }
    });

    if (!service || service.professionalId !== professional.id || service.status !== 'ARRIVED') {
      return res.status(403).json({ error: 'Acción no permitida en este servicio' });
    }

    // Calcular importe real usando services.ts
    let amount = 100; // fallback
    try {
      const config = getServiceConfig(service.type);
      const minutesWorked = service.arrivedAt 
        ? Math.max(5, Math.round((new Date().getTime() - service.arrivedAt.getTime()) / 60000))
        : 10;

      amount = Math.max(config.basePrice, Math.round(minutesWorked * config.pricePerMinute));
    } catch (e) {
      console.log('Usando importe por defecto');
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'COMPLETED',
        completedAt: new Date(),
        amount
      }
    });

    console.log(`✅ Servicio ${serviceId} finalizado. Importe: ${amount} ARS`);

    res.json({ 
      message: 'Servicio finalizado correctamente', 
      service: updated,
      importe: amount 
    });
  } catch (error: any) {
    console.error('Error al finalizar servicio:', error);
    res.status(500).json({ error: 'Error interno al finalizar' });
  }
});

// HU-14: Calificar servicio (Usuario)
app.post('/services/:serviceId/rate', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  const { rating, review } = req.body; // rating: 1-5

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo los solicitantes pueden calificar' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { professional: true }
    });

    if (!service || service.requesterId !== req.user.id || service.status !== 'COMPLETED') {
      return res.status(403).json({ error: 'No puedes calificar este servicio' });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'La calificación debe estar entre 1 y 5' });
    }

    // Actualizar servicio con calificación
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        rating,
        review: review?.trim() || null,
      }
    });

    // Actualizar estadísticas del profesional
    if (service.professionalId) {
      const professional = await prisma.professional.findUnique({
        where: { id: service.professionalId }
      });

      if (professional) {
        const newCount = (professional.reviewCount || 0) + 1;
        const newRating = ((professional.rating || 0) * (newCount - 1) + rating) / newCount;

        await prisma.professional.update({
          where: { id: service.professionalId },
          data: {
            rating: parseFloat(newRating.toFixed(2)),
            reviewCount: newCount,
          }
        });

        console.log(`⭐ Profesional ${service.professionalId} calificado con ${rating} (${newCount} reseñas)`);
      }
    }

    res.json({
      message: 'Calificación registrada correctamente',
      service: updatedService,
      rating
    });

  } catch (error: any) {
    console.error('Error al calificar servicio:', error);
    res.status(500).json({ error: 'Error interno al calificar' });
  }
});
 
// HU-05: Activar/desactivar disponibilidad (En Línea) - Adaptado a Professional
app.patch('/professional/availability', authenticate, async (req: any, res: any) => {
  const { isOnline } = req.body;

  if (typeof isOnline !== 'boolean') {
    return res.status(400).json({ error: 'isOnline debe ser true o false' });
  }

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden cambiar disponibilidad' });
    }

    const updatedProfile = await prisma.professional.update({
      where: { userId: req.user.id },
      data: {
        isActive: isOnline,        // Usamos isActive en lugar de isOnline
        updatedAt: new Date(),
      },
    });

    console.log(`Professional ${req.user.id} cambió estado a ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

    res.json({
      message: `Disponibilidad actualizada a ${isOnline ? 'En Línea' : 'Fuera de Línea'}`,
      isOnline: updatedProfile.isActive,
    });
  } catch (error: any) {
    console.error('Error en /professional/availability:', error);
    
    // Si el perfil no existe, lo creamos
    if (error.code === 'P2025') {
      const newProfile = await prisma.professional.create({
        data: {
          userId: req.user.id,
          fullName: req.user.firstName && req.user.lastName 
            ? `${req.user.firstName} ${req.user.lastName}` 
            : 'Profesional',
          profession: 'General',        // valor por defecto
          isActive: isOnline,
          status: 'APPROVED',           // o 'PENDING' según tu flujo
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

// HU-04: Obtener / Crear perfil de Profesional
app.get('/professional/profile', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden ver su perfil' });
    }

    let profile = await prisma.professional.findUnique({
      where: { userId: req.user.id },
    });

    // Si no existe el perfil, lo creamos automáticamente
    if (!profile) {
      profile = await prisma.professional.create({
        data: {
          userId: req.user.id,
          fullName: req.user.firstName && req.user.lastName 
            ? `${req.user.firstName} ${req.user.lastName}` 
            : req.user.email.split('@')[0],
          profession: 'General',
          isActive: false,
          status: 'PENDING',
        },
      });
      console.log(`Perfil de profesional creado automáticamente para ${req.user.id}`);
    }

    res.json({
      message: 'Perfil de profesional obtenido',
      profile,
      role: req.dbUser.role
    });

  } catch (error: any) {
    console.error('Error en /professional/profile:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});


// HU-06.2: Actualizar ubicación en tiempo real del profesional
app.patch('/professional/location', authenticate, async (req: any, res: any) => {
  const { lat, lng } = req.body;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat y lng deben ser números válidos' });
  }

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden actualizar ubicación' });
    }

    const updated = await prisma.professional.update({
      where: { userId: req.user.id },
      data: {
        lastLocation: { lat, lng },
        updatedAt: new Date(),
      },
    });

    console.log(`📍 Profesional ${req.user.id} actualizó ubicación: (${lat}, ${lng})`);

    res.json({
      message: 'Ubicación actualizada correctamente',
      location: { lat, lng }
    });

  } catch (error: any) {
    console.error('Error actualizando ubicación:', error);
    res.status(500).json({ error: 'Error interno al actualizar ubicación' });
  }
});
 
// ==================== SOLICITAR SERVICIO - VERSIÓN MÍNIMA PARA DEBUG ====================
// ==================== SOLICITAR SERVICIO - VERSIÓN FINAL LIMPIA ====================
app.post('/services/request', authenticate, async (req: any, res: any) => {
  const { type, pickupLat, pickupLng } = req.body;

  console.log("🚀 [REQUEST] Endpoint alcanzado");
  console.log("Body recibido:", req.body);
  console.log("Usuario:", req.user?.id, "| Role:", req.dbUser?.role);

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo usuarios pueden solicitar servicios' });
    }

    if (!type || !pickupLat || !pickupLng) {
      return res.status(400).json({ error: 'type, pickupLat y pickupLng son obligatorios' });
    }

    const newService = await prisma.service.create({
      data: {
        requesterId: req.user.id,
        type: type as any,
        pickupLat: Number(pickupLat),
        pickupLng: Number(pickupLng),
        status: 'REQUESTED',
        requestedAt: new Date(),
      },
    });

    console.log(`✅ [REQUEST] Servicio creado correctamente - ID: ${newService.id}`);

    res.status(201).json({
      message: 'Servicio solicitado correctamente',
      serviceId: newService.id
    });

    // Intentamos asignar profesional
    try {
      const professionals = await prisma.professional.findMany({
        where: { 
          isActive: true, 
          status: 'APPROVED' 
        },
        take: 5
      });

      if (professionals.length > 0) {
      const selected = professionals[0];

      await prisma.service.update({
        where: { id: newService.id },
        data: {
          professionalId: selected.id,           // ← Cambiado de .userId a .id
          status: 'OFFERED',
        }
      });

        console.log(`🎯 [MATCH] Asignado a: ${selected.fullName} (${selected.userId})`);
      } else {
        console.log("⚠️ [MATCH] No hay profesionales disponibles");
      }
    } catch (matchError: any) {
      console.error("💥 Error en matching:", matchError?.message || matchError);
    }

  } catch (error: any) {
    console.error("💥 [REQUEST] Error grave:", error);
    res.status(500).json({ 
      error: 'Error interno al solicitar servicio',
      details: error.message 
    });
  }
});
// =============================================
// PROFESIONALES DESTACADOS (Suscripción Premium)
// =============================================

// HU-20: Listado de Profesionales Destacados
app.get('/professionals', async (req: any, res: any) => {
  const { search, profession } = req.query;

  try {
    const where: any = { 
      isActive: true,
      status: 'APPROVED'
    };

    if (profession) {
      where.profession = { contains: profession, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { profession: { contains: search, mode: 'insensitive' } },
      ];
    }

    const professionals = await prisma.professional.findMany({
      where,
      include: { 
        user: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      },
      orderBy: [
        { rating: 'desc' },
        { reviewCount: 'desc' }
      ],
      take: 30,
    });

    // Top profesionales según calificaciones de servicios
    const topProfessionals = await prisma.service.groupBy({
      by: ['professionalId'],
      where: {
        rating: { not: null },
        professionalId: { not: null }
      },
      _avg: { rating: true },
      _count: { id: true },
      having: {
        rating: { _avg: { gte: 4.0 } },
        id: { _count: { gte: 3 } }
      },
    });

    res.json({
      message: 'Profesionales destacados',
      professionals,
      topRatedCount: topProfessionals.length
    });

  } catch (error: any) {
    console.error('Error al obtener profesionales:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-21: Obtener detalle de un profesional
app.get('/professionals/:id', async (req: any, res: any) => {
  const { id } = req.params;

  try {
    const professional = await prisma.professional.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });

    if (!professional) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    res.json({
      message: 'Detalle del profesional',
      professional
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-23: Registro como Prestador de Servicios 
// HU-23: Registro como Prestador de Servicios 
app.post('/professionals/register', authenticate, async (req: any, res: any) => {
  const { 
    fullName, 
    profession, 
    description, 
    phone, 
    address, 
    dniFrontUrl, 
    dniBackUrl, 
    certificateUrl,
    modalities 
  } = req.body;

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Debes ser usuario para registrarte como prestador' });
    }

    if (!fullName || !profession || !phone || !modalities || modalities.length === 0) {
      return res.status(400).json({ error: 'Nombre, profesión, teléfono y modalidad son obligatorios' });
    }

    const professional = await prisma.professional.create({
      data: {
        userId: req.user.id,
        fullName: fullName.trim(),
        profession: profession.trim(),
        description: description?.trim() || '',
        phone: phone.trim(),
        address: address?.trim() || '',
        dniFrontUrl,
        dniBackUrl,
        certificateUrl,
        modalities: modalities || ['TIME_BASED'],   // Default seguro
        isActive: false,
        status: 'PENDING',
        vehicleType: profession,   // ← Guardamos la profesión también aquí
      }
    });

    console.log(`📋 Nueva solicitud: ${fullName} - ${profession} - Modalidades: ${modalities}`);

    res.status(201).json({
      message: 'Solicitud enviada correctamente. Pendiente de aprobación.',
      professionalId: professional.id
    });

  } catch (error: any) {
    console.error('Error al registrar prestador:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// HU-24: Aprobar / Rechazar solicitud de Prestador (Admin)
app.patch('/professionals/:id/status', authenticate, async (req: any, res: any) => {
  const { id } = req.params;
  const { status } = req.body; // APPROVED o REJECTED

  try {
    if (req.dbUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo administradores pueden hacer esto' });
    }

    const professional = await prisma.professional.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!professional) return res.status(404).json({ error: 'Profesional no encontrado' });

    await prisma.professional.update({
      where: { id },
      data: { 
        status,
        isActive: status === 'APPROVED'
      }
    });

    // Si se aprueba → Cambiar rol del usuario a PROFESSIONAL
    if (status === 'APPROVED') {
      await prisma.user.update({
        where: { id: professional.userId },
        data: { role: 'PROFESSIONAL' }
      });
      console.log(`✅ Usuario ${professional.userId} promovido a PROFESSIONAL`);
    }

    res.json({ message: `Profesional ${status === 'APPROVED' ? 'aprobado' : 'rechazado'} correctamente` });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});