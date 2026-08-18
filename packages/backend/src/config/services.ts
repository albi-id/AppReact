// packages/backend/src/config/services.ts

export type ServiceTypeConfig = {
  key: string;
  label: string;
  pricePerMinute: number;
  basePrice: number;
  signalAmount:number;
};

export const SERVICE_TYPES: ServiceTypeConfig[] = [
  {
    key: 'Supervisora c/ retiro',
    label: 'Supervisora c/ retiro',
    pricePerMinute: 73.9795,  // sale de hacer $ 4.438,77 / 60 = 73,9795
    basePrice: 739.80, //basePrice * 10 osea 10 minutos minimo que se le pague 
    signalAmount: 10,
  },
    
  {
    key: 'Personal para tareas específicas c/ retiro',
    label: 'Personal para tareas específicas c/ retiro',
    pricePerMinute: 70.3875,
    basePrice: 703.88,
    signalAmount: 10,
  },
  {
    key: 'Cuidador/a de personas c/ retiro',
    label: 'Cuidado de personas c/ retiro',
    pricePerMinute: 66.6075,
    basePrice: 666.08,
    signalAmount: 10,
  },

   {
    key: 'Personal para tareas generales c/ retiro',
     label: 'Personal para tareas generales c/ retiro',
    pricePerMinute: 62.2286,
    basePrice: 622.29,
    signalAmount: 10,
   },
 
    {
    key: 'Ingeniero/a',
    label: 'Ingeniero/a',
    pricePerMinute: 0,
    basePrice: 0,
    signalAmount: 10,
   },
   
   {
  key: 'Electricista',           // por presupuesto por eso pongo 0
  label: 'Electricista',            
  basePrice: 0,                   
  pricePerMinute: 0,       
  signalAmount: 10,       
},
{
    key: 'Electricista',
     label: 'Electricista',
    pricePerMinute: 30,
    basePrice: 450,
    signalAmount: 10,
   },

{
  key: 'Jardinero/a',           // por presupuesto por eso pongo 0
  label: 'Jardinero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,          
},

{
  key: 'Enfermero/a',            
  label: 'Enfermero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,        
  signalAmount: 10,      
},

{
  key: 'Mecánico/a de auto',           
  label: 'Mecánico/a de auto',            
  basePrice: 0,                   
  pricePerMinute: 0,        
  signalAmount: 10,      
},


{
  key: 'Mecánico/a de moto',           
  label: 'Mecánico/a de moto',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,          
},

{
  key: 'Gomero/a',           
  label: 'Gomero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,   
  signalAmount: 10,           
},

{
  key: 'Cerrajero/a',            
  label: 'Cerrajero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,            
},

{
  key: 'Remolques',           
  label: 'Remolques',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10,             
},

{
  key: 'Pintor/a',            
  label: 'Pintor/a',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10,             
},

{
  key: 'Albañil',           
  label: 'Albañil',            
  basePrice: 0,                   
  pricePerMinute: 0,     
  signalAmount: 10,         
},

{
  key: 'Plomero/a',            
  label: 'Plomero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,       
  signalAmount: 10,       
},

{
  key: 'Herrero/a',            
  label: 'Herrero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,          
},

{
  key: 'Canaletero/a',            
  label: 'Canaletero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,   
  signalAmount: 10,           
},

{
  key: 'Carpintero/a',            
  label: 'Carpintero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,            
},

{
  key: 'Limpieza de terreno',           
  label: 'Limpieza de terreno',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,            
},
 
{
  key: 'Podólogo/a',            
  label: 'Podólogo/a',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10,             
},

{
  key: 'Manicura',           
  label: 'Manicura',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10,             
},

{
  key: 'Peluquería',            
  label: 'Peluquería',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,            
},

{
  key: 'Maquillador/a',             
  label: 'Maquillador/a',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,          
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