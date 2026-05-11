// packages/backend/src/config/services.ts

export type ServiceTypeConfig = {
  key: string;
  label: string;
  pricePerMinute: number;
  basePrice: number;
};

export const SERVICE_TYPES: ServiceTypeConfig[] = [
  {
    key: 'MOTO',
    label: 'Moto',
    pricePerMinute: 8,
    basePrice: 50,
  },
  {
    key: 'TAXI',
    label: 'Taxi',
    pricePerMinute: 12,
    basePrice: 80,
  },
  {
    key: 'TRAFIC',
    label: 'Tráfic',
    pricePerMinute: 25,
    basePrice: 150,
  },
  
  {
    key: 'AMA_DE_CASA',
     label: 'Ama de Casa',
    pricePerMinute: 15,
    basePrice: 100,
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