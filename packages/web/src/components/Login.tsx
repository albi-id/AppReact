import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showResendButton, setShowResendButton] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError('');
    setShowResendButton(false);
    setResendMessage('');

    try {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Detectamos específicamente el error de email no confirmado
        if (
          data.error?.toLowerCase().includes('email not confirmed') ||
          data.error?.toLowerCase().includes('confirm your email') ||
          data.error?.toLowerCase().includes('email no confirmado') ||
          data.message?.toLowerCase().includes('confirm') ||
          data.msg?.toLowerCase().includes('confirm')
        ) {
          setError('Tu email aún no está confirmado.');
          setShowResendButton(true);
        } else {
          setError(data.error || data.message || 'Credenciales inválidas');
        }
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('userEmail', data.user.email || email);
      localStorage.setItem('userRole', data.user.role || 'USER');
      
      navigate('/dashboard');
    } catch (err) {
      setError('Error de conexión con el servidor');
      console.error(err);
    }
  };

  const handleResendConfirmation = async () => {
    if (!email) {
      setResendMessage('Ingresa tu email primero');
      return;
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/resend-confirmation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (response.ok) {
        setResendMessage('Correo de confirmación reenviado. Revisa tu bandeja (y spam).');
        setError('');
      } else {
        setResendMessage(data.error || 'No se pudo reenviar el correo');
      }
    } catch (err) {
      setResendMessage('Error al reenviar');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4">
      <div className="w-full max-w-md bg-gray-900 rounded-2xl shadow-2xl p-8">
        <h2 className="text-4xl font-bold text-white mb-2 text-center">Iniciar sesión</h2>
        <p className="text-gray-400 mb-10 text-center">Ingresa tus datos para continuar</p>

        {error && <p className="text-red-500 mb-6 bg-red-900/30 p-4 rounded-lg">{error}</p>}

        {resendMessage && <p className="text-green-500 mb-6 bg-green-900/30 p-4 rounded-lg">{resendMessage}</p>}

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
            onClick={handleLogin}
            className="w-full bg-green-500 text-black p-5 rounded-xl font-bold text-lg hover:bg-green-400 transition"
          >
            Iniciar Sesión
          </button>
        </div>

        {showResendButton && (
          <button
            onClick={handleResendConfirmation}
            className="mt-6 w-full bg-blue-600 text-white p-5 rounded-xl font-bold hover:bg-blue-500 transition"
          >
            Reenviar email de confirmación
          </button>
        )}

        <p className="mt-8 text-center text-gray-400">
          ¿No tenés cuenta? <Link to="/register" className="text-green-500 hover:underline">Registrate</Link>
        </p>
      </div>
    </div>
  );
}