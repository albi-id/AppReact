// src/index.ts - Versión completa, segura y corregida (build fix + 404 solucionado)
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import cors from 'cors';
import axios from 'axios';
import { getServiceConfig } from './config/services';  
import path from 'path';
import crypto from 'crypto';
 
console.log('DATABASE_URL cargada:', process.env.DATABASE_URL ? 'Sí' : 'NO');

// ==================== SETUP ====================
const prisma = new PrismaClient();
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

 
async function ensureValidProfessionalToken(professionalId: string): Promise<string> {
  const professional = await prisma.professional.findUnique({ where: { id: professionalId } });
  if (!professional?.mpAccessToken || !professional.mpRefreshToken) {
    throw new Error('professional_not_linked');
  }

  const expiresInMs = professional.mpTokenExpiresAt
    ? professional.mpTokenExpiresAt.getTime() - Date.now()
    : 0;
 
  // Refrescamos si falta menos de un día para que venza
  if (expiresInMs > 24 * 60 * 60 * 1000) {
    return decryptToken(professional.mpAccessToken);
  }

  const refreshRes = await axios.post(`${MP_API}/oauth/token`, {
    client_id: process.env.MP_CLIENT_ID,
    client_secret: process.env.MP_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: decryptToken(professional.mpRefreshToken),
  });

  const { access_token, refresh_token, expires_in } = refreshRes.data;

  await prisma.professional.update({
    where: { id: professionalId },
    data: {
      mpAccessToken: encryptToken(access_token),
      mpRefreshToken: encryptToken(refresh_token),
      mpTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
    },
  });

  return access_token;
}

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

//para mercado pago
app.use(express.static(path.join(__dirname, '..', 'public')));
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

// ==================== CIFRADO DE TOKENS SENSIBLES (AES-256-GCM) ====================
const ENCRYPTION_KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY as string, 'hex');

function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

const LATE_CANCEL_CHARGE_ARS = 800;
 
async function refundSignal(serviceId: string, mpOrderId: string) {
  try {
    await axios.post(
      `${MP_API}/v1/orders/${mpOrderId}/refund`,
      {},
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'X-Idempotency-Key': `refund-signal-${serviceId}-${Date.now()}`,
        },
      }
    );

    await prisma.service.update({
      where: { id: serviceId },
      data: { signalPaymentStatus: 'refunded' as any },
    });

    console.log(`✅ [REFUND] Seña reembolsada para servicio ${serviceId}`);
  } catch (error: any) {
    console.error(`💥 Error reembolsando seña servicio ${serviceId}:`, JSON.stringify(error.response?.data || error.message, null, 2));
  }
}

async function chargeLateCancellationWithToken(serviceId: string, cardToken: string) {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });

  if (!service || service.status !== 'ACCEPTED' || service.cancellationChargeStatus === 'approved') {
    return { success: false, reason: 'not_chargeable' as const };
  }
  if (!service.professionalId) {
    return { success: false, reason: 'no_professional' as const };
  }

  const paymentMethod = await prisma.paymentMethod.findUnique({
    where: { userId: service.requesterId },
  });
  if (!paymentMethod) {
    return { success: false, reason: 'no_payment_method' as const };
  }

  let professionalAccessToken: string;
  try {
    professionalAccessToken = await ensureValidProfessionalToken(service.professionalId);
  } catch {
    return { success: false, reason: 'professional_not_linked' as const };
  }

    const totalToCharge = LATE_CANCEL_CHARGE_ARS;

  let order: any;
  try {
    const orderRes = await axios.post(
      `${MP_API}/v1/orders`,
      {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: `latecancel-${service.id}`,
        total_amount: String(totalToCharge),
        items: [{
          title: `Cargo por cancelación tardía - Servicio de ${service.type}`,
          quantity: 1,
          unit_price: String(totalToCharge),
        }],
        payer: { customer_id: paymentMethod.mpCustomerId },
        transactions: {
          payments: [{
            amount: String(totalToCharge),
            payment_method: {
              id: paymentMethod.cardPaymentMethodId,
              type: 'credit_card',
              token: cardToken,
              installments: 1,
              statement_descriptor: 'NEXOS SERVICIOS',
            },
          }],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${professionalAccessToken}`,
          'X-Idempotency-Key': `latecancel-${service.id}-${Date.now()}`,
        },
      }
    );
    order = orderRes.data;
  } catch (error: any) {
    order = error.response?.data?.data;
    if (!order) {
      console.error(`💥 Error cobrando cancelación tardía servicio ${serviceId}:`, JSON.stringify(error.response?.data || error.message, null, 2));
      return { success: false, reason: 'mp_error' as const };
    }
  }

  const payment = order.transactions?.payments?.[0];
  const status = mapPaymentStatus(payment?.status);

  const updateData: any = {
    cancellationChargeMpPaymentId: payment ? String(payment.id) : null,
    cancellationChargeStatus: status as any,
  };

  if (status === 'approved') {
    updateData.cancellationChargedAt = new Date();
    updateData.status = 'CANCELLED';
  }

  await prisma.service.update({ where: { id: service.id }, data: updateData });

  return { success: status === 'approved', status: payment?.status, statusDetail: payment?.status_detail };
}

const MP_API = 'https://api.mercadopago.com';
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN as string;
console.log('🔑 MP_ACCESS_TOKEN termina en:', MP_ACCESS_TOKEN?.slice(-15));
// ==================== HELPERS DE PAGOS ====================
const PLATFORM_FEE_RATE = 0.15;
const MP_FEE_RATE = 0.0499;      // ⚠️ ajustar según tu panel de MP > Costos
const MP_FEE_IVA_RATE = 0.21;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
  

async function chargeSignalWithToken(serviceId: string, cardToken: string) {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });

  if (!service || service.status !== 'ACCEPTED' || service.signalPaidAt) {
    return { success: false, reason: 'not_chargeable' as const };
  }

  const paymentMethod = await prisma.paymentMethod.findUnique({
    where: { userId: service.requesterId },
  });
  if (!paymentMethod) {
    return { success: false, reason: 'no_payment_method' as const };
  }

   let signalAmount: number | undefined;
  try {
    const config = getServiceConfig(service.type);
    signalAmount = config?.signalAmount;
  } catch {
    return { success: false, reason: 'no_signal_amount' as const };
  }
  if (!signalAmount) {
    return { success: false, reason: 'no_signal_amount' as const };
  }

    const totalToCharge = signalAmount;

  let order: any;
  try {
    const orderRes = await axios.post(
      `${MP_API}/v1/orders`,
      {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: `signal-${service.id}`,
        total_amount: String(totalToCharge),
        items: [{
          title: `Seña por uso de la app - Servicio de ${service.type}`,
          quantity: 1,
          unit_price: String(totalToCharge),
        }],
        payer: { customer_id: paymentMethod.mpCustomerId },
        transactions: {
          payments: [{
            amount: String(totalToCharge),
            payment_method: {
              id: paymentMethod.cardPaymentMethodId,
              type: 'credit_card',
              token: cardToken,
              installments: 1,
              statement_descriptor: 'NEXOS SERVICIOS',
            },
          }],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'X-Idempotency-Key': `signal-${service.id}-${Date.now()}`,
        },
      }
    );
    order = orderRes.data;
  } catch (error: any) {
    order = error.response?.data?.data;
    if (!order) {
      console.error(`💥 Error cobrando seña servicio ${serviceId}:`, JSON.stringify(error.response?.data || error.message, null, 2));
      return { success: false, reason: 'mp_error' as const };
    }
  }

  const payment = order.transactions?.payments?.[0];
  const status = mapPaymentStatus(payment?.status);

  await prisma.service.update({
    where: { id: service.id },
    data: {
      signalMpPaymentId: payment ? String(payment.id) : null,
      signalMpOrderId: order.id,
      signalPaymentStatus: status as any,
      signalPaidAt: status === 'approved' ? new Date() : null,
    },
  });

  return { success: status === 'approved', status: payment?.status, statusDetail: payment?.status_detail };
}

async function chargeServiceWithToken(serviceId: string, cardToken: string) {
  const service = await prisma.service.findUnique({ where: { id: serviceId } });

  if (!service || !service.amount || service.paidAt) {
    console.log('🚫 [CHARGE] not_chargeable →', { existe: !!service, amount: service?.amount, paidAt: service?.paidAt });
    return { success: false, reason: 'not_chargeable' as const };
  }

  const paymentMethod = await prisma.paymentMethod.findUnique({
    where: { userId: service.requesterId },
  });
  if (!paymentMethod) {
    console.log('🚫 [CHARGE] no_payment_method → requesterId:', service.requesterId);
    return { success: false, reason: 'no_payment_method' as const };
  }
  if (!service.professionalId) {
    console.log('🚫 [CHARGE] no_professional → serviceId:', service.id);
    return { success: false, reason: 'no_professional' as const };
  }
    let professionalAccessToken: string;
  try {
    professionalAccessToken = await ensureValidProfessionalToken(service.professionalId);
  } catch {
    return { success: false, reason: 'professional_not_linked' as const };
  }

    const totalToCharge = service.amount;

  let order: any;
  try {
    const orderRes = await axios.post(
      `${MP_API}/v1/orders`,
      {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: service.id,
        total_amount: String(totalToCharge),
        items: [{
          title: `Servicio de ${service.type}`,
          quantity: 1,
          unit_price: String(totalToCharge),
        }],
        payer: { customer_id: paymentMethod.mpCustomerId },
        transactions: {
          payments: [{
            amount: String(totalToCharge),
            payment_method: {
              id: paymentMethod.cardPaymentMethodId,
              type: 'credit_card',
              token: cardToken,
              installments: 1,
              statement_descriptor: 'NEXOS SERVICIOS',
            },
          }],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${professionalAccessToken}`,
          'X-Idempotency-Key': `charge-${service.id}-${Date.now()}`,
        },
      }
    );
    order = orderRes.data;
  } catch (error: any) {
    // Mercado Pago devuelve 402 cuando el pago es rechazado, pero igual
    // manda el detalle completo de la order/payment en el body del error.
    order = error.response?.data?.data;
    if (!order) {
      console.error(`💥 Error cobrando con token servicio ${serviceId}:`, JSON.stringify(error.response?.data || error.message, null, 2));
      return { success: false, reason: 'mp_error' as const };
    }
  }

  const payment = order.transactions?.payments?.[0];
  console.log('🔍 [CHARGE] payment.status crudo de MP:', payment?.status, '| status_detail:', payment?.status_detail);
  const status = mapPaymentStatus(payment?.status);
  
  await prisma.service.update({
    where: { id: service.id },
    data: {
      mpPaymentId: payment ? String(payment.id) : null,
      paymentStatus: status as any,
      totalCharged: totalToCharge,
      paidAt: status === 'approved' ? new Date() : null,
    },
  });

  return { success: status === 'approved', status: payment?.status, statusDetail: payment?.status_detail };
}
 

