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

  let dbUser = await prisma.user.findUnique({ 
    where: { id: user.id } 
  });

  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        id: user.id,
        email: user.email!,
        password: "supabase-auth",
        role: 'USER',
        firstName: null,
        lastName: null,
        address: null,
        photoUrl: null,
      }
    });
    console.log(`✅ Nuevo usuario creado en Prisma: ${user.email}`);
  }

  req.user = user;
  req.dbUser = dbUser;
  next();
};

// ==================== RUTAS CRÍTICAS ====================

app.get('/health', (req, res) => res.json({ status: 'OK' }));

app.get('/users/me', authenticate, async (req: any, res: any) => {
  const userData = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true,
      email: true,
      role: true,
      firstName: true,
      lastName: true,
      photoUrl: true,
      address: true,
    }
  });

  res.json({ user: userData });
});

// HU-5: Mis servicios solicitados (para USER)
// HU-5: Mis servicios solicitados (para USER) - Versión ULTRA MINIMAL
// HU-5: Mis servicios solicitados (para USER) - Versión MÍNIMA para debug
app.get('/services/my', authenticate, async (req: any, res: any) => {
  try {
    console.log(`🔍 [SERVICES/MY] Iniciando consulta para usuario: ${req.user.id}`);

    // Consulta ULTRA SIMPLE
    const services = await prisma.service.findMany({
      where: { 
        requesterId: req.user.id 
      }
    });

    console.log(`✅ [SERVICES/MY] Consulta exitosa - Servicios encontrados: ${services.length}`);

    res.json({
      message: 'Mis servicios',
      services: services || []
    });

  } catch (error: any) {
    console.error('💥 [SERVICES/MY] ERROR CRÍTICO:', error);
    console.error('💥 Mensaje:', error.message);
    console.error('💥 Código:', error.code);
    
    res.status(500).json({ 
      error: 'Error al cargar servicios',
      details: error.message,
      code: error.code
    });
  }
});

// Endpoint de debug temporal
app.get('/debug/user', authenticate, async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { services: true }
    });
    res.json({ user });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// HU-16: Mis servicios como profesional (CORREGIDO)
app.get('/services/professional/my', authenticate, async (req: any, res: any) => {
  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden ver sus servicios' });
    }

    const professional = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (!professional) {
      console.log(`⚠️ [PROFESSIONAL/MY] Usuario ${req.user.id} no tiene perfil profesional`);
      return res.json({
        message: 'Mis servicios como profesional',
        services: []
      });
    }

    const services = await prisma.service.findMany({
      where: { 
        professionalId: professional.id,
        status: { 
          in: ['OFFERED', 'ACCEPTED', 'ARRIVED', 'COMPLETED'] 
        }
      },
      include: {
        requester: {
          select: { 
            id: true, 
            firstName: true, 
            lastName: true, 
            email: true 
          }
        }
      },
      orderBy: { requestedAt: 'desc' },
    });

    console.log(`📋 [PROFESSIONAL/MY] Profesional ${professional.fullName} (${professional.profession}) → ${services.length} servicios`);

    res.json({
      message: 'Mis servicios como profesional',
      services,
      professional: {
        id: professional.id,
        fullName: professional.fullName,
        profession: professional.profession
      }
    });

  } catch (error: any) {
    console.error('💥 [PROFESSIONAL/MY] Error:', error);
    res.status(500).json({ error: 'Error interno al obtener servicios' });
  }
});

// ==================== OTRAS RUTAS IMPORTANTES ====================
 
// HU-07: Registro como Profesional (anteriormente Driver)
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


 //hdu-8 Aceptar servicio
