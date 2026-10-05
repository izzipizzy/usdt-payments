-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('planned', 'energy_pending', 'ready', 'signing', 'broadcast', 'confirmed', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "resource_operations" ADD COLUMN     "payout_id" BIGINT;

-- CreateTable
CREATE TABLE "payouts" (
    "id" BIGSERIAL NOT NULL,
    "external_id" TEXT NOT NULL,
    "from_address" VARCHAR(34) NOT NULL,
    "to_address" VARCHAR(34) NOT NULL,
    "amount" BIGINT NOT NULL,
    "note" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'planned',
    "energy_source" "EnergySource" NOT NULL DEFAULT 'none',
    "energy_estimated" INTEGER,
    "energy_used" INTEGER,
    "resource_cost_sun" BIGINT,
    "trx_fee_burned_sun" BIGINT,
    "tx_id" CHAR(64),
    "expiration" TIMESTAMP(3),
    "unsigned_raw" JSONB,
    "signed_raw" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_by" TEXT NOT NULL,
    "broadcast_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_external_id_key" ON "payouts"("external_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_tx_id_key" ON "payouts"("tx_id");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "payouts_created_at_idx" ON "payouts"("created_at");

-- AddForeignKey
ALTER TABLE "resource_operations" ADD CONSTRAINT "resource_operations_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