function mapPaymentStatus(mpStatus: string | undefined): string {
  switch (mpStatus) {
    case 'processed':
      return 'approved';
    case 'failed':
      return 'rejected';
    case 'action_required':
    case 'in_review':
      return 'pending';
    case 'in_process':
      return 'in_process';
    default:
      return 'pending';
  }
}

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
      cityId: true,       
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
        s."proposedAmount",
        s."amountProposedAt",
        s."paymentModality",
        s."paymentStatus",
        s."totalCharged",
        s."signalPaymentStatus",
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
      ORDER BY s."requestedAt" DESC
      LIMIT 50;
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
      proposedAmount: service.proposedAmount,
      amountProposedAt: service.amountProposedAt,
      paymentModality: service.paymentModality,
      paymentStatus: service.paymentStatus,
      totalCharged: service.totalCharged,
      signalPaymentStatus: service.signalPaymentStatus, 
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
        s."proposedAmount",
        s."amountProposedAt",
        s."paymentModality",
        s."paymentStatus",
        s."signalPaymentStatus",
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
      ORDER BY s."requestedAt" DESC
      LIMIT 50;
    `, professional.id);

        // Formateo 
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
        proposedAmount: service.proposedAmount,
        amountProposedAt: service.amountProposedAt,
        paymentModality: service.paymentModality,
        paymentStatus: service.paymentStatus,
        signalPaymentStatus: service.signalPaymentStatus,
        pickupLat: service.pickupLat,
        pickupLng: service.pickupLng,

        // === NUEVOS CAMPOS DE DIRECCIÓN ===
        pickupAddress: service.pickupAddress,
        pickupAddressExtra: service.pickupAddressExtra,
        reference: service.reference,
        floor: service.floor,
        doorNumber: service.doorNumber,

        distanceKm: Number(distanceKm),

        // === ESTRUCTURA DEL REQUESTER ===
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

const MAX_REJECT_ATTEMPTS = 5;

async function reassignService(
  prisma: PrismaClient,
  serviceId: string,
  options: { explicitRejectBy?: string } = {}
) {
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
      provinceId: true,
      rejectAttempts: true,
      rejectedProfessionalIds: true,
      paymentModality: true,
      signalPaymentStatus: true,
      signalMpOrderId: true,
      requesterId: true,
      isDirectRequest: true,
    }
  });

    if (!service || (service.status !== 'OFFERED' && service.status !== 'ACCEPTED')) {
    return { reassigned: false as const, reason: 'not_offered' as const };
  }

  const wasAccepted = service.status === 'ACCEPTED';

  if (
    service.pickupLat == null ||
    service.pickupLng == null ||
    service.cityId == null ||
    service.provinceId == null
  ) {
    return { reassigned: false as const, reason: 'invalid_location' as const };
  }
    if (service.isDirectRequest) {
    await prisma.service.update({ where: { id: serviceId }, data: { status: 'WAITING' } });
       if (wasAccepted && service.signalPaymentStatus === 'approved' && service.signalMpOrderId) {
      await refundSignal(serviceId, service.signalMpOrderId);
    }
    return { reassigned: false as const, reason: 'direct_request_no_reassign' as const };
  }

  const excludeId = service.professionalId;
  const newRejectAttempts = (service.rejectAttempts || 0) + 1;
  const updatedRejectedIds = excludeId
    ? [...(service.rejectedProfessionalIds || []), excludeId]
    : (service.rejectedProfessionalIds || []);

  await prisma.service.update({
    where: { id: serviceId },
    data: {
      status: 'REJECTED',
      professionalId: null,
      rejectAttempts: newRejectAttempts,
      rejectedProfessionalIds: updatedRejectedIds,
      lastRejectAt: new Date(),
    }
  });

  if (options.explicitRejectBy) {
    await prisma.professional.update({
      where: { id: options.explicitRejectBy },
      data: { rejectCount: { increment: 1 }, lastRejectAt: new Date() }
    });
  }

    if (newRejectAttempts >= MAX_REJECT_ATTEMPTS) {
    await prisma.service.update({ where: { id: serviceId }, data: { status: 'WAITING' } });
       if (wasAccepted && service.signalPaymentStatus === 'approved' && service.signalMpOrderId) {
      await refundSignal(serviceId, service.signalMpOrderId);
    }
    return { reassigned: false as const, reason: 'max_attempts' as const };
  }

  let candidates = await findNearestProfessional(prisma, {
    pickupLat: service.pickupLat,
    pickupLng: service.pickupLng,
    type: service.type,
    cityId: service.cityId,
    provinceId: service.provinceId,
    excludeProfessionalIds: updatedRejectedIds,
    limit: 5,
  });

  if (service.paymentModality && candidates.length) {
    const withModality = await prisma.professional.findMany({
      where: {
        id: { in: candidates.map((c: any) => c.id) },
        modalities: { has: service.paymentModality },
      },
      select: { id: true },
    });
    const eligibleIds = new Set(withModality.map((p) => p.id));
    candidates = candidates.filter((c: any) => eligibleIds.has(c.id));
  }

    if (candidates.length === 0) {
    await prisma.service.update({ where: { id: serviceId }, data: { status: 'WAITING' } });
        if (wasAccepted && service.signalPaymentStatus === 'approved' && service.signalMpOrderId) {
      await refundSignal(serviceId, service.signalMpOrderId);
    }
    return { reassigned: false as const, reason: 'no_candidates' as const };
  }

  let assigned: any = null;
  for (const candidate of candidates) {
    try {
      await prisma.service.update({
        where: { id: serviceId },
        data: { professionalId: candidate.id, status: 'OFFERED', offeredAt: new Date() },
      });
      assigned = candidate;
      break;
    } catch (error: any) {
      if (error.code === 'P2002') continue;
      throw error;
    }
  }

    if (!assigned) {
    await prisma.service.update({ where: { id: serviceId }, data: { status: 'WAITING' } });
        if (wasAccepted && service.signalPaymentStatus === 'approved' && service.signalMpOrderId) {
      await refundSignal(serviceId, service.signalMpOrderId);
    }
    return { reassigned: false as const, reason: 'all_taken' as const };
  }

  return { reassigned: true as const, professional: assigned };
}
// ==================== CONFIG DE MATCHING (compartida) ====================
const MAX_DISTANCE_KM = 10; // criterio único de negocio para request y reject


// ==================== HELPER: buscar profesional más cercano ====================
async function findNearestProfessional(
  prisma: PrismaClient,
  {
    pickupLat,
    pickupLng,
    type,
    cityId,
    provinceId,
    excludeProfessionalIds = [] as string[],
    limit = 5,
  }: {
    pickupLat: number;
    pickupLng: number;
    type: string;
    cityId: string | number;
    provinceId: string | number;
    excludeProfessionalIds?: string[];
    limit?: number;
  }
) {
  const candidates = await prisma.$queryRawUnsafe<any[]>(`
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
      AND p."lastLocationAt" > NOW() - INTERVAL '2 minutes'
      AND ST_DWithin(
        p."lastLocation"::geography,
        ST_MakePoint($2, $1)::geography,
        $6
      )
      AND NOT (p.id = ANY($7::text[]))
      AND NOT EXISTS (
        SELECT 1 FROM "services" s 
        WHERE s."professionalId" = p.id 
          AND s.status IN ('OFFERED', 'ACCEPTED', 'ARRIVED')
      )
    ORDER BY "distanceKm" ASC
    LIMIT $8;
    `,
    pickupLat,
    pickupLng,
    type,
    cityId,
    provinceId,
    MAX_DISTANCE_KM * 1000,
    excludeProfessionalIds,
    limit
  );

  return candidates;
}
 
// HU-09: Rechazar oferta + fallback con memoria de rechazos
app.patch('/services/:serviceId/reject', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden rechazar' });
    }

    const professional = await prisma.professional.findUnique({
      where: { userId: req.user.id }
    });

    if (!professional) return res.status(404).json({ error: 'Perfil no encontrado' });

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        professionalId: true,
        status: true,
        pickupLat: true,
        pickupLng: true,
        cityId: true,
        provinceId: true,
      }
    });

    if (!service || service.professionalId !== professional.id || service.status !== 'OFFERED') {
      return res.status(403).json({ error: 'No puedes rechazar este servicio' });
    }

    if (
      service.pickupLat == null ||
      service.pickupLng == null ||
      service.cityId == null ||
      service.provinceId == null
    ) {
      return res.status(500).json({ error: 'El servicio tiene datos de ubicación incompletos' });
    }

    const result = await reassignService(prisma, serviceId, { explicitRejectBy: professional.id });

    if (result.reassigned) {
      const distanceKm = parseFloat(result.professional.distanceKm).toFixed(2);
      return res.json({
        message: 'Oferta rechazada. Asignada al siguiente profesional más cercano.',
        nextProfessionalId: result.professional.id,
        nextProfessionalName: result.professional.fullName,
        distanceKm
      });
    }

   if (result.reason === 'invalid_location') {
      return res.status(500).json({ error: 'El servicio tiene datos de ubicación incompletos' });
    }

    const messages: Record<string, string> = {
      max_attempts: 'Oferta rechazada. Se alcanzó el límite de intentos, servicio puesto en cola.',
      no_candidates: 'Oferta rechazada. No hay más profesionales cercanos, servicio puesto en cola.',
      all_taken: 'Oferta rechazada. Todos los profesionales cercanos fueron tomados por otras solicitudes, servicio puesto en cola.',
    };

    return res.json({
      message: messages[result.reason as string] || 'Servicio puesto en cola.',
      status: 'WAITING'
    });

  } catch (error: any) {
    console.error('💥 Error al rechazar servicio:', error);
    res.status(500).json({ error: 'Error interno al rechazar' });
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

    if (service.signalPaymentStatus !== 'approved') {
      return res.status(403).json({ error: 'El cliente todavía no pagó la seña. Esperá a que la confirme antes de dirigirte al domicilio.' });
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
    const isFixedPrice = service.paymentModality === 'FIXED_PRICE';

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

      importe: amount,
    });
  } catch (error: any) {
    console.error('💥 [FINISH] Error al finalizar servicio:', error);
    res.status(500).json({ error: 'Error interno al finalizar el servicio' });
  }
});

app.post('/services/:id/charge-with-token', authenticate, async (req: any, res: any) => {
  const { cardToken } = req.body;
  const userId = req.user.id;

  if (!cardToken) return res.status(400).json({ error: 'Falta el token de la tarjeta' });

  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service || service.requesterId !== userId) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  if (service.status !== 'COMPLETED' || !service.amount) {
    return res.status(400).json({ error: 'Todavía no hay monto a cobrar' });
  }
  if (service.paidAt) {
    return res.status(400).json({ error: 'Ya fue pagado' });
  }

  const result = await chargeServiceWithToken(req.params.id, cardToken);

  if (result.success) {
    return res.json({ approved: true });
  }
  if (result.reason === 'no_payment_method') {
    return res.status(400).json({ error: 'No tenés un método de pago vinculado' });
  }
  return res.status(402).json({ approved: false, detail: result.statusDetail || result.reason });
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
          "lastLocationAt" = NOW(),
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
  const { type, pickupLat, pickupLng, pickupAddress, pickupAddressExtra, reference, floor, doorNumber, cityId, provinceId, professionalId, paymentModality } = req.body;

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo usuarios pueden solicitar servicios' });
    }

    if (!type || !pickupLat || !pickupLng || !cityId || !provinceId || !pickupAddress?.trim()) {
      return res.status(400).json({ 
        error: 'type, pickupLat, pickupLng, cityId y provinceId son obligatorios' 
      });
    }

    const activeService = await prisma.service.findFirst({
      where: { 
        requesterId: req.user.id,
        OR: [
          { status: { in: ['REQUESTED', 'OFFERED', 'ACCEPTED', 'ARRIVED'] } },
          { status: 'COMPLETED', amount: { gt: 0 }, paymentStatus: { not: 'approved' } },
        ],
      }
    });

    if (activeService) {
      return res.status(409).json({ 
        error: 'Tenés un servicio pendiente de pago. Completá el pago antes de solicitar uno nuevo.' 
      });
    }

        // ==================== NUEVO: solicitud directa a un profesional ====================
    let directProfessional: { id: string; fullName: string } | null = null;

   if (professionalId) {
      const candidate = await prisma.professional.findUnique({
        where: { id: professionalId },
        select: { id: true, fullName: true, profession: true, isActive: true, status: true, modalities: true }
      });

      if (!candidate || candidate.profession !== type || candidate.status !== 'APPROVED' || !candidate.isActive) {
        return res.status(409).json({ error: 'El profesional seleccionado ya no está disponible' });
      }

      if (paymentModality && !candidate.modalities?.includes(paymentModality)) {
        return res.status(409).json({ error: 'El profesional seleccionado no ofrece esa modalidad de cobro' });
      }

      const busy = await prisma.service.findFirst({
        where: { professionalId: candidate.id, status: { in: ['OFFERED', 'ACCEPTED', 'ARRIVED'] } }
      });

      if (busy) {
        return res.status(409).json({ error: 'El profesional seleccionado ya tiene un servicio en curso' });
      }

      directProfessional = candidate;
    }
    // ======================================================================

let newService;
    try {
      newService = await prisma.service.create({
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
          cityId,
          provinceId,
          status: 'REQUESTED',
          requestedAt: new Date(),
          paymentModality: paymentModality || null,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: 'Ya tienes un servicio activo. Debes finalizar o cancelar el actual antes de solicitar uno nuevo.'
        });
      }
      throw error;
    }

    // ==================== NUEVO: asignación directa, sin matching ====================
    if (directProfessional) {
        try {
        await prisma.service.update({
          where: { id: newService.id },
          data: { professionalId: directProfessional.id, status: 'OFFERED', offeredAt: new Date(), isDirectRequest: true }
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
          // Otro cliente lo tomó en el mismo instante
          await prisma.service.update({
            where: { id: newService.id },
            data: { status: 'WAITING' }
          });
          return res.status(409).json({ error: 'El profesional seleccionado ya no está disponible' });
        }
        throw error;
      }

      return res.status(201).json({
        message: 'Servicio solicitado correctamente',
        serviceId: newService.id,
        assignedTo: directProfessional.fullName,
        direct: true,
        cityId,
        provinceId
      });
    }
    // ======================================================================

const professionals = await findNearestProfessional(prisma, {
      pickupLat: Number(pickupLat),
      pickupLng: Number(pickupLng),
      type,
      cityId,
      provinceId,
      excludeProfessionalIds: [],
      limit: 8,
    });

    console.log('🔍 [DEBUG] paymentModality recibido:', paymentModality);
    console.log('🔍 [DEBUG] candidatos de findNearestProfessional:', professionals);

    // Filtramos a los candidatos que realmente ofrecen la modalidad pedida por el cliente
    let eligibleProfessionals = professionals || [];
    if (paymentModality && eligibleProfessionals.length) {
      const withModality = await prisma.professional.findMany({
        where: {
          id: { in: eligibleProfessionals.map((p: any) => p.id) },
          modalities: { has: paymentModality },
        },
        select: { id: true },
      });
      const eligibleIds = new Set(withModality.map((p) => p.id));
      eligibleProfessionals = eligibleProfessionals.filter((p: any) => eligibleIds.has(p.id));
    }
    console.log('🔍 [DEBUG] eligibleProfessionals después del filtro:', eligibleProfessionals);
    if (!eligibleProfessionals?.length) {
      await prisma.service.update({
        where: { id: newService.id },
        data: { status: 'WAITING' }
      });

      return res.status(201).json({
        message: 'Servicio en cola',
        serviceId: newService.id,
        status: 'WAITING',
        warning: 'No hay profesionales disponibles ahora.'
      });
    }

    // Intenta asignar en orden de cercanía; si otro request concurrente
    // ya tomó a un candidato, el constraint único de la DB lo rechaza (P2002)
    // y probamos con el siguiente sin romper el flujo.
    let assigned: any = null;
    for (const candidate of eligibleProfessionals) {
      try {
        await prisma.service.update({
          where: { id: newService.id },
          data: { professionalId: candidate.id, status: 'OFFERED', offeredAt: new Date() },
        });
        assigned = candidate;
        break;
      } catch (error: any) {
        if (error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    if (!assigned) {
      await prisma.service.update({
        where: { id: newService.id },
        data: { status: 'WAITING' }
      });

      return res.status(201).json({
        message: 'Servicio en cola',
        serviceId: newService.id,
        status: 'WAITING',
        warning: 'Todos los profesionales disponibles fueron tomados por otras solicitudes.'
      });
    }

    res.status(201).json({
      message: 'Servicio solicitado correctamente',
      serviceId: newService.id,
      assignedTo: assigned.fullName,
      distanceKm: parseFloat(assigned.distanceKm).toFixed(2),
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
  const { search, profession, provinceId, cityId, modality, page = 1, limit = 15 } = req.query;

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

    if (modality) {
      where.modalities = { has: modality as string };
    }

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
    credentialUrl,
    modalities,
    professionalTermsAccepted,
    professionType,
    licenseNumber,
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

       if (!professionalTermsAccepted) {
      return res.status(400).json({ error: 'Debés aceptar los Términos y Condiciones para Profesionales' });
    }

    if (professionType === 'REGULATED_PROFESSION') {
      if (!licenseNumber || typeof licenseNumber !== 'string' || !licenseNumber.trim()) {
        return res.status(400).json({ error: 'Debés indicar tu número de matrícula profesional' });
      }
      if (!credentialUrl) {
        return res.status(400).json({ error: 'Debés subir tu título o certificado de matrícula' });
      }
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
        credentialUrl: credentialUrl || null,
        professionType: professionType === 'REGULATED_PROFESSION' ? 'REGULATED_PROFESSION' : 'TRADE',
        licenseNumber: licenseNumber?.trim() || null,
        modalities: modalities || ['TIME_BASED'],
        isActive: false,
        status: 'PENDING',
        vehicleType: profession.trim(),
        provinceId: req.dbUser.provinceId,     // Heredamos del usuario
        cityId: req.dbUser.cityId,             // Heredamos del usuario
        professionalTermsAcceptedAt: new Date(),
        professionalTermsVersion: 'v1',
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
// El PROFESIONAL propone el monto acordado
app.patch('/services/:serviceId/propose-amount', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;
  const { amount } = req.body;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo el profesional puede proponer el monto' });
    }

    const professional = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    if (!professional) return res.status(404).json({ error: 'Perfil no encontrado' });

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (service.professionalId !== professional.id) {
      return res.status(403).json({ error: 'Este servicio no te fue asignado' });
    }
    if (service.status !== 'COMPLETED' || service.amount) {
      return res.status(400).json({ error: 'Este servicio no está esperando un monto' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Monto inválido' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { proposedAmount: Number(amount), amountProposedAt: new Date() },
    });

    res.json({ message: 'Monto propuesto al cliente', service: updated });
  } catch (error: any) {
    console.error('💥 Error proponiendo monto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// El CLIENTE confirma el monto propuesto → dispara el cobro
app.patch('/services/:serviceId/confirm-amount', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo el solicitante puede confirmar el monto' });
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'No puedes modificar este servicio' });
    }
    if (!service.proposedAmount) {
      return res.status(400).json({ error: 'No hay ningún monto propuesto para confirmar' });
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: { amount: service.proposedAmount },
    });

   res.json({
      message: 'Monto confirmado',
      service: updated,
      importe: updated.amount,
    });
  } catch (error: any) {
    console.error('💥 Error confirmando monto:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// El CLIENTE rechaza el monto propuesto → vuelve a esperar una nueva propuesta
app.patch('/services/:serviceId/reject-amount', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'USER') {
      return res.status(403).json({ error: 'Solo el solicitante puede rechazar el monto' });
    }

    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    if (service.requesterId !== req.user.id) {
      return res.status(403).json({ error: 'No puedes modificar este servicio' });
    }

    await prisma.service.update({
      where: { id: serviceId },
      data: { proposedAmount: null, amountProposedAt: null },
    });

    res.json({ message: 'Monto rechazado. Podés acordar un nuevo monto por chat.' });
  } catch (error: any) {
    console.error('💥 Error rechazando monto:', error);
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
app.post('/register', authenticate, async (req: any, res: any) => {
  const { firstName, lastName, address, photoUrl, provinceId, cityId, termsAccepted } = req.body;
  const id = req.user.id;
  const email = req.user.email!;

  try {
    if (!termsAccepted) {
      return res.status(400).json({ error: 'Debés aceptar los Términos y Condiciones y la Política de Privacidad' });
    }

    const user = await prisma.user.upsert({
      where: { id },
      update: {
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        address: address?.trim() || null,
        photoUrl: photoUrl || null,
        provinceId: provinceId || null,
        cityId: cityId || null,
        termsAcceptedAt: new Date(),
        termsVersion: 'v1',
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
        termsAcceptedAt: new Date(),
        termsVersion: 'v1',
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
        profession: true,
        modalities: true
      }
    });

    const modalitiesByProfession = new Map<string, Set<string>>();

   const PAYMENT_MODALITIES = ['TIME_BASED', 'FIXED_PRICE'];

    for (const p of professionals) {
      if (!modalitiesByProfession.has(p.profession)) {
        modalitiesByProfession.set(p.profession, new Set());
      }
      const set = modalitiesByProfession.get(p.profession)!;
      const mods = Array.isArray(p.modalities) ? p.modalities : [p.modalities];
      mods.forEach((m: any) => { if (PAYMENT_MODALITIES.includes(m)) set.add(m); });
    }

    const professions = Array.from(modalitiesByProfession.entries())
      .map(([key, modalities]) => ({
        key,
        modalities: Array.from(modalities),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    res.json({ professions });

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
  if (!provinceId) {
    return res.status(400).json({ error: 'provinceId es requerido' });
  }
  try {
    const cities = await prisma.city.findMany({
      where: { provinceId: provinceId as string },
      orderBy: { name: 'asc' }
    });
    res.json({ cities });
  } catch (error) {
    res.status(500).json({ error: 'Error al cargar ciudades' });
  }
});


// Encontrar o crear chat entre usuario y profesional
app.post('/chats/find-or-create', authenticate, async (req: any, res: any) => {
  const { professionalId: otherUserId } = req.body; // esto es un USER id
  const userId = req.user.id;

  try {
    if (!otherUserId) {
      return res.status(400).json({ error: 'professionalId es requerido' });
    }
    if (otherUserId === userId) {
      return res.status(400).json({ error: 'No podés chatear con vos mismo' });
    }

    const [myProfile, otherProfile] = await Promise.all([
      prisma.professional.findUnique({ where: { userId }, select: { id: true } }),
      prisma.professional.findUnique({ where: { userId: otherUserId }, select: { id: true } }),
    ]);

    let requesterId: string;
    let professionalRecordId: string;

    if (otherProfile) {
      // Caso normal: yo contacto a un profesional
      requesterId = userId;
      professionalRecordId = otherProfile.id;
    } else if (myProfile) {
      // Caso inverso: yo soy el profesional, el otro es cliente
      requesterId = otherUserId;
      professionalRecordId = myProfile.id;
    } else {
      return res.status(400).json({ error: 'Ninguno de los dos tiene perfil profesional' });
    }

    let service = await prisma.service.findFirst({
      where: { requesterId, professionalId: professionalRecordId },
      orderBy: [{ status: 'asc' }, { id: 'desc' }]
    });

    if (!service) {
      service = await prisma.service.create({
        data: {
          requesterId,
          professionalId: professionalRecordId, // ← Professional.id correcto, siempre
          type: 'CHAT',
          status: 'CHAT',
          requestedAt: new Date(),
        }
      });
    }

    res.json({ serviceId: service.id, status: service.status });
  } catch (error: any) {
    console.error('❌ Error find-or-create:', error);
    res.status(500).json({ error: 'Error al inicializar chat' });
  }
});
 
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
        requester: { select: { id: true, firstName: true, lastName: true } },
        professional: {
          select: {
            id: true,
            profession: true,          // ← agregado
            user: { select: { id: true, firstName: true, lastName: true } }
          }
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { sender: { select: { id: true, firstName: true, lastName: true } } }
        }
      },
      orderBy: { id: 'desc' }
    });

    const grouped = new Map();

    conversations.forEach((conv: any) => {
  const professionalUserId = conv.professional?.user?.id;
  if (!professionalUserId) return; // dato corrupto legacy, correr el script de abajo

  const isUserTheProfessional = professionalUserId === userId;
  const otherUserId = isUserTheProfessional ? conv.requesterId : professionalUserId;
  const otherUser = isUserTheProfessional ? conv.requester : conv.professional.user;

  if (!otherUserId || otherUserId === userId) return;

  const otherName = otherUser
    ? `${otherUser.firstName || ''} ${otherUser.lastName || ''}`.trim()
    : 'Usuario';

  const lastMessage = conv.messages[0];
  const lastMessageDate = lastMessage?.createdAt || conv.requestedAt;

  const existing = grouped.get(otherUserId);
  if (!existing || new Date(lastMessageDate) > new Date(existing._lastMessageDate)) {
    grouped.set(otherUserId, {
      id: conv.id, type: conv.type, status: conv.status,
      otherUserId, otherName,
      lastMessage: lastMessage?.content || null,
      unreadCount: 0,
      _lastMessageDate: lastMessageDate,
    });
  }
});

    const unifiedConversations = Array.from(grouped.values())
      .map(({ _lastMessageDate, ...rest }) => rest)
      .sort((a: any, b: any) => new Date(b._lastMessageDate || 0).getTime() - new Date(a._lastMessageDate || 0).getTime());

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

app.get('/chats/:professionalId/messages', authenticate, async (req: any, res: any) => {
  const userId = req.user.id;
  const { professionalId: otherUserId } = req.params;

  if (userId === otherUserId) return res.json({ messages: [] });

  try {
    const services = await prisma.service.findMany({
      where: {
        OR: [
          { requesterId: userId, professional: { userId: otherUserId } },
          { requesterId: otherUserId, professional: { userId } },
        ]
      },
      select: { id: true }
    });

    const serviceIds = services.map(s => s.id);
    if (serviceIds.length === 0) return res.json({ messages: [] });

    const messages = await prisma.message.findMany({
      where: { serviceId: { in: serviceIds } },
      include: { sender: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json({ messages: messages.reverse() });
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

    // Sanitizamos: solo letras, números, punto, guion y guion bajo.
    // Bloquea path traversal (../) y separadores de ruta.
    const safeFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');

    const filePath = `professionals/${req.user.id}/${Date.now()}-${safeFileName}`;

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
      path: filePath
    });

  } catch (error: any) {
    console.error('Error generando signed URL:', error);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

// Genera una URL temporal para ver un documento de un profesional.
// Solo el propio profesional o un admin pueden pedirla.
app.get('/professionals/:id/document-url', authenticate, async (req: any, res: any) => {
  const { id } = req.params;
  const { path } = req.query;

  if (!path || typeof path !== 'string') {
    return res.status(400).json({ error: 'path es requerido' });
  }

  try {
    const professional = await prisma.professional.findUnique({ where: { id } });
    if (!professional) return res.status(404).json({ error: 'Profesional no encontrado' });

    const isOwner = professional.userId === req.user.id;
    const isAdmin = req.dbUser.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'No tenés permiso para ver este documento' });
    }

    // El path debe pertenecer efectivamente a este profesional (evita que
    // alguien pase el path de otro profesional una vez que probó ser dueño/admin)
    if (!path.startsWith(`professionals/${professional.userId}/`)) {
      return res.status(403).json({ error: 'Documento no pertenece a este profesional' });
    }

    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 300); // 5 minutos

    if (error) throw error;

    res.json({ url: data.signedUrl, expiresIn: 300 });
  } catch (error: any) {
    console.error('Error generando URL de lectura:', error);
    res.status(500).json({ error: 'Error interno al generar la URL' });
  }
});

app.post('/reports', authenticate, async (req: any, res: any) => {
    const { reason, details, reportedProfessionalId, serviceId, platform } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Falta el motivo del reporte' });
  }

  try {
    const report = await prisma.report.create({
      data: {
        reason,
        details: details || null,
        reporterId: req.user.id,
        reportedProfessionalId: reportedProfessionalId || null,
        serviceId: serviceId || null,
        platform: platform || null,
      },
    });

    res.status(201).json({ report });
  } catch (error) {
    console.error('Error creando reporte:', error);
    res.status(500).json({ error: 'No se pudo crear el reporte' });
  }
});

app.patch('/services/:id/cancel', authenticate, async (req: any, res: any) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const service = await prisma.service.findUnique({ where: { id } });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    if (service.requesterId !== userId) {
      return res.status(403).json({ error: 'No podés cancelar este servicio' });
    }

      if (service.status === 'ACCEPTED') {
      return res.status(409).json({
        error: 'El profesional ya aceptó y puede estar en camino. Para cancelar, primero tenés que confirmar el cargo de cancelación.',
        requiresCharge: true,
      });
    }

    const cancelableStatuses = ['REQUESTED', 'OFFERED'];
    if (!cancelableStatuses.includes(service.status)) {
      return res.status(400).json({ error: 'Este servicio ya no se puede cancelar' });
    }

    const updated = await prisma.service.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    res.json({ service: updated });
  } catch (error) {
    console.error('Error cancelando servicio:', error);
    res.status(500).json({ error: 'No se pudo cancelar el servicio' });
  }
});

app.post('/payments/link', authenticate, async (req, res) => {
  const { cardToken } = req.body;
  const userId = (req as any).user.id;

  if (!cardToken) return res.status(400).json({ error: 'Falta el token de la tarjeta' });

  try {
    let existing = await prisma.paymentMethod.findUnique({ where: { userId } });
    let mpCustomerId = existing?.mpCustomerId;

     if (!mpCustomerId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      console.log('🔵 [MP LINK] Creando customer para:', user!.email);
      try {
        const customerRes = await axios.post(`${MP_API}/v1/customers`, {
          email: user!.email,
          first_name: user!.firstName,
          last_name: user!.lastName,
        }, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });
        mpCustomerId = customerRes.data.id;
        console.log('✅ [MP LINK] Customer creado:', mpCustomerId);
      } catch (customerError: any) {
        const alreadyExists = customerError.response?.data?.cause?.some(
          (c: any) => c.code === '101'
        );

        if (alreadyExists) {
          const searchRes = await axios.get(
            `${MP_API}/v1/customers/search`,
            {
              params: { email: user!.email },
              headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
            }
          );
          const found = searchRes.data.results?.[0];
          if (!found) throw customerError;
          mpCustomerId = found.id;
        } else {
          throw customerError;
        }
      }
    }
      

    if (!mpCustomerId) {
      throw new Error('No se pudo crear el customer de Mercado Pago');
    }

   console.log('🔵 [MP LINK] Asociando tarjeta al customer:', mpCustomerId, '| token:', cardToken);

    let card;
    try {
      const cardRes = await axios.post(`${MP_API}/v1/customers/${mpCustomerId}/cards`,
        { token: cardToken }, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });
      card = cardRes.data;
      console.log('✅ [MP LINK] Tarjeta asociada:', card.id, '| BIN:', card.first_six_digits);
    } catch (cardError: any) {
      console.error('💥 [MP LINK] Error asociando TARJETA:', JSON.stringify(cardError.response?.data, null, 2));
      throw cardError;
    }

    // Recién ahora que la tarjeta nueva quedó confirmada, borramos la anterior (si había)
    if (existing?.mpCardId && existing.mpCardId !== card.id) {
      await axios.delete(`${MP_API}/v1/customers/${mpCustomerId}/cards/${existing.mpCardId}`,
        { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }).catch(() => {});
    }

    const paymentMethod = await prisma.paymentMethod.upsert({
      where: { userId },
      update: {
        mpCustomerId, mpCardId: card.id, cardBrand: card.payment_method?.name,
        cardPaymentMethodId: card.payment_method?.id,
        cardLastFour: card.last_four_digits, cardExpMonth: card.expiration_month,
        cardExpYear: card.expiration_year, linkedAt: new Date(),
      },
      create: {
        userId, mpCustomerId, mpCardId: card.id, cardBrand: card.payment_method?.name,
        cardPaymentMethodId: card.payment_method?.id,
        cardLastFour: card.last_four_digits, cardExpMonth: card.expiration_month,
        cardExpYear: card.expiration_year,
      },
    });

    res.json({ linked: true, cardLastFour: paymentMethod.cardLastFour, cardBrand: paymentMethod.cardBrand });
  } catch (error: any) {
    console.error('Error vinculando MP (resumen):', error.response?.data || error.message);
    res.status(400).json({ error: 'No se pudo vincular la tarjeta. Verificá los datos e intentá de nuevo.' });
  }
});

app.get('/payments/status', authenticate, async (req, res) => {
  const userId = (req as any).user.id;
  const pm = await prisma.paymentMethod.findUnique({ where: { userId } });
  res.json(pm ? { linked: true, cardBrand: pm.cardBrand, cardLastFour: pm.cardLastFour, cardId: pm.mpCardId } : { linked: false });
});

app.delete('/payments/unlink', authenticate, async (req, res) => {
  const userId = (req as any).user.id;
  const pm = await prisma.paymentMethod.findUnique({ where: { userId } });
  if (!pm) return res.json({ unlinked: true });

  const pending = await prisma.service.findFirst({
    where: { requesterId: userId, status: 'COMPLETED', paidAt: null },
  });
  if (pending) return res.status(400).json({ error: 'Tenés un pago pendiente. Regularizalo antes de desvincular.' });

  await axios.delete(`${MP_API}/v1/customers/${pm.mpCustomerId}/cards/${pm.mpCardId}`,
    { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }).catch(() => {});
  await prisma.paymentMethod.delete({ where: { userId } });
  res.json({ unlinked: true });
});

function validateWebhookSignature(req: any): boolean {
  const xSignature = req.headers['x-signature'] as string;
  const xRequestId = req.headers['x-request-id'] as string;
  const dataId = ((req.query['data.id'] as string) || '').toLowerCase();
  const secret = process.env.MP_WEBHOOK_SECRET as string;

  console.log('🔐 [WEBHOOK SIGNATURE] query completo:', JSON.stringify(req.query));
  console.log('🔐 [WEBHOOK SIGNATURE] dataId extraído:', dataId);
  console.log('🔐 [WEBHOOK SIGNATURE] x-signature header:', xSignature);
  console.log('🔐 [WEBHOOK SIGNATURE] x-request-id header:', xRequestId);
  console.log('🔐 [WEBHOOK SIGNATURE] secret cargado, longitud:', secret?.length);
  console.log('🔐 [WEBHOOK SIGNATURE] secret entre comillas (para ver espacios):', JSON.stringify(secret));

  if (!xSignature || !secret) {
    console.log('🔐 [WEBHOOK SIGNATURE] Falta xSignature o secret, rechazando');
    return false;
  }

  let ts: string | undefined;
  let hash: string | undefined;
  for (const part of xSignature.split(',')) {
    const [key, val] = part.split('=');
    if (key?.trim() === 'ts') ts = val?.trim();
    if (key?.trim() === 'v1') hash = val?.trim();
  }
  if (!ts || !hash) {
    console.log('🔐 [WEBHOOK SIGNATURE] No se pudo extraer ts/hash del header');
    return false;
  }

  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (xRequestId) parts.push(`request-id:${xRequestId}`);
  parts.push(`ts:${ts}`);
  const manifest = parts.join(';') + ';';

  console.log('🔐 [WEBHOOK SIGNATURE] manifest construido:', manifest);

  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  console.log('🔐 [WEBHOOK SIGNATURE] hash calculado:', computed);
  console.log('🔐 [WEBHOOK SIGNATURE] hash recibido:  ', hash);

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  } catch {
    console.log('🔐 [WEBHOOK SIGNATURE] Error en timingSafeEqual (probablemente largos distintos)');
    return false;
  }
}

app.post('/webhooks/mercadopago', async (req, res) => {
  try {
    if (!validateWebhookSignature(req)) {
      console.warn('⚠️ Webhook con firma inválida, ignorado');
      return res.sendStatus(401);
    }

    const orderId = (req.query['data.id'] as string) || req.body?.data?.id;
    console.log('📩 [WEBHOOK] Notificación recibida, orderId:', orderId);

    if (!orderId) {
      console.log('⚠️ [WEBHOOK] Sin orderId en la notificación, ignorando');
      return res.sendStatus(200);
    }

    const { data: order } = await axios.get(`${MP_API}/v1/orders/${orderId}`,
      { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });

    const payment = order.transactions?.payments?.[0];

    if (order.external_reference && payment) {
      const status = mapPaymentStatus(payment.status);
      await prisma.service.update({
        where: { id: order.external_reference },
        data: { mpPaymentId: String(payment.id), paymentStatus: status as any, paidAt: status === 'approved' ? new Date() : null },
      });
      console.log(`✅ [WEBHOOK] Servicio ${order.external_reference} actualizado a status: ${status}`);
    } else {
      console.log('⚠️ [WEBHOOK] Order sin external_reference o sin payment:', order.id);
    }
    res.sendStatus(200);
  } catch (error: any) {
    console.error('💥 [WEBHOOK] Error procesando notificación:', error.response?.data || error.message);
    res.sendStatus(200);
  }
});
 

// Genera el link que el profesional debe abrir para autorizar su cuenta
app.get('/professionals/mercadopago/auth-url', authenticate, async (req: any, res: any) => {
  if (req.dbUser.role !== 'PROFESSIONAL') {
    return res.status(403).json({ error: 'Solo profesionales pueden vincular su cuenta' });
  }

  const professional = await prisma.professional.findUnique({ where: { userId: req.user.id } });
  if (!professional) return res.status(404).json({ error: 'Perfil no encontrado' });

  // PKCE: generamos un verifier aleatorio y su challenge (SHA256, base64url)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  await prisma.professional.update({
    where: { id: professional.id },
    data: { mpPkceVerifier: codeVerifier },
  });

  const params = new URLSearchParams({
    client_id: process.env.MP_CLIENT_ID as string,
    response_type: 'code',
    platform_id: 'mp',
    redirect_uri: process.env.MP_OAUTH_REDIRECT_URI as string,
    state: professional.id,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.json({ url: `https://auth.mercadopago.com/authorization?${params.toString()}` });
});

