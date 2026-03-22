import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import React from 'react';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) {
      navigate('/');
    }
  }, [token, navigate]);

  if (!token) {
    return <div className="flex h-screen items-center justify-center text-gray-400">Redirigiendo a login...</div>;
  }

  return <>{children}</>;
};

export default ProtectedRoute;