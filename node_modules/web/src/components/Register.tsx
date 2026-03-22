import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  //const navigate = useNavigate();

  const isValidEmail = (em: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);

  const handleRegister = async () => {
    setError('');
    setSuccess(false);

    if (!isValidEmail(email)) {
      setError('Email inválido');
      return;
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Error al registrarse');
        return;
      }

      setSuccess(true);
      // No redirigimos automáticamente porque necesita validar el email
    } catch (err) {
      setError('Error de conexión con el servidor');
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl shadow-2xl p-8">
        <h2 className="text-4xl font-bold text-white mb-2 text-center">Crear cuenta</h2>
        <p className="text-gray-400 mb-10 text-center">Registrate en segundos</p>

        {error && <p className="text-red-500 mb-6 bg-red-900/30 p-4 rounded-lg">{error}</p>}

        {success && (
          <div className="bg-green-900/40 border border-green-600 text-green-200 p-6 rounded-xl mb-8 text-center">
            <h3 className="text-xl font-bold mb-3">¡Registro exitoso!</h3>
            <p className="mb-4">
              Te enviamos un correo de confirmación a <strong>{email}</strong>.
            </p>
            <p className="mb-4">
              Revisa tu bandeja de entrada (y la carpeta de spam) y haz clic en el link de verificación para activar tu cuenta.
            </p>
            <p className="text-sm opacity-80">
              Una vez confirmado el email, podrás iniciar sesión con tu correo y contraseña.
            </p>
            <p className="mt-6 text-sm">
              ¿No recibiste el correo? <button className="text-green-400 underline hover:text-green-300">Reenviar</button> (próximamente)
            </p>
          </div>
        )}

        {!success && (
          <div className="space-y-6">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition"
            />

            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition"
            />

            <button
              onClick={handleRegister}
              disabled={success}
              className="w-full bg-green-500 text-black p-5 rounded-xl font-bold text-lg hover:bg-green-400 transition disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              Registrarse
            </button>
          </div>
        )}

        <p className="mt-8 text-center text-gray-400">
          ¿Ya tenés cuenta? <Link to="/" className="text-green-500 hover:underline">Inicia sesión</Link>
        </p>
      </div>
    </div>
  );
}