// Mercado Pago redirige acá después de que el profesional autoriza
app.get('/professionals/mercadopago/callback', async (req: any, res: any) => {
  const { code, state: professionalId, error, error_description } = req.query;

  if (error) {
    console.error('💥 Mercado Pago rechazó la autorización:', error, error_description);
    return res.status(400).send(`Error de autorización: ${error_description || error}`);
  }

  if (!code || !professionalId) {
    return res.status(400).send('Faltan parámetros de autorización');
  }

  try {
    const professional = await prisma.professional.findUnique({ where: { id: professionalId as string } });
    if (!professional?.mpPkceVerifier) {
      return res.status(400).send('No se encontró el verifier de esta solicitud. Volvé a intentar desde la app.');
    }

    const tokenRes = await axios.post(`${MP_API}/oauth/token`, {
      client_id: process.env.MP_CLIENT_ID,
      client_secret: process.env.MP_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.MP_OAUTH_REDIRECT_URI,
      code_verifier: professional.mpPkceVerifier,
    });

  // NUEVO
    const { access_token, refresh_token, user_id, expires_in } = tokenRes.data;

await prisma.professional.update({
      where: { id: professionalId as string },
      data: {
        mpUserId: String(user_id),
        mpAccessToken: encryptToken(access_token),
        mpRefreshToken: encryptToken(refresh_token),
        mpTokenExpiresAt: new Date(Date.now() + expires_in * 1000),
        mpPkceVerifier: null,
      },
    });

    // Página simple de confirmación — el profesional está en un WebView/browser en este punto
    res.send(`
      <html><body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding-top:80px;">
        <h2>✅ Cuenta vinculada correctamente</h2>
        <p>Ya podés volver a la app.</p>
      </body></html>
    `);
  } catch (error: any) {
    console.error('💥 Error en callback OAuth MP:', error.response?.data || error.message);
    res.status(500).send('Error al vincular la cuenta. Volvé a intentarlo desde la app.');
  }
});