app.patch('/services/:serviceId/accept', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden aceptar servicios' });
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

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.professionalId !== professional.id) {
      return res.status(403).json({ error: 'Este servicio no te fue asignado' });
    }

    if (service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'Este servicio ya no está disponible para aceptar' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'ACCEPTED',
        acceptedAt: new Date()
      }
    });

    console.log(`✅ [ACCEPT] Servicio ${serviceId} aceptado por ${professional.fullName} (${professional.profession})`);

    res.json({ 
      message: 'Servicio aceptado correctamente',
      service: updated 
    });

  } catch (error: any) {
    console.error('💥 Error al aceptar servicio:', error);
    res.status(500).json({ error: 'Error interno al aceptar el servicio' });
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

    if (!professional) {
      return res.status(404).json({ error: 'Perfil profesional no encontrado' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId }
    });

    if (!service || service.professionalId !== professional.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    console.log(`🔄 [REJECT] Servicio ${serviceId} rechazado por ${professional.fullName} (${professional.profession})`);

    // Marcar como rechazado y limpiar profesional
    await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'REJECTED', 
        professionalId: null 
      }
    });

    // ==================== BUSCAR SIGUIENTE PROFESIONAL ====================
    const professionals = await prisma.professional.findMany({
      where: {
        isActive: true,
        status: 'APPROVED',
        profession: service.type,           // ← Filtrado por profesión exacta
        id: { not: professional.id }        // Excluir al que rechazó
      },
      include: { user: true }
    });

    if (professionals.length === 0) {
      console.log(`⚠️ [REJECT] No hay más profesionales de ${service.type} disponibles`);
      return res.json({ 
        message: `Oferta rechazada. No hay más profesionales de ${service.type} disponibles.` 
      });
    }

    console.log(`📍 [REJECT] Encontrados ${professionals.length} profesionales de ${service.type}`);

    // Función Haversine
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Calcular distancia y ordenar
    const candidates = professionals
      .map(p => {
        const loc = p.lastLocation as any;
        const distance = loc?.lat && loc?.lng 
          ? getDistance(service.pickupLat!, service.pickupLng!, loc.lat, loc.lng) 
          : Infinity;
        
        return { professional: p, distance };
      })
      .sort((a, b) => a.distance - b.distance);

    const next = candidates[0].professional;

    // Reasignar servicio
    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { 
        professionalId: next.id, 
        status: 'OFFERED' 
      }
    });

    console.log(`✅ [REASSIGN] Reasignado a ${next.fullName} - Distancia: ${candidates[0].distance.toFixed(2)} km`);

    res.json({
      message: 'Oferta rechazada. Asignada al siguiente profesional más cercano.',
      nextProfessionalId: next.id,
      nextProfessionalName: next.fullName,
      distanceKm: candidates[0].distance.toFixed(2)
    });

  } catch (error: any) {
    console.error('💥 Error al rechazar servicio:', error);
    res.status(500).json({ error: 'Error interno al rechazar el servicio' });
  }
});


// HU-23: Marcar llegada
app.patch('/services/:serviceId/arrive', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden marcar llegada' });
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

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.professionalId !== professional.id) {
      return res.status(403).json({ error: 'Este servicio no te fue asignado' });
    }

    if (service.status !== 'ACCEPTED') {
      return res.status(403).json({ error: 'El servicio debe estar en estado ACCEPTED para marcar llegada' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'ARRIVED',
        arrivedAt: new Date()
      }
    });

    console.log(`📍 [ARRIVE] Profesional ${professional.fullName} marcó llegada al servicio ${serviceId}`);

    res.json({ 
      message: 'Llegada registrada correctamente',
      service: updated 
    });

  } catch (error: any) {
    console.error('💥 Error al marcar llegada:', error);
    res.status(500).json({ error: 'Error interno al marcar llegada' });
  }
});

// HU-13: Finalizar servicio + cálculo de importe (adaptado a Professional)
app.patch('/services/:serviceId/finish', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden finalizar el servicio' });
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

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.professionalId !== professional.id) {
      return res.status(403).json({ error: 'Este servicio no te fue asignado' });
    }

    if (service.status !== 'ARRIVED') {
      return res.status(403).json({ error: 'El servicio debe estar en estado ARRIVED para finalizar' });
    }

    // ==================== DETECCIÓN DE TIPO DE SERVICIO ====================
    const serviceConfig = SERVICE_TYPES.find(s => s.key === service.type);
    const isFixedPrice = serviceConfig && 
                        serviceConfig.pricePerMinute === 0 && 
                        serviceConfig.basePrice === 0;

    // ====================== SERVICIO POR PRESUPUESTO ======================
    if (isFixedPrice) {
      const updated = await prisma.service.update({
        where: { id: serviceId },
        data: { 
          status: 'COMPLETED',
          completedAt: new Date()
          // amount queda null o vacío → el usuario lo ingresará después
        }
      });

      console.log(`⏳ [FINISH-FIXED] Servicio por presupuesto #${serviceId} marcado como COMPLETED por profesional. Esperando monto del cliente.`);

      return res.json({ 
        message: 'Trabajo finalizado. Esperando que el cliente ingrese el monto acordado.',
        isFixedPrice: true,
        service: updated
      });
    }

    // ====================== SERVICIO POR TIEMPO ======================
    let amount = 100; // fallback
    try {
      const config = getServiceConfig(service.type);
      const minutesWorked = service.arrivedAt 
        ? Math.max(5, Math.round((Date.now() - service.arrivedAt.getTime()) / 60000))
        : 10;

      amount = Math.max(config.basePrice, Math.round(minutesWorked * config.pricePerMinute));
    } catch (e) {
      console.log(`⚠️ [FINISH] Usando importe por defecto para servicio ${serviceId}`);
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'COMPLETED',
        completedAt: new Date(),
        amount
      }
    });

    console.log(`✅ [FINISH] Servicio por tiempo #${serviceId} finalizado | Importe: $${amount}`);

    res.json({ 
      message: 'Servicio finalizado correctamente', 
      service: updated,
      importe: amount 
    });

  } catch (error: any) {
    console.error('💥 [FINISH] Error al finalizar servicio:', error);
    res.status(500).json({ error: 'Error interno al finalizar el servicio' });
  }
});

