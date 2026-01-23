// src/index.ts
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

console.log('DATABASE_URL cargada:', process.env.DATABASE_URL ? 'Sí' : 'NO');

// Prisma Client clásico (lee DATABASE_URL del .env automáticamente)
const prisma = new PrismaClient();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const app = express();
const port = 3000;

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

app.listen(port, () => {
  console.log(`Server en http://localhost:${port}`);
  console.log(`→ Health: http://localhost:${port}/health`);
  console.log(`→ Usuarios: http://localhost:${port}/users`);
  console.log(`→ Registro: POST http://localhost:${port}/register`);
});