// en tu index.ts, junto a tus otras rutas
app.get('/mp-card-form.html', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(buildCardFormHtml(process.env.MP_PUBLIC_KEY as string));
});

function buildCardFormHtml(publicKey: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  body { background:#000; margin:0; padding:20px; font-family: -apple-system, sans-serif; }
  #form-checkout { display:flex; flex-direction:column; gap:14px; }
  label { color:#60a5fa; font-weight:700; font-size:13px; }
  .field { background:#000; border:1px solid #60a5fa; border-radius:12px; padding:14px; height:20px; }
  input { background:#000; color:#fff; border:1px solid #60a5fa; border-radius:12px; padding:14px; font-size:16px; box-sizing:border-box; }
  button { background:#6388ba; color:#000; font-weight:700; font-size:17px; padding:16px; border:none; border-radius:16px; margin-top:10px; }
  #status { color:#ef4444; font-size:13px; margin-top:8px; min-height:16px; }
</style>
</head>
<body>
  <form id="form-checkout">
    <div>
      <label>Número de tarjeta</label>
      <div id="form-checkout__cardNumber" class="field"></div>
    </div>
    <div>
      <label>Titular</label>
      <input type="text" id="form-checkout__cardholderName" placeholder="Como figura en la tarjeta" />
    </div>
    <div style="display:flex; gap:10px;">
      <div style="flex:1">
        <label>Vencimiento</label>
        <div id="form-checkout__expirationDate" class="field"></div>
      </div>
      <div style="flex:1">
        <label>CVV</label>
        <div id="form-checkout__securityCode" class="field"></div>
      </div>
    </div>
    <div>
      <label>DNI</label>
      <input type="text" id="form-checkout__identificationNumber" placeholder="Sin puntos" />
    </div>
    <select id="form-checkout__identificationType" style="display:none"></select>
    <select id="form-checkout__issuer" style="display:none"></select>
    <select id="form-checkout__installments" style="display:none"></select>

    <button type="submit">Vincular Tarjeta</button>
    <div id="status"></div>
  </form>

  <script src="https://sdk.mercadopago.com/js/v2"></script>
  <script>
    const mp = new MercadoPago("${publicKey}");

    function post(payload) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    }

    const cardForm = mp.cardForm({
      amount: "100",
      iframe: true,
      form: {
        id: "form-checkout",
        cardNumber: { id: "form-checkout__cardNumber", placeholder: "Número de tarjeta" },
        expirationDate: { id: "form-checkout__expirationDate", placeholder: "MM/YY" },
        securityCode: { id: "form-checkout__securityCode", placeholder: "CVV" },
        cardholderName: { id: "form-checkout__cardholderName", placeholder: "Titular" },
        identificationType: { id: "form-checkout__identificationType" },
        identificationNumber: { id: "form-checkout__identificationNumber", placeholder: "DNI" },
        issuer: { id: "form-checkout__issuer" },
        installments: { id: "form-checkout__installments" },
      },
      callbacks: {
        onFormMounted: (error) => {
          if (error) post({ success: false, error: "No se pudo cargar el formulario" });
        },
        onSubmit: (event) => {
          event.preventDefault();
          try {
            const data = cardForm.getCardFormData();
            post({ success: true, token: data.token });
          } catch (e) {
            post({ success: false, error: "No se pudo generar el token de la tarjeta" });
          }
        },
        onError: (errors) => {
          document.getElementById('status').innerText = 'Verificá los datos de la tarjeta';
          post({ success: false, error: "Verificá los datos de la tarjeta" });
        },
      },
    });
  </script>
</body>
</html>`;
}

const OFFER_INACTIVITY_MINUTES = 4; // minutos sin actividad (chat) antes de reasignar
const OFFER_CHECK_INTERVAL_MS = 30_000; // cada cuánto revisamos ofertas vencidas

setInterval(async () => {
  try {
    // Por cada servicio OFFERED, la "referencia" de actividad es el último mensaje
    // (de cualquiera de las dos partes) si existe, o offeredAt si todavía no chatearon.
    // Se reasigna cuando pasaron más de OFFER_INACTIVITY_MINUTES desde esa referencia.
     const expired = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      SELECT s.id
      FROM "services" s
      LEFT JOIN LATERAL (
        SELECT MAX(m."createdAt") AS "lastMessageAt"
        FROM "Message" m
        WHERE m."serviceId" = s.id
      ) msg ON true
      WHERE s.status = 'OFFERED'
        AND GREATEST(s."offeredAt", COALESCE(msg."lastMessageAt", s."offeredAt"))
            < NOW() - INTERVAL '${OFFER_INACTIVITY_MINUTES} minutes';
    `);

    console.log(`🔍 [OFFER TIMEOUT] Chequeo ejecutado — vencidos encontrados: ${expired.length}`);

    for (const service of expired) {
      const result = await reassignService(prisma, service.id);
      console.log(
        `⏱️ [OFFER TIMEOUT] Servicio ${service.id}:`,
        result.reassigned ? `reasignado a ${result.professional.fullName}` : result.reason
      );
    }
  } catch (error) {
    console.error('💥 [OFFER TIMEOUT] Error en el job:', error);
  }
}, OFFER_CHECK_INTERVAL_MS);


app.get('/services/:id/payment-breakdown', authenticate, async (req: any, res: any) => {
  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service || service.requesterId !== req.user.id) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  if (!service.amount) {
    return res.status(400).json({ error: 'Todavía no hay un monto definido' });
  }
   res.json({ professionalAmount: service.amount, totalToCharge: service.amount });
});

