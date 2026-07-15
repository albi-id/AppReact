// src/index.ts - Versión completa, segura y corregida (build fix + 404 solucionado)
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import cors from 'cors';
import axios from 'axios';
import { SERVICE_TYPES, getServiceConfig } from './config/services';  
import rateLimit from 'express-rate-limit';
 
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

// Logging de requests para debug rate limit
app.use((req, res, next) => {
  console.log(`📡 [REQUEST] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

/*
// ==================== RATE LIMITING ====================
const limiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minuto
  max: 120,                    // máximo 60 requests por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Demasiadas solicitudes. Por favor intenta más tarde.'
  }
});

// Rate limit  
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutos
  max: 10,                    // máximo 10 intentos de login/register
  message: { error: 'Demasiados intentos. Intenta más tarde.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,                    // 40 requests por minuto   
});

// Rate Limiter más estricto para endpoints críticos
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minuto
  max: 150,               
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Estás buscando muy rápido. Espera unos segundos.' }
});

// Aplicar a middlewares
app.use(limiter);                    // Global  
app.use('/register', authLimiter);
app.use('/login', authLimiter);       
app.use('/services/request', apiLimiter);   // Endpoint crítico
app.use('/upload', apiLimiter);
app.use('/professionals', strictLimiter);   
*/

const port = Number(process.env.PORT) || 10000;

// ==================== MIDDLEWARE SEGURO ==================== 
const authenticate = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    console.log(`🔐 [AUTH] Intentando autenticar...`);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    const token = authHeader.split(' ')[1];

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.log('❌ [AUTH] Token inválido');
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    console.log(`✅ [AUTH] Usuario Supabase: ${user.email} (${user.id})`);

    // === BUSCAR POR ID ===
    let dbUser = await prisma.user.findUnique({
      where: { id: user.id }
    });

    // === SI NO EXISTE POR ID, BUSCAR POR EMAIL ===
    if (!dbUser) {
      dbUser = await prisma.user.findUnique({
        where: { email: user.email! }
      });
    }

    // === SI NO EXISTE, CREAR ===
    if (!dbUser) {
      console.log(`🆕 [AUTH] Creando nuevo usuario en Prisma...`);
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
      console.log(`✅ [AUTH] Usuario creado correctamente`);
    } 
    // === SI EXISTE PERO EL ID ES DIFERENTE (conflicto), ACTUALIZARLO ===
    else if (dbUser.id !== user.id) {
      console.log(`🔄 [AUTH] Actualizando ID del usuario (conflicto anterior)`);
      dbUser = await prisma.user.update({
        where: { id: dbUser.id },
        data: { id: user.id }
      });
    }

    console.log(`✅ [AUTH] Usuario listo en Prisma: ${dbUser.email} (${dbUser.id})`);

    req.user = user;
    req.dbUser = dbUser;
    next();

  } catch (error: any) {
    console.error('💥 [AUTH] ERROR CRÍTICO:', error.message);
    res.status(500).json({ error: 'Error de autenticación interna' });
  }
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
      cityId: true,        // ← Agregar
      provinceId: true,
    }
  });

  res.json({ user: userData });
});

 
// HU-5: Mis servicios solicitados (para USER) - Optimizado
app.get('/services/my', authenticate, async (req: any, res: any) => {
  try {
    const services = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        s.id,
        s."requesterId",
        s."professionalId",
        s.type,
        s."pickupLat",
        s."pickupLng",
        s."pickupAddress", 
        s.status,
        s.amount,
        s.rating,
        s.review,
        s."requestedAt",
        s."acceptedAt",
        s."arrivedAt",
        s."completedAt",
        s."paidAt",
        p.id as "professionalId",
        p."fullName",
        p.profession,
        p.rating as "professionalRating",
        p."reviewCount",
        COALESCE(
          ST_Distance(
            ST_MakePoint(s."pickupLng"::float, s."pickupLat"::float)::geography,
            p."lastLocation"::geography
          ) / 1000,
          0
        ) as "distanceKm"
      FROM "services" s
      LEFT JOIN "professionals" p ON p.id = s."professionalId"
      WHERE s."requesterId" = $1
      ORDER BY s."requestedAt" DESC;
    `, req.user.id);

    const formattedServices = services.map((service: any) => ({
      id: service.id,
      type: service.type,
      pickupLat: service.pickupLat,
      pickupLng: service.pickupLng,
      pickupAddress: service.pickupAddress,
      status: service.status,
      amount: service.amount,
      rating: service.rating,
      review: service.review,
      requestedAt: service.requestedAt,
      acceptedAt: service.acceptedAt,
      cityId: service.cityId,
      provinceId: service.provinceId,
      arrivedAt: service.arrivedAt,
      completedAt: service.completedAt,
      paidAt: service.paidAt,
      
      professional: service.professionalId ? {
        id: service.professionalId,
        fullName: service.fullName || 'Profesional',
        profession: service.profession,
        rating: parseFloat(service.professionalRating || 0),
        reviewCount: service.reviewCount || 0,
      } : null,
      
      distanceKm: Number(parseFloat(service.distanceKm || 0).toFixed(2)),
    }));

    console.log(`📋 [SERVICES/MY] Usuario ${req.user.id} → ${services.length} servicios`);

    res.json({
      message: 'Mis servicios',
      services: formattedServices
    });

  } catch (error: any) {
    console.error('💥 [SERVICES/MY] Error:', error);
    res.status(500).json({ 
      error: 'Error interno al cargar servicios',
      details: error.message 
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

 
// HU-16: Mis servicios como profesional (CON DISTANCIA)
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

// ==================== CONSULTA CON POSTGIS ====================
    const services = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        s.id,
        s."requesterId",
        s."professionalId",
        s.type,
        s."pickupLat",
        s."pickupLng",
        s."pickupAddress", 
        s."pickupAddressExtra",
        s.reference,
        s.floor,
        s."doorNumber",
        s."pickupAddressExtra",
        s.status,
        s.amount,
        s.rating,
        s.review,
        s."requestedAt",
        s."acceptedAt",
        s."arrivedAt",
        s."completedAt",
        s."paidAt",
        r.id as "requesterId",
        r."firstName",
        r."lastName",
        r.email,
        COALESCE(
          ST_Distance(
            ST_MakePoint(s."pickupLng"::float, s."pickupLat"::float)::geography,
            p."lastLocation"::geography
          ) / 1000,
          0
        ) as "distanceKm"
      FROM "services" s
      LEFT JOIN "users" r ON r.id = s."requesterId"
      LEFT JOIN "professionals" p ON p.id = s."professionalId"
      WHERE s."professionalId" = $1
        AND s.status IN ('OFFERED', 'ACCEPTED', 'ARRIVED', 'COMPLETED')
      ORDER BY s."requestedAt" DESC;
    `, professional.id);

/*    // Formateo manteniendo la misma estructura que tenías
    const formattedServices = services.map((service: any) => {
      const distanceKm = service.distanceKm 
        ? parseFloat(service.distanceKm).toFixed(2) 
        : "0.00";

      return {
        ...service,
        requester: service.requesterId ? {
          id: service.requesterId,
          firstName: service.firstName,
          lastName: service.lastName,
          email: service.email,
          fullName: [service.firstName, service.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Usuario'
        } : null,
        distanceKm: Number(distanceKm),
      };
    });

    console.log(`📋 [PROFESSIONAL/MY] Profesional ${professional.fullName} → ${services.length} servicios`);

    res.json({
      message: 'Mis servicios como profesional',
      services: formattedServices,
      professional: {
        id: professional.id,
        fullName: professional.fullName,
        profession: professional.profession
      }
    });
*/

        // Formateo manteniendo la misma estructura que tenías
    const formattedServices = services.map((service: any) => {
      const distanceKm = service.distanceKm 
        ? parseFloat(service.distanceKm).toFixed(2) 
        : "0.00";

      return {
        id: service.id,
        type: service.type,
        status: service.status,
        amount: service.amount,
        requestedAt: service.requestedAt,
        acceptedAt: service.acceptedAt,
        arrivedAt: service.arrivedAt,
        completedAt: service.completedAt,
        paidAt: service.paidAt,
        pickupLat: service.pickupLat,
        pickupLng: service.pickupLng,

        // === NUEVOS CAMPOS DE DIRECCIÓN ===
        pickupAddress: service.pickupAddress,
        pickupAddressExtra: service.pickupAddressExtra,
        reference: service.reference,
        floor: service.floor,
        doorNumber: service.doorNumber,

        distanceKm: Number(distanceKm),

        // === ESTRUCTURA DEL REQUESTER (mantener exactamente como estaba) ===
        requester: service.requesterId ? {
          id: service.requesterId,
          firstName: service.firstName,
          lastName: service.lastName,
          email: service.email,
          fullName: [service.firstName, service.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Usuario'
        } : null,
      };
    });   

    res.json({
      message: 'Mis servicios como profesional',
      services: formattedServices,
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

// HU-09: Rechazar oferta + fallback automático (OPTIMIZADO CON GIST)
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
      where: { id: serviceId },
      select: {
        id: true,
        type: true,
        status: true,
        professionalId: true,
        pickupLat: true,
        pickupLng: true,
        cityId: true,
        provinceId: true
      }
    });

    if (!service || service.professionalId !== professional.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    console.log(`🔄 [REJECT] Servicio ${serviceId} rechazado por ${professional.fullName}`);

    // Marcar como rechazado
    await prisma.service.update({
      where: { id: serviceId },
      data: { 
        status: 'REJECTED', 
        professionalId: null 
      }
    });

    await prisma.professional.update({
      where: { id: professional.id },
      data: {
        rejectCount: { increment: 1 },
        lastRejectAt: new Date(),
      }
    });

    const MAX_DISTANCE_METERS = 15000; // 15 km

    // ==================== CONSULTA OPTIMIZADA CON GIST ====================
    const candidates = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        p.id,
        p."fullName",
        p.profession,
        p.rating,
        p."lastLocation",
        ST_Distance(
          ST_MakePoint(${service.pickupLng}::float, ${service.pickupLat}::float)::geography,
          p."lastLocation"::geography
        ) / 1000 as "distanceKm"
      FROM "professionals" p
      WHERE p."isActive" = true 
        AND p.status = 'APPROVED'
        AND p.profession = ${service.type ? `'${service.type}'` : 'p.profession'}
        AND p.cityId = ${service.cityId}
        AND p.provinceId = ${service.provinceId}
        AND p.id != ${professional.id}
        AND ST_DWithin(
          p."lastLocation"::geography,
          ST_MakePoint(${service.pickupLng}::float, ${service.pickupLat}::float)::geography,
          ${MAX_DISTANCE_METERS}
        )
      ORDER BY "distanceKm" ASC
      LIMIT 5;
    `);

    if (candidates.length === 0) {
      console.log(`⚠️ [REJECT] No hay más profesionales cercanos`);
      return res.json({ 
        message: `Oferta rechazada. No hay más profesionales disponibles cerca.` 
      });
    }

    const next = candidates[0];
    const distanceKm = parseFloat(next.distanceKm).toFixed(2);

    // Reasignar
    await prisma.service.update({
      where: { id: serviceId },
      data: { 
        professionalId: next.id, 
        status: 'OFFERED' 
      }
    });

    console.log(`✅ [REASSIGN] Reasignado a ${next.fullName} - ${distanceKm} km`);

    res.json({
      message: 'Oferta rechazada. Asignada al siguiente profesional más cercano.',
      nextProfessionalId: next.id,
      nextProfessionalName: next.fullName,
      distanceKm: distanceKm
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

  // Actualización con raw query (la forma correcta con geography)
    await prisma.$executeRawUnsafe(`
      UPDATE "professionals"
      SET "lastLocation" = ST_MakePoint(${lng}, ${lat})::geography,
          "updatedAt" = NOW()
      WHERE "userId" = $1
    `, req.user.id);

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
  const { type, pickupLat, pickupLng, pickupAddress, pickupAddressExtra, reference, floor, doorNumber, cityId, provinceId } = req.body;
  const MAX_DISTANCE_KM = 10;   // ← Ajustable por tipo de servicio

  console.log(`🚀 [REQUEST] Solicitud recibida - Type: ${type} | CityId: ${cityId} | ProvinceId: ${provinceId} | Dirección: ${pickupAddress}`);
  console.log(`🚀 [REQUEST] Coordenadas recibidas: Lat=${pickupLat}, Lng=${pickupLng}`);
  
  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo usuarios pueden solicitar servicios' });
    }

    if (!type || !pickupLat || !pickupLng || !cityId || !provinceId || !pickupAddress?.trim()) {
      return res.status(400).json({ 
        error: 'type, , pickupLat, pickupLat, pickupLng, cityId y provinceId son obligatorios' 
      });
    }

    // ==================== VERIFICACIÓN DE SERVICIO ACTIVO ====================
    const activeService = await prisma.service.findFirst({
      where: { 
        requesterId: req.user.id,
        status: { in: ['REQUESTED', 'OFFERED', 'ACCEPTED', 'ARRIVED'] }
      }
    });

    if (activeService) {
      return res.status(409).json({ 
        error: 'Ya tienes un servicio activo.' 
      });
    }

  
    // Crear servicio
    const newService = await prisma.service.create({
      data: {
        requesterId: req.user.id,
        type: type as any,
        pickupLat: Number(pickupLat),
        pickupLng: Number(pickupLng),
        pickupAddress: pickupAddress.trim(),
        pickupAddressExtra: pickupAddressExtra?.trim() || null,
        reference: reference?.trim() || null,
        floor: floor?.trim() || null,
        doorNumber: doorNumber?.trim() || null,
        cityId: cityId,
        provinceId: provinceId,
        status: 'REQUESTED',
        requestedAt: new Date(),
      },
    });

    console.log(`✅ [REQUEST] Servicio creado - ID: ${newService.id}`);
   
    if (newService.professionalId) {
      console.warn(`⚠️ [SECURITY] Se intentó asignar profesionalId al crear servicio`);
    }

    // ==================== MATCHING CON POSTGIS ====================
    const professionals = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        p.id,
        p."fullName",
        p.profession,
        ST_Distance(
          ST_MakePoint($2::float, $1::float)::geography,
          p."lastLocation"::geography
        ) / 1000 as "distanceKm"
      FROM "professionals" p
      WHERE p."isActive" = true 
    AND p.status = 'APPROVED'
    AND p.profession = $3
    AND p."cityId" = $4
    AND p."provinceId" = $5
    AND ST_DWithin(
      p."lastLocation"::geography,
      ST_MakePoint($2, $1)::geography,
      $6
    )
  ORDER BY "distanceKm" ASC
  LIMIT 8;
`, 
  pickupLat, 
  pickupLng, 
  type, 
  cityId, 
  provinceId,
  MAX_DISTANCE_KM * 1000   // ← Pasado como parámetro
);


if (!professionals?.length) {
    // === MANEJO DE COLA ===
    await prisma.service.update({
        where: { id: newService.id },
        data: { status: 'WAITING' }   // o 'QUEUED'
    });

    return res.status(201).json({
        message: 'Servicio en cola',
        serviceId: newService.id,
        status: 'WAITING',
        warning: `No hay profesionales disponibles ahora...`
    });
}

    if (!professionals?.length) {
      console.log(`⚠️ No hay profesionales en ${cityId}, ${provinceId}`);
      return res.status(201).json({
        message: 'Servicio solicitado correctamente',
        serviceId: newService.id,
        status: 'REQUESTED',
        warning: `No hay profesionales disponibles en esta zona.`
      });
    }

    const bestMatch = professionals[0];

    // ==================== ASIGNAR PROFESIONAL ====================
    try {
      await prisma.service.update({
        where: { id: newService.id },
        data: {
          professionalId: bestMatch.id,
          status: 'OFFERED',
        }
      });

      console.log(`✅ [MATCH] Asignado correctamente a ${bestMatch.fullName} (ID: ${bestMatch.id})`);

      
    } catch (updateError) {
      console.error("❌ Error al asignar professionalId:", updateError);
      // No devolvemos error 500, solo informamos
    }

    const distance = bestMatch.distanceKm 
      ? parseFloat(bestMatch.distanceKm).toFixed(2) 
      : "0.00";

    res.status(201).json({
      message: 'Servicio solicitado correctamente',
      serviceId: newService.id,
      assignedTo: bestMatch.fullName,
      distanceKm: distance,
      cityId,
      provinceId
    });

  } catch (error: any) {
    console.error("💥 [REQUEST] Error general:", error);
    res.status(500).json({ 
      error: 'Error interno al solicitar servicio',
      details: error.message 
    });
  }
});

// =============================================
// PROFESIONALES DESTACADOS (Suscripción Premium)
// =============================================

app.get('/professionals', async (req: any, res: any) => {
  const { search, profession, provinceId, cityId, page = 1, limit = 15 } = req.query;

  try {
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(30, Math.max(5, parseInt(limit as string)));

    const where: any = { 
      status: 'APPROVED',
    };

    if (profession) {
      where.profession = { contains: profession as string, mode: 'insensitive' };
    }

    if (provinceId) where.provinceId = provinceId;
    if (cityId) where.cityId = cityId;

    if (search) {
      where.OR = [
        { fullName: { contains: search as string, mode: 'insensitive' } },
        { profession: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [professionals, total] = await Promise.all([
      prisma.professional.findMany({
        where,
        include: { 
          user: {
            select: { id: true, firstName: true, lastName: true, photoUrl: true }
          }
        },
        orderBy: [
          { rating: 'desc' },
          { reviewCount: 'desc' }
        ],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.professional.count({ where })
    ]);

    res.json({
      professionals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });

  } catch (error: any) {
    console.error('💥 [PROFESSIONALS] Error:', error);
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

    // Validaciones mínimas
    if (!profession || typeof profession !== 'string' || profession.trim() === '') {
      return res.status(400).json({ error: 'La profesión es obligatoria' });
    }

    if (!modalities || !Array.isArray(modalities) || modalities.length === 0) {
      return res.status(400).json({ error: 'Debes seleccionar al menos una modalidad' });
    }

    // Verificar si ya tiene una solicitud
    const existing = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (existing) {
      return res.status(409).json({ 
        error: 'Ya tienes una solicitud de profesional registrada.' 
      });
    }
// Crear nombre completo a partir del usuario
    const fullName = [
      req.dbUser.firstName,
      req.dbUser.lastName
    ].filter(Boolean).join(' ').trim() || req.dbUser.email.split('@')[0];


    const professional = await prisma.professional.create({
      data: {
        userId: req.user.id,
        fullName: fullName,
        profession: profession.trim(),
        description: description?.trim() || '',
        phone: phone?.trim() || '',
        address: address?.trim() || '',
        dniFrontUrl: dniFrontUrl || null,
        dniBackUrl: dniBackUrl || null,
        certificateUrl: certificateUrl || null,
        modalities: modalities || ['TIME_BASED'],
        isActive: false,
        status: 'PENDING',
        vehicleType: profession.trim(),
        provinceId: req.dbUser.provinceId,     // Heredamos del usuario
        cityId: req.dbUser.cityId,             // Heredamos del usuario
      }
    });

    console.log(`📋 Nueva solicitud de profesional: ${professional.fullName} - ${profession}`);

    res.status(201).json({
      message: 'Solicitud enviada correctamente. Pendiente de aprobación.',
      professionalId: professional.id
    });

  } catch (error: any) {
    console.error('💥 Error al registrar prestador:', error);
    res.status(500).json({ 
      error: 'Error interno al registrar profesional',
      details: error.message 
    });
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
 
// Enviar mensaje - Versión más segura
app.post('/services/:serviceId/messages', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  const { content } = req.body;

  console.log(`📩 [MESSAGE] Intentando enviar mensaje - serviceId: ${serviceId} | Usuario: ${req.user.id}`);

  try {
    if (!content?.trim()) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }

    if (!serviceId) {
      return res.status(400).json({ error: 'serviceId es requerido' });
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        professional: {
          include: { user: true }
        },
        requester: true
      }
    });

    if (!service) {
      console.error(`❌ Servicio no encontrado: ${serviceId}`);
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const isRequester = service.requesterId === req.user.id;
    const isProfessional = service.professional?.user?.id === req.user.id;

    console.log(`🔍 Participante - Requester: ${isRequester}, Professional: ${isProfessional}`);

    if (!isRequester && !isProfessional) {
      return res.status(403).json({ error: 'No tienes permiso para chatear en este servicio' });
    }

    // === CORRECCIÓN DEL receiverId ===
    let receiverId: any;

    if (isRequester) {
      receiverId = service.professional?.user?.id;
      if (!receiverId) {
        return res.status(500).json({ error: 'No se pudo identificar el profesional' });
      }
    } else {
      receiverId = service.requesterId;
      if (!receiverId) {
        return res.status(500).json({ error: 'No se pudo identificar el usuario' });
      }
    }

    const message = await prisma.message.create({
      data: {
        serviceId,
        senderId: req.user.id,
        receiverId,
        content: content.trim()
      },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true }
        }
      }
    });

    console.log(`✅ Mensaje enviado correctamente en servicio ${serviceId}`);

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

  console.log(`📡 Cargando mensajes para serviceId: ${serviceId} | Usuario: ${req.user.id}`);

  try {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        professional: { include: { user: true } },   // ← Más seguro
        requester: true
      }
    });
 
    if (!service) {
      console.error(`❌ Servicio no encontrado: ${serviceId}`);
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Verificar acceso
    const isRequester = service.requesterId === req.user.id;
    const isProfessional = service.professional?.user?.id === req.user.id;

    console.log(`🔍 Acceso - Requester: ${isRequester}, Professional: ${isProfessional}`);

    if (!isRequester && !isProfessional) {
      return res.status(403).json({ error: 'No tienes permiso' });
    }

    // Buscar mensajes
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

    console.log(`✅ Mensajes encontrados: ${messages.length} para service ${serviceId}`);

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
  const { id, email, firstName, lastName, address, photoUrl,provinceId,cityId } = req.body;

  try {
    // Crear o actualizar usuario en Prisma
    const user = await prisma.user.upsert({
      where: { id },
      update: {
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        address: address?.trim() || null,
        photoUrl: photoUrl || null,
        provinceId: provinceId || null,
        cityId: cityId || null,
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
        provinceId: provinceId || null,
        cityId: cityId || null,
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

// Obtener profesiones disponibles (solo las que tienen profesionales activos)
app.get('/professions/available', async (req: any, res: any) => {
  try {
    const professionals = await prisma.professional.findMany({
      where: {
        isActive: true,
        status: 'APPROVED'
      },
      select: {
        profession: true
      }
    });

    // Obtener profesiones únicas
    const uniqueProfessions = [...new Set(professionals.map(p => p.profession))];

    res.json({
      professions: uniqueProfessions.sort()
    });

  } catch (error: any) {
    console.error('Error al obtener profesiones disponibles:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Obtener todas las provincias
app.get('/provinces', async (req: any, res: any) => {
  try {
    const provinces = await prisma.province.findMany({
      orderBy: { name: 'asc' }
    });
    res.json({ provinces });
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar provincias' });
  }
});

// Obtener ciudades por provincia
app.get('/cities', async (req: any, res: any) => {
  const { provinceId } = req.query;
  try {
    const cities = await prisma.city.findMany({
      where: { provinceId },
      orderBy: { name: 'asc' }
    });
    res.json({ cities });
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar ciudades' });
  }
});

// Crear un nuevo servicio
/*
app.post('/services/create', authenticate, async (req: any, res: any) => {
  const { professionalId, type } = req.body;
  const userId = req.user.id;

  try {

    if (req.dbUser.role === 'PROFESSIONAL') {
  const targetProfessionalId = req.body.professionalId; // o como lo estés recibiendo

  const myProfile = await prisma.professional.findUnique({
    where: { userId: req.user.id }
  });

  if (myProfile && myProfile.id === targetProfessionalId) {
    return res.status(400).json({ 
      error: 'No puedes enviarte un mensaje a ti mismo' 
    });
  }
}

    const service = await prisma.service.create({
      data: {
        requesterId: userId,
        professionalId: professionalId,
        type: type || 'Consulta General',
        status: 'COMPLETED' // o 'active'
      },
      include: { professional: true }
    });

    res.status(201).json({ service });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear servicio' });
  }
});
*/


// Encontrar o crear chat entre usuario y profesional
app.post('/chats/find-or-create', authenticate, async (req: any, res: any) => {
  const { professionalId } = req.body;
  const userId = req.user.id;

  console.log(`🔄 find-or-create - User: ${userId} | Professional: ${professionalId}`);

  try {
    if (!professionalId) {
      return res.status(400).json({ error: 'professionalId es requerido' });
    }

    // Buscar servicio existente (priorizando los que no estén COMPLETED)
    let service = await prisma.service.findFirst({
      where: {
      OR: [
          { requesterId: userId, professionalId: professionalId },
          { requesterId: professionalId, professionalId: userId },
          { requesterId: userId, professional: { userId: professionalId } },
          { requesterId: professionalId, professional: { userId: userId } }
        ]
      },
      orderBy: [
        { status: 'asc' },      // Prioriza ACTIVE, CHAT, etc. sobre COMPLETED
        { id: 'desc' }
      ]
    });

    if (!service) {
      // Crear nuevo solo si realmente no existe
      service = await prisma.service.create({
        data: {
          requesterId: userId,
          professionalId: professionalId,
          type: 'CHAT',
          status: 'CHAT',
          requestedAt: new Date(),
        }
      });
      console.log(`💬 Nuevo chat creado - ID: ${service.id}`);
    } else {
      console.log(`♻️ Servicio encontrado - ID: ${service.id} | Status: ${service.status}`);
      
   
    }

    res.json({ 
      serviceId: service.id,
      status: service.status 
    });

  } catch (error: any) {
    console.error('❌ Error find-or-create:', error);
    res.status(500).json({ error: 'Error al inicializar chat' });
  }
});

// Obtener todas las conversaciones del usuario (chats + servicios)
app.get('/services/my-conversations', authenticate, async (req: any, res: any) => {
  const userId = req.user.id;

  try {
    const conversations = await prisma.service.findMany({
      where: {
        OR: [
          { requesterId: userId },
          { professional: { userId: userId } }
        ],
        messages: { some: {} }
      },
      include: {
        requester: {
          select: { 
            id: true, 
            firstName: true, 
            lastName: true 
            // avatar: true   ← comentado porque no existe en tu modelo
          }
        },
        professional: {
          include: {
            user: {
              select: { 
                id: true, 
                firstName: true, 
                lastName: true 
                // avatar: true
              }
            }
          }
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            sender: {
              select: { id: true, firstName: true, lastName: true }
            }
          }
        }
      },
      orderBy: { id: 'desc' }
    });

    // === AGRUPACIÓN POR PROFESIONAL ===
    const grouped = new Map();

    conversations.forEach((conv: any) => {
      // Tomamos el ID del usuario profesional (no el de la tabla Professional)
      const professionalUserId = conv.professional?.user?.id || conv.professionalId;

      if (!professionalUserId) return;

      if (!grouped.has(professionalUserId)) {
        grouped.set(professionalUserId, conv);
      } else {
        const existing = grouped.get(professionalUserId);
        if (new Date(conv.id) > new Date(existing.id)) {
          grouped.set(professionalUserId, conv);
        }
      }
    });

    const unifiedConversations = Array.from(grouped.values());

    console.log(`📬 [CONVERSATIONS] Usuario ${userId} tiene ${unifiedConversations.length} conversaciones unificadas`);

    res.json(unifiedConversations);

  } catch (error) {
    console.error('Error al obtener conversaciones:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

// 📍 ACTUALIZAR UBICACIÓN DEL USUARIO - Versión estable
app.patch('/user/location', authenticate, async (req: any, res: any) => {
  const { lat, lng } = req.body;

  console.log(`📍 [LOCATION] Intento de actualización - User: ${req.user?.id} | Lat: ${lat} | Lng: ${lng}`);

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    console.log('❌ Coordenadas inválidas');
    return res.status(400).json({ error: 'lat y lng deben ser números válidos' });
  }

  try {
    await prisma.$executeRawUnsafe(`
      UPDATE "users"
      SET 
        "lastLocation" = ST_MakePoint(${lng}, ${lat})::geography,
        "updatedAt" = NOW()
      WHERE id = $1
    `, req.user.id);

    console.log(`✅ Ubicación actualizada correctamente para usuario ${req.user.id}`);

    res.json({
      success: true,
      message: 'Ubicación actualizada correctamente',
      location: { lat, lng }
    });

  } catch (error: any) {
    console.error('💥 Error actualizando ubicación:', error);
    res.status(500).json({ 
      error: 'Error interno al actualizar ubicación' 
    });
  }
});

// Obtener TODOS los mensajes entre un usuario y un profesional (unificados)
/*app.get('/chats/:professionalId/messages', authenticate, async (req: any, res: any) => {
  const userId = req.user.id;
  const { professionalId } = req.params;

  try {
    const services = await prisma.service.findMany({
      where: {
        OR: [
          { requesterId: userId, professionalId: professionalId },
          { requesterId: professionalId, professionalId: userId } // por si acaso
        ]
      },
      select: { id: true }
    });

    const serviceIds = services.map(s => s.id);

    if (serviceIds.length === 0) {
      return res.json({ messages: [] });
    }

    const messages = await prisma.message.findMany({
      where: {
        serviceId: { in: serviceIds }
      },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`📨 Mensajes unificados: ${messages.length} entre ${userId} y ${professionalId}`);

    res.json({ messages });

  } catch (error) {
    console.error('Error cargando mensajes unificados:', error);
    res.status(500).json({ error: 'Error al cargar mensajes' });
  }
});
*/
app.get('/chats/:professionalId/messages', authenticate, async (req: any, res: any) => {
  const userId = req.user.id;
  const { professionalId } = req.params;

  console.log(`📡 [CHATS/UNIFIED] User: ${userId} | ProfessionalUserId: ${professionalId}`);

     // === VALIDACIÓN SELF-CHAT ===
    if (userId === professionalId) {
      console.log('🚫 Self-chat detectado, devolviendo vacío');
      return res.json({ messages: [] });
    }

  try {
    const services = await prisma.service.findMany({
      where: {
        OR: [
          { requesterId: userId, professional: { userId: professionalId } },
          { requesterId: professionalId, professional: { userId: userId } },
          { requesterId: userId, professionalId: professionalId },
          { requesterId: professionalId, professionalId: userId }
        ]
      },
      select: { id: true }
    });

    const serviceIds = services.map(s => s.id);

    console.log(`🔍 Total services encontrados: ${services.length} → IDs: ${serviceIds.join(', ')}`);

    if (serviceIds.length === 0) {
      return res.json({ messages: [] });
    }

    const messages = await prisma.message.findMany({
      where: { 
        serviceId: { in: serviceIds }
      },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`✅ Mensajes unificados finales: ${messages.length}`);

    res.json({ messages });

  } catch (error: any) {
    console.error('💥 Error unificado:', error);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});

// Generar URL firmada para subir documentos
app.post('/upload/signed-url', authenticate, async (req: any, res: any) => {
  try {
    const { fileName } = req.body;

    if (!fileName) return res.status(400).json({ error: 'fileName requerido' });

    const filePath = `professionals/${req.user.id}/${Date.now()}-${fileName}`;

    // Usamos el service_role client para bypass RLS en uploads
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUploadUrl(filePath);

    if (error) {
      console.error('Supabase signed URL error:', error);
      throw error;
    }

    res.json({
      success: true,
      signedUrl: data.signedUrl,
      publicUrl: data.signedUrl.split('?')[0],
      path: filePath
    });

  } catch (error: any) {
    console.error('Error generando signed URL:', error);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

/*
// HU-34: Mensajes para profesional (versión simétrica y robusta)
app.get('/chats/professional/:professionalId/messages', authenticate, async (req: any, res: any) => {
  const userId = req.user.id;
  const { professionalId } = req.params;

  console.log(`📡 [CHATS/PROFESSIONAL] Professional: ${userId} | Other User: ${professionalId}`);

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden usar este endpoint' });
    }

    // === VALIDACIÓN SELF-CHAT ===
    if (userId === professionalId) {
      console.log('🚫 Self-chat detectado, devolviendo vacío');
      return res.json({ messages: [] });
    }

    const services = await prisma.service.findMany({
      where: {
        OR: [
          { requesterId: userId, professional: { userId: professionalId } },
          { requesterId: professionalId, professional: { userId: userId } },
          { requesterId: userId, professionalId: professionalId },
          { requesterId: professionalId, professionalId: userId }
        ]
      },
      select: { id: true }
    });

    const serviceIds = services.map(s => s.id);

    console.log(`🔍 Total services encontrados para profesional: ${services.length}`);

    if (serviceIds.length === 0) {
      return res.json({ messages: [] });
    }

    const messages = await prisma.message.findMany({
      where: { serviceId: { in: serviceIds } },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`✅ Mensajes cargados para profesional: ${messages.length}`);

    res.json({ messages });

  } catch (error: any) {
    console.error('💥 Error en chats/professional:', error);
    res.status(500).json({ error: 'Error al cargar historial' });
  }
});
*/

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});