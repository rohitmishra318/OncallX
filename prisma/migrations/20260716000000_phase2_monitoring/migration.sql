-- Phase 2: Add publicSlug to Team, CheckResult, CheckResultHourly, MaintenanceWindow

-- Team.publicSlug
ALTER TABLE "Team" ADD COLUMN "publicSlug" TEXT;
CREATE UNIQUE INDEX "Team_publicSlug_key" ON "Team"("publicSlug");

-- CheckResult table
CREATE TABLE "CheckResult" (
    "id"         TEXT NOT NULL,
    "targetId"   TEXT NOT NULL,
    "timestamp"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success"    BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "latencyMs"  INTEGER,
    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CheckResult_targetId_timestamp_idx" ON "CheckResult"("targetId", "timestamp");

-- CheckResultHourly table
CREATE TABLE "CheckResultHourly" (
    "id"            TEXT NOT NULL,
    "targetId"      TEXT NOT NULL,
    "hourBucket"    TIMESTAMP(3) NOT NULL,
    "uptimePercent" DOUBLE PRECISION NOT NULL,
    "avgLatencyMs"  DOUBLE PRECISION NOT NULL,
    "p95LatencyMs"  DOUBLE PRECISION NOT NULL,
    "totalChecks"   INTEGER NOT NULL,
    "failedChecks"  INTEGER NOT NULL,
    CONSTRAINT "CheckResultHourly_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CheckResultHourly_targetId_hourBucket_key" ON "CheckResultHourly"("targetId", "hourBucket");
CREATE INDEX "CheckResultHourly_targetId_hourBucket_idx" ON "CheckResultHourly"("targetId", "hourBucket");

-- MaintenanceWindow table
CREATE TABLE "MaintenanceWindow" (
    "id"          TEXT NOT NULL,
    "targetId"    TEXT NOT NULL,
    "startsAt"    TIMESTAMP(3) NOT NULL,
    "endsAt"      TIMESTAMP(3) NOT NULL,
    "reason"      TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);