app.get('/professional/mercadopago-status', authenticate, async (req: any, res: any) => {
  if (req.dbUser.role !== 'PROFESSIONAL') {
    return res.status(403).json({ error: 'Solo profesionales' });
  }
  const professional = await prisma.professional.findUnique({
    where: { userId: req.user.id },
    select: { mpAccessToken: true },
  });
  res.json({ linked: !!professional?.mpAccessToken });
});

app.get('/services/:id/signal-breakdown', authenticate, async (req: any, res: any) => {
  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service || service.requesterId !== req.user.id) {
    return res.status(404).json({ error: 'No encontrado' });
  }
    let signalAmount: number | undefined;
  try {
    const config = getServiceConfig(service.type);
    signalAmount = config?.signalAmount;
  } catch {
    signalAmount = undefined;
  }
  if (!signalAmount) {
    return res.status(400).json({ error: 'Esta profesión no tiene configurada una seña' });
  }
  res.json({ signalAmount, totalToCharge: signalAmount });
});

app.post('/services/:id/charge-signal-with-token', authenticate, async (req: any, res: any) => {
  const { cardToken } = req.body;
  const userId = req.user.id;

  if (!cardToken) return res.status(400).json({ error: 'Falta el token de la tarjeta' });

  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service || service.requesterId !== userId) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  if (service.status !== 'ACCEPTED') {
    return res.status(400).json({ error: 'El servicio todavía no fue aceptado por el profesional' });
  }
  if (service.signalPaidAt) {
    return res.status(400).json({ error: 'La seña ya fue pagada' });
  }

  const result = await chargeSignalWithToken(req.params.id, cardToken);

  if (result.success) {
    return res.json({ approved: true });
  }
  if (result.reason === 'no_payment_method') {
    return res.status(400).json({ error: 'No tenés un método de pago vinculado' });
  }
  if (result.reason === 'no_signal_amount') {
    return res.status(400).json({ error: 'Esta profesión no tiene configurado un monto de seña' });
  }
  return res.status(402).json({ approved: false, detail: result.statusDetail || result.reason });
});

