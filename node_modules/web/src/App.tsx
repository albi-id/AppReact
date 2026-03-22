import { useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { Transition } from '@headlessui/react';
import { UserCircle, X, LogOut, Car } from 'lucide-react';

import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import RequestService from './components/RequestService';
import ProtectedRoute from './components/ProtectedRoute';



function App() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Supabase (si lo necesitás global, ponlo aquí o en un contexto)
  // const supabase = createClient(
  //   import.meta.env.VITE_SUPABASE_URL || '',
  //   import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  // );

  // Session (si lo usás en el futuro, descomentalo)
  // const [session, setSession] = useState<any>(null);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navbar */}

<header className="fixed top-0 left-0 right-0 bg-black border-b border-gray-800 z-50">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex justify-between items-center h-16">
      <Link to="/dashboard" className="text-2xl font-bold">Neos</Link>

      {/* Botón de perfil SIEMPRE que haya token (USER o DRIVER) */}
      {localStorage.getItem('token') && (
        <button
          onClick={() => setIsMenuOpen(true)}
          className="p-2 rounded-full hover:bg-gray-900 transition"
        >
          <UserCircle size={32} className="text-white" />
        </button>
      )}
    </div>
  </div>
</header>

      {/* Menú lateral */}
 
 
 <Transition
  show={isMenuOpen}
  enter="transition duration-300 ease-out"
  enterFrom="opacity-0 translate-x-full"
  enterTo="opacity-100 translate-x-0"
  leave="transition duration-200 ease-in"
  leaveFrom="opacity-100 translate-x-0"
  leaveTo="opacity-0 translate-x-full"
>
  <div className="fixed top-0 right-0 h-full w-80 bg-gray-900 z-50 overflow-y-auto shadow-2xl">
    <div className="p-6">
      <div className="flex justify-end mb-6">
        <button onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white">
          <X size={28} />
        </button>
      </div>

      <div className="flex flex-col items-center mb-10">
        <div className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center text-5xl font-bold mb-4">
          {localStorage.getItem('token') ? localStorage.getItem('userEmail')?.[0]?.toUpperCase() || 'U' : 'I'}
        </div>
        <h3 className="text-xl font-semibold">
          {localStorage.getItem('token') ? localStorage.getItem('userEmail') || 'Usuario' : 'Invitado'}
        </h3>
        <p className="text-gray-400 text-sm mt-1">
          Rol: {localStorage.getItem('token') ? localStorage.getItem('userRole') || 'Pasajero' : 'No logueado'}
        </p>
      </div>

      {localStorage.getItem('token') ? (
        <button
          onClick={() => {
            localStorage.removeItem('token');
            localStorage.removeItem('userEmail');
            localStorage.removeItem('userRole');
            setIsMenuOpen(false);
            window.location.href = '/';
          }}
          className="w-full flex items-center justify-center gap-3 bg-red-900/30 text-red-400 p-4 rounded-xl hover:bg-red-900/50 transition"
        >
          <LogOut size={20} />
          Cerrar Sesión
        </button>
      ) : (
        <Link to="/" className="w-full flex items-center justify-center gap-3 bg-green-600 text-white p-4 rounded-xl hover:bg-green-500 transition">
          Iniciar Sesión
        </Link>
      )}
    </div>
  </div>
</Transition>

      {/* Overlay */}
      {isMenuOpen && (
        <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setIsMenuOpen(false)} />
      )}

      {/* Contenido principal */}
      <main className="pt-20 min-h-screen px-4 sm:px-6 lg:px-8 py-12 bg-black">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/request" element={<ProtectedRoute><RequestService /></ProtectedRoute>} />
        </Routes>
      </main>

      {/* Botón flotante */}
      <Link
        to="/request"
        className="fixed bottom-8 right-8 bg-green-500 text-white p-6 rounded-full shadow-2xl hover:bg-green-600 hover:scale-110 transition-all duration-300 z-50 flex items-center justify-center"
      >
        <Car size={36} />
      </Link>
    </div>
  );
}

export default App;