// HU-14: Calificar servicio (Usuario)
app.post('/services/:serviceId/rate', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  const { rating, review } = req.body;

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo los solicitantes pueden calificar servicios' });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'La calificación debe estar entre 1 y 5 estrellas' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { 
        professional: true 
      }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'No puedes calificar un servicio que no solicitaste' });
    }

    if (service.status !== 'COMPLETED') {
      return res.status(403).json({ error: 'Solo se puede calificar servicios completados' });
    }

    if (service.rating) {
      return res.status(400).json({ error: 'Este servicio ya fue calificado' });
    }

    // Actualizar calificación del servicio
    const updatedService = await prisma.service.update({
      where: { id: serviceId },
      data: {
        rating: Number(rating),
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
        const currentRating = professional.rating || 0;
        const newRating = ((currentRating * (newCount - 1)) + Number(rating)) / newCount;

        await prisma.professional.update({
          where: { id: service.professionalId },
          data: {
            rating: parseFloat(newRating.toFixed(2)),
            reviewCount: newCount,
          }
        });

        console.log(`⭐ [RATE] Profesional ${professional.fullName} (${professional.profession}) calificado con ${rating} estrellas (${newCount} reseñas)`);
      }
    }

    console.log(`✅ [RATE] Servicio ${serviceId} calificado con ${rating} estrellas`);

    res.json({
      message: 'Calificación registrada correctamente',
      service: updatedService,
      rating: Number(rating)
    });

  } catch (error: any) {
    console.error('💥 [RATE] Error al calificar servicio:', error);
    res.status(500).json({ error: 'Error interno al registrar la calificación' });
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
 
// ==================== SOLICITAR SERVICIO
// HU-20: Solicitud de servicio con matching inteligente por profesión + modalidad + cercanía
app.post('/services/request', authenticate, async (req: any, res: any) => {
  const { type, pickupLat, pickupLng } = req.body;

  console.log("🚀 [REQUEST] Solicitud recibida - Type:", type);

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

    console.log(`✅ [REQUEST] Servicio creado - ID: ${newService.id}`);

    // ==================== MATCHING INTELIGENTE ====================
    const professionals = await prisma.professional.findMany({
      where: {
        isActive: true,
        status: 'APPROVED',
        profession: type,                    // ← Filtrar por profesión exacta
      },
      include: {
        user: true
      }
    });

    if (professionals.length === 0) {
      console.log(`⚠️ No hay profesionales de ${type} disponibles`);
      return res.status(201).json({
        message: 'Servicio solicitado correctamente',
        serviceId: newService.id,
        warning: 'No hay profesionales disponibles en este momento'
      });
    }

    // Función de distancia (Haversine)
    const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371; // Radio de la Tierra en km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    // Calcular distancia y ordenar
    const professionalsWithDistance = professionals
      .map(prof => {
        const loc = prof.lastLocation as any;
        const distance = loc && loc.lat && loc.lng 
          ? getDistance(Number(pickupLat), Number(pickupLng), loc.lat, loc.lng)
          : Infinity;
        
        return { ...prof, distance };
      })
      .sort((a, b) => a.distance - b.distance);

    const bestMatch = professionalsWithDistance[0];

    // Asignar al profesional más cercano
    await prisma.service.update({
      where: { id: newService.id },
      data: {
        professionalId: bestMatch.id,
        status: 'OFFERED',
      }
    });

    console.log(`🎯 [MATCH] Asignado a ${bestMatch.fullName} - Distancia: ${bestMatch.distance.toFixed(2)} km`);

    res.status(201).json({
      message: 'Servicio solicitado correctamente',
      serviceId: newService.id,
      assignedTo: bestMatch.fullName,
      distanceKm: bestMatch.distance.toFixed(2)
    });

  } catch (error: any) {
    console.error("💥 [REQUEST] Error:", error);
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
  const { search, profession, lat, lng } = req.query;

  try {
    console.log(`📋 [PROFESSIONALS] Listado solicitado | Search: ${search} | Profession: ${profession}`);

    const where: any = { 
      isActive: true,
      status: 'APPROVED'
    };

    // Filtro por profesión específica
    if (profession) {
      where.profession = { 
        contains: profession as string, 
        mode: 'insensitive' 
      };
    }

    // Búsqueda general
    if (search) {
      where.OR = [
        { fullName: { contains: search as string, mode: 'insensitive' } },
        { profession: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const professionals = await prisma.professional.findMany({
      where,
      include: { 
        user: {
          select: { id: true, firstName: true, lastName: true }
        }
      },
      orderBy: [
        { rating: 'desc' },
        { reviewCount: 'desc' },
        { createdAt: 'desc' }
      ],
      take: 50,
    });

    console.log(`✅ [PROFESSIONALS] ${professionals.length} profesionales encontrados`);

    res.json({
      message: 'Profesionales disponibles',
      professionals,
      total: professionals.length,
      filters: { search, profession }
    });

  } catch (error: any) {
    console.error('💥 [PROFESSIONALS] Error al obtener listado:', error);
    res.status(500).json({ error: 'Error interno al obtener profesionales' });
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
          select: { id: true, firstName: true, lastName: true }
        }
      }
    });

    if (!professional) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    // Obtener todas las reseñas (reviews) de los servicios completados
    const reviews = await prisma.service.findMany({
      where: {
        professionalId: id,
        rating: { not: null },        // Solo servicios calificados
        status: 'COMPLETED'
      },
      include: {
        requester: {
          select: { 
            firstName: true, 
            lastName: true 
          }
        }
      },
      orderBy: { completedAt: 'desc' },
      take: 15
    });

    res.json({
      message: 'Detalle del profesional',
      professional,
      reviews: reviews.map(r => ({
        id: r.id,
        rating: r.rating,
        review: r.review,
        requesterName: r.requester 
          ? `${r.requester.firstName} ${r.requester.lastName}`.trim() 
          : 'Cliente anónimo',
        date: r.completedAt
      }))
    });

  } catch (error: any) {
    console.error('Error al obtener profesional:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

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

    // ←←←←←←←←←← AGREGAR ESTA VALIDACIÓN ←←←←←←←←←←
    const existing = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'Ya tienes una solicitud de profesional registrada.' 
      });
    }
    // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←

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

// HU-25: Finalizar servicio por presupuesto (usuario ingresa monto)
app.patch('/services/:serviceId/finish-fixed', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  const { amount } = req.body;

  try {
    if (req.dbUser.role !== 'USER') {                    // ← Esta línea es crítica
      return res.status(403).json({ error: 'Solo el solicitante puede ingresar el monto' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { professional: true, requester: true }
    });

    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'No puedes modificar este servicio' });
    }

    if (service.status !== 'COMPLETED') {               // ← Cambiado a COMPLETED
      return res.status(403).json({ error: 'El servicio debe estar en estado COMPLETED' });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { 
        amount: Number(amount),
        // status ya está en COMPLETED
      }
    });

    console.log(`💰 [FINISH-FIXED] Monto ingresado: $${amount} para servicio ${serviceId}`);

    res.json({
      message: 'Monto registrado correctamente',
      service: updated,
      importe: Number(amount)
    });

  } catch (error: any) {
    console.error('💥 [FINISH-FIXED] Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ==================== CHAT ====================
 
// Enviar mensaje en un servicio
app.post('/services/:serviceId/messages', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  const { content } = req.body;

  try {
    if (!content?.trim()) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }

    // Traemos el servicio CON las relaciones necesarias
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        professional: true,     // ← Necesario para verificar
        requester: true         // ← Necesario para verificar
      }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Verificar que el usuario sea parte del servicio (requester o professional)
    const isRequester = service.requesterId === req.user.id;
    const isProfessional = service.professional?.userId === req.user.id;

    if (!isRequester && !isProfessional) {
      return res.status(403).json({ error: 'No tienes permiso para chatear en este servicio' });
    }

    const message = await prisma.message.create({
      data: {
        serviceId,
        senderId: req.user.id,
        receiverId: isRequester 
          ? service.professional!.userId 
          : service.requesterId,
        content: content.trim()
      },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true }
        }
      }
    });

    console.log(`💬 [MESSAGE] Mensaje enviado en servicio ${serviceId}`);

    res.status(201).json({ 
      message: 'Mensaje enviado correctamente',
      data: message 
    });

  } catch (error: any) {
    console.error('💥 Error al enviar mensaje:', error);
    res.status(500).json({ error: 'Error interno al enviar el mensaje' });
  }
});