app.get('/services/:id/cancellation-charge-breakdown', authenticate, async (req: any, res: any) => {
  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service || service.requesterId !== req.user.id) {
    return res.status(404).json({ error: 'No encontrado' });
  }
    res.json({ chargeAmount: LATE_CANCEL_CHARGE_ARS, totalToCharge: LATE_CANCEL_CHARGE_ARS });
});

app.post('/services/:id/cancel-with-charge', authenticate, async (req: any, res: any) => {
  const { cardToken } = req.body;
  const userId = req.user.id;

  if (!cardToken) return res.status(400).json({ error: 'Falta el token de la tarjeta' });

  const service = await prisma.service.findUnique({ where: { id: req.params.id } });
  if (!service || service.requesterId !== userId) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  if (service.status !== 'ACCEPTED') {
    return res.status(400).json({ error: 'Este servicio ya no está en un estado que requiera este cargo' });
  }

  const result = await chargeLateCancellationWithToken(req.params.id, cardToken);

  if (result.success) {
    return res.json({ approved: true, cancelled: true });
  }
  if (result.reason === 'no_payment_method') {
    return res.status(400).json({ error: 'No tenés un método de pago vinculado' });
  }
  if (result.reason === 'professional_not_linked') {
    return res.status(400).json({ error: 'No se pudo procesar el cargo hacia el profesional' });
  }
  return res.status(402).json({ approved: false, detail: result.statusDetail || result.reason });
});

