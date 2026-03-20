// prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.tariff.createMany({
    data: [
      { vehicleType: 'TAXI', hourlyRate: 3, currency: 'ARS' },
      { vehicleType: 'TRAFIC', hourlyRate: 10, currency: 'ARS' },
      { vehicleType: 'MOTO', hourlyRate: 2, currency: 'ARS' },
    ],
    skipDuplicates: true,
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());