// Obtener mensajes de un servicio
app.get('/services/:serviceId/messages', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    // Incluimos las relaciones necesarias
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        professional: true,   // ← Necesario
        requester: true       // ← Necesario
      }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Verificar que el usuario tenga acceso (es el requester o el professional)
    const isRequester = service.requesterId === req.user.id;
    const isProfessionalUser = service.professional?.userId === req.user.id;

    if (!isRequester && !isProfessionalUser) {
      return res.status(403).json({ error: 'No tienes permiso para ver estos mensajes' });
    }

    const messages = await prisma.message.findMany({
      where: { serviceId },
      include: {
        sender: {
          select: { 
            id: true, 
            firstName: true, 
            lastName: true 
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({ messages });

  } catch (error: any) {
    console.error('💥 Error al obtener mensajes:', error);
    res.status(500).json({ error: 'Error al obtener los mensajes' });
  }
});

// HU-30: Actualizar perfil de usuario (Nombre, foto, dirección, etc.)
app.patch('/users/me', authenticate, async (req: any, res: any) => {
  const { firstName, lastName, photoUrl, address } = req.body;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        firstName: firstName?.trim() || undefined,
        lastName: lastName?.trim() || undefined,
        photoUrl: photoUrl?.trim() || undefined,
        address: address?.trim() || undefined,
        updatedAt: new Date(),
      }
    });

    console.log(`✅ Perfil actualizado para usuario ${req.user.id}`);

    res.json({
      message: 'Perfil actualizado correctamente',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        photoUrl: updatedUser.photoUrl,
        address: updatedUser.address,
      }
    });

  } catch (error: any) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ error: 'Error interno al actualizar perfil' });
  }
});

