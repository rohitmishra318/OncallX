-- CreateTable
CREATE TABLE "MonitorTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "expectedStatus" INTEGER NOT NULL DEFAULT 200,
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "intervalMs" INTEGER NOT NULL DEFAULT 60000,
    "failureThreshold" INTEGER NOT NULL DEFAULT 3,
    "successThreshold" INTEGER NOT NULL DEFAULT 2,
    "degradedLatencyMs" INTEGER NOT NULL DEFAULT 2000,
    "apiKeyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorTarget_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MonitorTarget" ADD CONSTRAINT "MonitorTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorTarget" ADD CONSTRAINT "MonitorTarget_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
