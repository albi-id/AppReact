// packages/backend/src/config/services.ts

export type ServiceTypeConfig = {
  key: string;
  label: string;
  pricePerMinute: number;
  basePrice: number;
  signalAmount:number;
  professionType: 'REGULATED_PROFESSION' | 'TRADE';
};

export const SERVICE_TYPES: ServiceTypeConfig[] = [
    {
    key: 'Supervisora c/ retiro',
    label: 'Supervisora c/ retiro',
    pricePerMinute: 77.4222,  // $4.645,33 / 60
    basePrice: 387.11,        // pricePerMinute * 5 (5 min mínimos)
    signalAmount: 10,
    professionType: 'TRADE'
  },
    
{
    key: 'Personal para tareas específicas c/ retiro',
    label: 'Personal para tareas específicas c/ retiro',
    pricePerMinute: 73.7090,  // $4.422,54 / 60
    basePrice: 368.55,        // pricePerMinute * 5
    signalAmount: 10,
    professionType: 'TRADE'
  },
 {
    key: 'Ninero/a', //Cuidador/a de personas c/ retiro
    label: 'Ninero/a',
    pricePerMinute: 69.7656,  // $4.185,94 / 60 — ⚠️ ver nota de confianza abajo
    basePrice: 348.82,        // pricePerMinute * 5
    signalAmount: 10,
    professionType: 'TRADE'
  },
   {
    key: 'Ninero/a', //Cuidador/a de personas c/ retiro
    label: 'Ninero/a',
    pricePerMinute: 0,   
    basePrice: 0,         
    signalAmount: 10,
    professionType: 'TRADE'
  },
   {
    key: 'Cuidador/a de adultos mayores', //Cuidador/a de personas c/ retiro
    label: 'Cuidador/a de adultos mayores',
    pricePerMinute: 69.7656,  // $4.185,94 / 60 — ⚠️ ver nota de confianza abajo
    basePrice: 348.82,        // pricePerMinute * 5
    signalAmount: 10,
    professionType: 'TRADE'
  },
     {
    key: 'Cuidador/a de adultos mayores', //Cuidador/a de personas c/ retiro
    label: 'Cuidador/a de adultos mayores',
    pricePerMinute: 0,   
    basePrice: 0,        
    signalAmount: 10,
    professionType: 'TRADE'
  },

 {
    key: 'Personal para tareas generales c/ retiro',
    label: 'Personal para tareas generales c/ retiro',
    pricePerMinute: 65.2440,  // $3.914,64 / 60
    basePrice: 326.22,        // pricePerMinute * 5
    signalAmount: 10,
    professionType: 'TRADE'
  },
 
    {
    key: 'Ingeniero/a',
    label: 'Ingeniero/a',
    pricePerMinute: 0,
    basePrice: 0,
    signalAmount: 10,
    professionType: 'REGULATED_PROFESSION'
   },

       {
    key: 'Abogado/a',
    label: 'Abogado/a',
    pricePerMinute: 0,
    basePrice: 0,
    signalAmount: 10,
    professionType: 'REGULATED_PROFESSION'
   },
   
   {
  key: 'Electricista',           // por presupuesto por eso pongo 0
  label: 'Electricista',            
  basePrice: 0,                   
  pricePerMinute: 0,       
  signalAmount: 10,
  professionType: 'TRADE'       
},
{
    key: 'Electricista',
     label: 'Electricista',
    pricePerMinute: 2,
    basePrice: 12,
    signalAmount: 10,
    professionType: 'TRADE'
   },

{
  key: 'Jardinero/a',           // por presupuesto por eso pongo 0
  label: 'Jardinero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,
  professionType: 'TRADE'          
},

{
  key: 'Enfermero/a',            
  label: 'Enfermero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,        
  signalAmount: 10,
  professionType: 'REGULATED_PROFESSION'      
},

{
  key: 'Mecánico/a de auto',           
  label: 'Mecánico/a de auto',            
  basePrice: 0,                   
  pricePerMinute: 0,        
  signalAmount: 10,
  professionType: 'TRADE'      
},


{
  key: 'Mecánico/a de moto',           
  label: 'Mecánico/a de moto',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,
  professionType: 'TRADE'          
},

{
  key: 'Gomero/a',           
  label: 'Gomero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,   
  signalAmount: 10,
  professionType: 'TRADE'           
},

{
  key: 'Cerrajero/a',            
  label: 'Cerrajero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,
  professionType: 'TRADE'            
},

{
  key: 'Remolques',           
  label: 'Remolques',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10,
  professionType: 'TRADE'             
},

{
  key: 'Pintor/a',            
  label: 'Pintor/a',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10,
  professionType: 'TRADE'             
},

{
  key: 'Albañil',           
  label: 'Albañil',            
  basePrice: 0,                   
  pricePerMinute: 0,     
  signalAmount: 10,
  professionType: 'TRADE'         
},

{
  key: 'Plomero/a',            
  label: 'Plomero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,       
  signalAmount: 10,
  professionType: 'TRADE'       
},

{
  key: 'Herrero/a',            
  label: 'Herrero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,
  professionType: 'TRADE'         
},

{
  key: 'Canaletero/a',            
  label: 'Canaletero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,   
  signalAmount: 10, 
  professionType: 'TRADE'          
},

{
  key: 'Carpintero/a',            
  label: 'Carpintero/a',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,   
  professionType: 'TRADE'         
},

{
  key: 'Limpieza de terreno',           
  label: 'Limpieza de terreno',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,   
  professionType: 'TRADE'         
},
 
{
  key: 'Podólogo/a',            
  label: 'Podólogo/a',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10,  
  professionType: 'REGULATED_PROFESSION'           
},

{
  key: 'Manicura',           
  label: 'Manicura',            
  basePrice: 0,                   
  pricePerMinute: 0, 
  signalAmount: 10, 
  professionType: 'TRADE'            
},

{
  key: 'Peluquería',            
  label: 'Peluquería',            
  basePrice: 0,                   
  pricePerMinute: 0,  
  signalAmount: 10,
  professionType: 'TRADE'            
},

{
  key: 'Maquillador/a',             
  label: 'Maquillador/a',            
  basePrice: 0,                   
  pricePerMinute: 0,    
  signalAmount: 10,
  professionType: 'TRADE'          
},
  
];

export const getServiceConfig = (type: string): ServiceTypeConfig => {
  // Algunas profesiones tienen dos entradas con el mismo key: una en 0
  // (Por Trabajo Realizado, sin tarifa fija) y otra con precio real (Por
  // Tiempo Transcurrido). Esta función solo se usa para calcular el cobro
  // por tiempo, así que preferimos la entrada con precio real cuando hay
  // más de una coincidencia.
  const matches = SERVICE_TYPES.filter(s => s.key === type);
  const withPrice = matches.find(s => s.pricePerMinute > 0 || s.basePrice > 0);
  const service = withPrice || matches[0];
  if (!service) throw new Error(`Tipo de servicio no encontrado: ${type}`);
  return service;
};