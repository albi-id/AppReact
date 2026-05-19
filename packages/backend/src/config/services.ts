// packages/backend/src/config/services.ts

export type ServiceTypeConfig = {
  key: string;
  label: string;
  pricePerMinute: number;
  basePrice: number;
};

export const SERVICE_TYPES: ServiceTypeConfig[] = [
  {
    key: 'CORTADOR_PASTO',
    label: 'CORTADOR_PASTO',
    pricePerMinute: 8,
    basePrice: 50,
  },
  {
    key: 'ASADOR',
    label: 'ASADOR',
    pricePerMinute: 12,
    basePrice: 80,
  },
  {
    key: 'LIMPIEZA',
    label: 'LIMPIEZA',
    pricePerMinute: 25,
    basePrice: 150,
  },
  
  {
    key: 'MUDANZA',
     label: 'MUDANZA',
    pricePerMinute: 15,
    basePrice: 100,
   },

    {
    key: 'INGENIERA',
     label: 'INGENIERA',
    pricePerMinute: 40,
    basePrice: 400,
   },
   {
  key: 'ELECTRICISTA',           // ← Clave única en mayúsculas
  label: 'ELECTRICISTA',         // ← Nombre bonito para mostrar
  basePrice: 70,                  // No se usa en fixed price
  pricePerMinute: 70,             // No se usa en fixed price
},


  // Agrega aquí nuevos servicios fácilmente:
  // {
  //   key: 'AMA_DE_CASA',
  //   label: 'Ama de Casa',
  //   pricePerMinute: 15,
  //   basePrice: 100,
  // },
];

export const getServiceConfig = (type: string): ServiceTypeConfig => {
  const service = SERVICE_TYPES.find(s => s.key === type);
  if (!service) throw new Error(`Tipo de servicio no encontrado: ${type}`);
  return service;
};