import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function RequestService() {
  const [vehicleType, setVehicleType] = useState('MOTO');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (navigator.geolocation) {
      setLoadingLocation(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLat(position.coords.latitude.toFixed(6));
          setLng(position.coords.longitude.toFixed(6));
          setLoadingLocation(false);
        },
        (err) => {
          setError('No se pudo obtener ubicación: ' + err.message);
          setLoadingLocation(false);
        },
        { enableHighAccuracy: true }
      );
    } else {
      setError('Geolocalización no soportada');
    }
  }, []);

  const handleRequest = async () => {
    setError('');
    setSuccess('');

    const token = localStorage.getItem('token');
    if (!token) {
      setError('No estás logueado');
      return;
    }

    if (!lat || !lng) {
      setError('Espera a que se obtenga tu ubicación');
      return;
    }

    try {
      // 1. Crear el servicio
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/services/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicleType,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Error al solicitar');
        return;
      }

      setSuccess(`¡Servicio solicitado! ID: ${data.service.id}`);

      // 2. Asignar conductor más cercano automáticamente
      const matchRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/services/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ serviceId: data.service.id }),
      });

      const matchData = await matchRes.json();

      if (matchRes.ok) {
        setSuccess(`Servicio asignado al conductor más cercano (distancia: ${matchData.distanceKm} km)`);
        navigate('/dashboard');
      } else {
        setError(matchData.error || 'No hay conductores disponibles cerca');
        navigate('/dashboard');
      }
    } catch (err) {
      setError('Error de conexión al solicitar o asignar');
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] px-4">
      <div className="w-full max-w-lg bg-gray-900 rounded-2xl shadow-2xl p-8">
        <h2 className="text-3xl font-bold text-white mb-2 text-center">Solicitar Servicio</h2>
        <p className="text-gray-400 mb-8 text-center">Elige tipo y confirma tu ubicación</p>

        {error && <p className="text-red-500 mb-6 bg-red-900/30 p-4 rounded-lg">{error}</p>}
        {success && <p className="text-green-500 mb-6 bg-green-900/30 p-4 rounded-lg">{success}</p>}

        {loadingLocation && <p className="text-blue-400 mb-6 text-center">Obteniendo ubicación...</p>}

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Tipo de vehículo</label>
            <select
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              className="w-full p-4 bg-gray-800 border border-gray-700 rounded-xl text-white focus:border-green-500 transition"
            >
              <option value="MOTO">Moto</option>
              <option value="TAXI">Taxi</option>
              <option value="TRAFIC">Tráfico</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Latitud</label>
              <input
                type="text"
                value={lat}
                readOnly
                className="w-full p-4 bg-gray-800 border border-gray-700 rounded-xl text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Longitud</label>
              <input
                type="text"
                value={lng}
                readOnly
                className="w-full p-4 bg-gray-800 border border-gray-700 rounded-xl text-white"
              />
            </div>
          </div>

          <button
            onClick={handleRequest}
            disabled={loadingLocation || !lat || !lng}
            className="w-full bg-green-500 text-black p-5 rounded-xl font-bold text-lg hover:bg-green-400 transition disabled:bg-gray-600"
          >
            Solicitar Servicio
          </button>
        </div>
      </div>
    </div>
  );
}