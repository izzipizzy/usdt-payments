-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "hop1_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "hop1_tx_id" CHAR(64),
ADD COLUMN     "stage" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "via_address" VARCHAR(34);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_hop1_tx_id_key" ON "payouts"("hop1_tx_id");

