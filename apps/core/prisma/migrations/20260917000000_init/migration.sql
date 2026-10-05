-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Network" AS ENUM ('mainnet', 'nile');

-- CreateEnum
CREATE TYPE "AddressStatus" AS ENUM ('available', 'assigned', 'suspended', 'retired');

-- CreateEnum
CREATE TYPE "OnchainStatus" AS ENUM ('inactive', 'activated');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('confirmed', 'credited', 'sweeping', 'swept', 'rejected');

-- CreateEnum
CREATE TYPE "SweepStatus" AS ENUM ('planned', 'activating', 'energy_pending', 'ready', 'signing', 'broadcast', 'confirmed', 'failed', 'abandoned', 'superseded');

-- CreateEnum
CREATE TYPE "EnergySource" AS ENUM ('rental', 'own_pool', 'burn', 'none');

-- CreateEnum
CREATE TYPE "ResourceOpKind" AS ENUM ('rent_energy', 'delegate_energy', 'undelegate_energy', 'activate', 'send_trx', 'rent_bandwidth');

-- CreateEnum
CREATE TYPE "ResourceOpStatus" AS ENUM ('requested', 'delivered', 'failed', 'reclaimed', 'expired');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('pending', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "wallets" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "xpub" TEXT NOT NULL,
    "signer_key_id" TEXT NOT NULL DEFAULT 'default',
    "next_index" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_addresses" (
    "id" BIGSERIAL NOT NULL,
    "wallet_id" BIGINT NOT NULL,
    "derivation_index" INTEGER NOT NULL,
    "address" VARCHAR(34) NOT NULL,
    "address_hex" CHAR(42) NOT NULL,
    "public_key" TEXT NOT NULL,
    "alias" TEXT,
    "status" "AddressStatus" NOT NULL DEFAULT 'available',
    "onchain_status" "OnchainStatus" NOT NULL DEFAULT 'inactive',
    "activated_at" TIMESTAMP(3),
    "usdt_balance_cached" BIGINT NOT NULL DEFAULT 0,
    "balance_checked_at" TIMESTAMP(3),
    "oldest_unswept_at" TIMESTAMP(3),
    "last_deposit_at" TIMESTAMP(3),
    "last_sweep_at" TIMESTAMP(3),
    "suspend_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_cursors" (
    "id" SERIAL NOT NULL,
    "network" "Network" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'solid',
    "block_number" BIGINT NOT NULL,
    "block_hash" TEXT,
    "block_timestamp" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chain_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_events" (
    "id" BIGSERIAL NOT NULL,
    "network" "Network" NOT NULL,
    "tx_id" CHAR(64) NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_number" BIGINT NOT NULL,
    "block_timestamp" TIMESTAMP(3) NOT NULL,
    "contract_hex" CHAR(42) NOT NULL,
    "from_hex" CHAR(42) NOT NULL,
    "to_hex" CHAR(42) NOT NULL,
    "amount" BIGINT NOT NULL,
    "receipt_result" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3),
    "ignored_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" BIGSERIAL NOT NULL,
    "deposit_address_id" BIGINT NOT NULL,
    "chain_event_id" BIGINT NOT NULL,
    "tx_id" CHAR(64) NOT NULL,
    "log_index" INTEGER NOT NULL,
    "block_number" BIGINT NOT NULL,
    "from_address" VARCHAR(34) NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'confirmed',
    "confirmed_at" TIMESTAMP(3) NOT NULL,
    "credited_at" TIMESTAMP(3),
    "swept_at" TIMESTAMP(3),
    "sweep_id" BIGINT,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sweeps" (
    "id" BIGSERIAL NOT NULL,
    "deposit_address_id" BIGINT NOT NULL,
    "collector_address" VARCHAR(34) NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "SweepStatus" NOT NULL DEFAULT 'planned',
    "energy_source" "EnergySource" NOT NULL DEFAULT 'none',
    "energy_estimated" INTEGER,
    "energy_used" INTEGER,
    "bandwidth_used" INTEGER,
    "trx_fee_burned_sun" BIGINT,
    "resource_cost_sun" BIGINT,
    "tx_id" CHAR(64),
    "ref_block_bytes" TEXT,
    "ref_block_hash" TEXT,
    "expiration" TIMESTAMP(3),
    "unsigned_raw" JSONB,
    "signed_raw" JSONB,
    "broadcast_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "superseded_by" BIGINT,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sweeps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sweep_deposits" (
    "sweep_id" BIGINT NOT NULL,
    "deposit_id" BIGINT NOT NULL,

    CONSTRAINT "sweep_deposits_pkey" PRIMARY KEY ("sweep_id","deposit_id")
);

-- CreateTable
CREATE TABLE "resource_operations" (
    "id" BIGSERIAL NOT NULL,
    "sweep_id" BIGINT,
    "target_address" VARCHAR(34) NOT NULL,
    "kind" "ResourceOpKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "external_order_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "energy_amount" INTEGER,
    "bandwidth_amount" INTEGER,
    "cost_sun" BIGINT,
    "status" "ResourceOpStatus" NOT NULL DEFAULT 'requested',
    "tx_id" CHAR(64),
    "expires_at" TIMESTAMP(3),
    "provider_payload" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collector_wallets" (
    "id" BIGSERIAL NOT NULL,
    "network" "Network" NOT NULL,
    "address" VARCHAR(34) NOT NULL,
    "address_hex" CHAR(42) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collector',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config_hash" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collector_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "deposit_id" BIGINT,
    "idempotency_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_status_code" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor" TEXT NOT NULL,
    "role" TEXT,
    "action" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signer_requests" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "derivation_index" INTEGER,
    "unsigned_hash" TEXT NOT NULL,
    "sweep_id" BIGINT,
    "result" TEXT,
    "error" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_name_key" ON "wallets"("name");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_addresses_address_key" ON "deposit_addresses"("address");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_addresses_address_hex_key" ON "deposit_addresses"("address_hex");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_addresses_alias_key" ON "deposit_addresses"("alias");

-- CreateIndex
CREATE INDEX "deposit_addresses_status_usdt_balance_cached_idx" ON "deposit_addresses"("status", "usdt_balance_cached");

-- CreateIndex
CREATE INDEX "deposit_addresses_oldest_unswept_at_idx" ON "deposit_addresses"("oldest_unswept_at");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_addresses_wallet_id_derivation_index_key" ON "deposit_addresses"("wallet_id", "derivation_index");

-- CreateIndex
CREATE UNIQUE INDEX "chain_cursors_network_kind_key" ON "chain_cursors"("network", "kind");

-- CreateIndex
CREATE INDEX "chain_events_to_hex_idx" ON "chain_events"("to_hex");

-- CreateIndex
CREATE INDEX "chain_events_block_number_idx" ON "chain_events"("block_number");

-- CreateIndex
CREATE UNIQUE INDEX "chain_events_network_tx_id_log_index_key" ON "chain_events"("network", "tx_id", "log_index");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_chain_event_id_key" ON "deposits"("chain_event_id");

-- CreateIndex
CREATE INDEX "deposits_deposit_address_id_status_idx" ON "deposits"("deposit_address_id", "status");

-- CreateIndex
CREATE INDEX "deposits_status_idx" ON "deposits"("status");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_tx_id_log_index_key" ON "deposits"("tx_id", "log_index");

-- CreateIndex
CREATE UNIQUE INDEX "sweeps_tx_id_key" ON "sweeps"("tx_id");

-- CreateIndex
CREATE INDEX "sweeps_status_idx" ON "sweeps"("status");

-- CreateIndex
CREATE INDEX "sweeps_deposit_address_id_status_idx" ON "sweeps"("deposit_address_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "resource_operations_idempotency_key_key" ON "resource_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "resource_operations_sweep_id_idx" ON "resource_operations"("sweep_id");

-- CreateIndex
CREATE INDEX "resource_operations_status_expires_at_idx" ON "resource_operations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "resource_operations_provider_external_order_id_key" ON "resource_operations"("provider", "external_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "collector_wallets_network_address_key" ON "collector_wallets"("network", "address");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_idempotency_key_key" ON "webhook_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "signer_requests_unsigned_hash_key" ON "signer_requests"("unsigned_hash");

-- AddForeignKey
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_deposit_address_id_fkey" FOREIGN KEY ("deposit_address_id") REFERENCES "deposit_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_chain_event_id_fkey" FOREIGN KEY ("chain_event_id") REFERENCES "chain_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_sweep_id_fkey" FOREIGN KEY ("sweep_id") REFERENCES "sweeps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sweeps" ADD CONSTRAINT "sweeps_deposit_address_id_fkey" FOREIGN KEY ("deposit_address_id") REFERENCES "deposit_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sweep_deposits" ADD CONSTRAINT "sweep_deposits_sweep_id_fkey" FOREIGN KEY ("sweep_id") REFERENCES "sweeps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sweep_deposits" ADD CONSTRAINT "sweep_deposits_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_operations" ADD CONSTRAINT "resource_operations_sweep_id_fkey" FOREIGN KEY ("sweep_id") REFERENCES "sweeps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One active sweep per address (spec §4.6 / §6).
CREATE UNIQUE INDEX "sweeps_one_active_per_address"
  ON "sweeps" ("deposit_address_id")
  WHERE "status" IN ('planned', 'activating', 'energy_pending', 'ready', 'signing', 'broadcast');

-- Exactly one active collector per network.
CREATE UNIQUE INDEX "collector_wallets_one_active_per_network"
  ON "collector_wallets" ("network")
  WHERE "is_active" = true;
