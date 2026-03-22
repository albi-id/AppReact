-- AlterEnum
ALTER TYPE "ServiceStatus" ADD VALUE 'PAID';

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tariff_vehicleType_key" ON "Tariff"("vehicleType");