// HU-31: Subir foto de perfil (Bucket público)
app.post('/users/me/photo', authenticate, async (req: any, res: any) => {
  const { photoUrl } = req.body;   // URL temporal desde el frontend (después de subir a Supabase)

  try {
    if (!photoUrl) {
      return res.status(400).json({ error: 'photoUrl es requerido' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { photoUrl }
    });

    console.log(`📸 Foto de perfil actualizada para usuario ${req.user.id}`);

    res.json({
      message: 'Foto de perfil actualizada correctamente',
      photoUrl: updatedUser.photoUrl
    });

  } catch (error: any) {
    console.error('Error al actualizar foto:', error);
    res.status(500).json({ error: 'Error interno al actualizar foto' });
  }
});

// ==================== REGISTRO DE USUARIO ====================
app.post('/register', async (req: any, res: any) => {
  const { id, email, firstName, lastName, address, photoUrl } = req.body;

  try {
    // Crear o actualizar usuario en Prisma
    const user = await prisma.user.upsert({
      where: { id },
      update: {
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        address: address?.trim() || null,
        photoUrl: photoUrl || null,
      },
      create: {
        id,
        email,
        password: "supabase-auth", // No usamos contraseña local
        role: 'USER',
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        address: address?.trim() || null,
        photoUrl: photoUrl || null,
      },
    });

    console.log(`✅ Usuario registrado/actualizado: ${email} (${user.id})`);

    res.status(201).json({
      message: 'Usuario registrado correctamente',
      user
    });

  } catch (error: any) {
    console.error('Error en /register:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});