app.patch('/services/:serviceId/cancel-by-professional', authenticate, async (req: any, res: any) => {
  const { serviceId } = req.params;

  try {
    if (req.dbUser.role !== 'PROFESSIONAL') {
      return res.status(403).json({ error: 'Solo profesionales pueden usar este endpoint' });
    }

    const professional = await prisma.professional.findUnique({ where: { userId: req.user.id } });
    if (!professional) return res.status(404).json({ error: 'Perfil no encontrado' });

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      select: { id: true, professionalId: true, status: true, pickupLat: true, pickupLng: true, cityId: true, provinceId: true }
    });

    if (!service || service.professionalId !== professional.id || service.status !== 'ACCEPTED') {
      return res.status(403).json({ error: 'No podés cancelar este servicio' });
    }

    if (service.pickupLat == null || service.pickupLng == null || service.cityId == null || service.provinceId == null) {
      return res.status(500).json({ error: 'El servicio tiene datos de ubicación incompletos' });
    }

    const result = await reassignService(prisma, serviceId);

    await prisma.professional.update({
      where: { id: professional.id },
      data: { lateCancelCount: { increment: 1 } },
    });

    if (result.reassigned) {
      return res.json({
        message: 'Cancelaste el servicio. Se buscó y asignó a otro profesional disponible.',
        reassigned: true,
      });
    }

    const messages: Record<string, string> = {
      max_attempts: 'Cancelaste el servicio',
      no_candidates: 'Cancelaste el servicio',
      all_taken: 'Cancelaste el servicio',
    };

    return res.json({
      message: messages[result.reason as string] || 'Servicio cancelado.',
      reassigned: false,
    });

  } catch (error: any) {
    console.error('💥 Error al cancelar servicio (profesional):', error);
    res.status(500).json({ error: 'Error interno al cancelar' });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});