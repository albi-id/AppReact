// packages/backend/src/config/services.ts

export type ServiceTypeConfig = {
  key: string;
  label: string;
  pricePerMinute: number;
  basePrice: number;
};

export const SERVICE_TYPES: ServiceTypeConfig[] = [
  {
    key: 'Supervisora c/ retiro',
    label: 'Supervisora c/ retiro',
    pricePerMinute: 73.9795,  // sale de hacer $ 4.438,77 / 60 = 73,9795
    basePrice: 739.80, //basePrice * 10 osea 10 minutos minimo que se le pague 
  },
    
  {
    key: 'Personal para tareas específicas c/ retiro',
    label: 'Personal para tareas específicas c/ retiro',
    pricePerMinute: 70.3875,
    basePrice: 703.88,
  },
  {
    key: 'Cuidador/a de personas c/ retiro',
    label: 'Cuidado de personas c/ retiro',
    pricePerMinute: 66.6075,
    basePrice: 666.08,
  },

   {
    key: 'Personal para tareas generales c/ retiro',
     label: 'Personal para tareas generales c/ retiro',
    pricePerMinute: 62.2286,
    basePrice: 622.29,
   },

    {
    key: 'Ingeniero/a',
     label: 'Ingeniero/a',
    pricePerMinute: 0,
    basePrice: 0,
   },
   
   {
  key: 'Electricista',           // por presupuesto por eso pongo 0
  label: 'Electricista',            
  basePrice: 0,                   
  pricePerMinute: 0,              
},

{
  key: 'Jardinero/a',           // por presupuesto por eso pongo 0
  label: 'Jardinero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,              
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