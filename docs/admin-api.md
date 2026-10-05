# Admin API contract

This is the API used by the admin UI of a personal, self-hosted USDT (TRC-20) wallet service for one operator. The operator creates deposit addresses per counterparty/invoice and manages incoming transfers, sweeps, payouts and energy through the UI.

Base path: `/admin/v1`. Auth: `Authorization: Bearer <session token>`.

**First-run setup.** Before bootstrap, while no TOTP-enabled environment login, account row or `admin.bootstrappedAt` marker exists, `GET /admin/v1/setup/status` → `{ needed: true }` and the UI shows the setup page. `POST /admin/v1/setup/start` `{ setupToken, username, password }` → `{ attemptId, totpSecret, otpauthUri, qrDataUrl }`; `POST /admin/v1/setup/complete` `{ setupToken, attemptId, code }` creates the `admin` account (exactly one bootstrap can win; a persistent `admin.bootstrappedAt` marker in `settings` keeps setup closed even if every account is later disabled) and returns a session like login does. `setupToken` is `SETUP_TOKEN` from `.env` (the operator sets it before the first start; without it the setup page explains what to add). Both endpoints are IP-fenced and rate-limited; a pending setup expires after 15 minutes.

**Login (2FA is mandatory).** `POST /admin/v1/auth/login` `{ password, code }` → `{ token, role, expiresAt }`. `password` is the setup-page account password (optionally with `username`), `ADMIN_PASSWORD`, or a login entry from `ADMIN_TOKENS`, `code` is the 6-digit TOTP from the authenticator enrolled during setup or configured for the environment login. For `ADMIN_PASSWORD`, configure `ADMIN_TOTP_SECRET` (generate it with `pnpm --filter @usdt-trx/core totp:setup`). Sessions live in Redis for `ADMIN_SESSION_TTL_MS` (12 h default); `POST /admin/v1/auth/logout` revokes one. Login is rate-limited per IP (20 failures/min → 429) and, like the whole admin API, fenced by `ADMIN_ALLOWED_IPS` when set (403 otherwise).

**Step-up (optional, `ADMIN_TOTP_STEP_UP=true`).** Money-moving and security-relevant calls — `POST wallet/create|import`, `addresses/:id/sweep|resume`, `sweeps/sweep-all`, `sweeps/:id/retry|rebuild`, `payouts`, `payouts/:id/retry`, `pool/stake|unstake`, `PATCH settings` — must carry a fresh code in `X-TOTP-Code`; missing → `428 step_up_required`, wrong or reused → 403. `GET /me` reports `totpStepUp` so the UI knows to ask.

**Proxy trust.** Keep `TRUST_PROXY=false` for direct connections; behind a trusted proxy, configure its hop count or IPs/CIDRs. This determines which forwarded IP is used for the allowlist, rate limits and audit records.

**Machine tokens.** `ADMIN_TOKENS` entries without a TOTP secret (`token:role`) are accepted directly as `Bearer` for scripts. They cannot perform step-up actions when step-up is on. Leave them out to force 2FA for everyone. Roles are cumulative: `admin ⊃ operator ⊃ viewer`.

- `viewer`: all `GET`.
- `operator`: `viewer` + address, sweep, payout and pool actions, provider test and balances recalculation.
- `admin`: `operator` + wallet creation/import and settings changes.

All DTOs are the zod schemas in `@usdt-trx/shared` (`AddressDto`, `DepositDto`, `SweepDto`, `ResourceOpDto`, `AuditDto`, `ProviderDto`, `QueueStatsDto`, `DashboardDto`, `AdminSettings`). Money is returned twice: `amount` (decimal string, e.g. `"12.5"`) and `amountRaw` (integer string in 10⁻⁶ units). Ids are strings. Dates are ISO‑8601.

Deposit statuses: `confirmed → sweeping → swept`; deposits below the minimum amount are `rejected` (dust). Incoming USDT is detected by the block watcher and swept to the main wallet. Energy comes from the operator's own staked TRX pool, with optional itrx.io rental.

Payout processing: `planned → energy_pending → ready → signing → broadcast → confirmed/failed`. Stage 1 sends from the main wallet to a one-time hop address; its confirmation resets processing to `planned` at stage 2, which sends from the hop to the recipient. Final `confirmed` means stage 2 is confirmed. Cancellation before stage 1 broadcast uses `cancelled`. The signer holds the seed and signs only policy-checked transactions.

Pagination: query `page` (1‑based, default 1), `pageSize` (default 25, max 200); response `{ items, total, page, pageSize }`. Sorting: `sort=field:asc|desc` (optional; default `createdAt:desc`).

Errors: `{ statusCode, message, error }` (NestJS default). `401` bad token, `403` role too low, `404` not found, `409` state conflict (e.g. sweep already active), `422` validation.

| Method | Path | Role | Body / query | Response |
|---|---|---|---|---|
| GET | `/me` | viewer | | `{ role, network, collectorAddress, explorerBase, totpStepUp, authKind }` |
| GET | `/wallet` | viewer | | `{ initialized, network, xpub, addressesIssued, collectorAddress, collectorUsdt, collectorExternal, explorerBase, main: { address, explorerUrl, usdtBalance, trxBalance, activated, isCollector }\|null, pool: {...}\|null, payout: { address, explorerUrl, usdtBalance, trxBalance, activated }\|null }` |
| POST | `/wallet/create` | admin | `{ words: 12\|24 }` | `{ mnemonic, xpub, firstAddress }` — the phrase is returned once; 409 if a wallet exists |
| POST | `/wallet/import` | admin | `{ mnemonic }` | `{ xpub, firstAddress }` — 409 if a wallet exists, 422 if the phrase is invalid |
| GET | `/dashboard` | viewer | | `DashboardDto` |
| GET | `/addresses` | viewer | `page,pageSize,sort,search (alias/address substring),status,withBalance=true,unsweptOlderThanHours` | `Paginated<AddressDto>` |
| POST | `/addresses` | operator | `{ alias, metadata? }` | `AddressDto & { created }` (200; idempotent by alias) |
| GET | `/addresses/:id` | viewer | | `AddressDto & { deposits: DepositDto[], sweeps: SweepDto[] }` |
| POST | `/addresses/:id/sweep` | operator | | `{ sweepId }` — force sweep ignoring thresholds; 409 if a sweep is active or balance is 0 |
| POST | `/addresses/:id/suspend` | operator | `{ reason? }` | `AddressDto` |
| POST | `/addresses/:id/resume` | operator | | `AddressDto` |
| POST | `/addresses/:id/refresh-balance` | operator | | `AddressDto` (balance re-read from chain synchronously) |
| GET | `/deposits` | viewer | `page,pageSize,sort,status,alias,txId,addressId` | `Paginated<DepositDto>` |
| GET | `/sweeps` | viewer | `page,pageSize,sort,status,alias,addressId` | `Paginated<SweepDto>` |
| GET | `/sweeps/:id` | viewer | | `SweepDto & { resourceOperations: ResourceOpDto[], deposits: DepositDto[] }` |
| POST | `/sweeps/:id/retry` | operator | | `SweepDto` — only from `failed` |
| POST | `/sweeps/:id/cancel` | operator | `{ reason? }` | `SweepDto` — `abandoned` + reclaim of rented energy; not allowed after `broadcast` |
| POST | `/sweeps/:id/rebuild` | operator | | `SweepDto` — new sweep, old marked `superseded`; only from `failed`/`broadcast` w/o confirmation |
| POST | `/sweeps/sweep-all` | operator | | `{ planned: number }` — evaluate every address with balance ≥ threshold |
| POST | `/balances/recalculate` | operator | | `{ queued: number }` — re-read balanceOf for all assigned addresses (async) |
| GET | `/payouts` | viewer | `page,pageSize,sort,status,to` | `Paginated<PayoutDto>` |
| POST | `/payouts` | operator | `{ externalId, to, amount, note? }` | `PayoutDto & { created }` — idempotent by `externalId`; 422 over per-payout/daily limits or insufficient balance. Payouts are two-hop: `stage` 1 = main → one-time `viaAddress` (`hop1TxId`), stage 2 = `viaAddress` → `to` (`txId`) |
| GET | `/payouts/:id` | viewer | | `PayoutDto & { resourceOperations }` |
| POST | `/payouts/:id/retry` | operator | | `PayoutDto` — only from `failed` |
| POST | `/payouts/:id/cancel` | operator | `{ reason? }` | `PayoutDto` — only while stage 1 has not been broadcast (after that the funds are already on the hop address) |
| GET | `/resources` | viewer | `page,pageSize,sort,kind,status,provider,sweepId` | `Paginated<ResourceOpDto>` |
| GET | `/providers` | viewer | | `ProviderDto[]` |
| POST | `/providers/itrx/test` | operator | | `ProviderTestResult` — price quote for 65k energy with the stored itrx credentials |
| GET | `/pool` | viewer | | pool wallet status: `{ configured, address, explorerUrl, activated, trxBalance, trxBalanceSun, energyLimit, energyUsed, energyAvailable, bandwidthAvailable, stakedForEnergyTrx, stakedForBandwidthTrx, delegatedOutEnergyTrx, energyPerTrxPerDay, estimatedSweepsPerDay }` or `{ configured: false, reason }` |
| POST | `/pool/stake` | operator | `{ amountTrx, resource: ENERGY\|BANDWIDTH }` | `{ txId, explorerUrl }` — Stake 2.0 FreezeBalanceV2 from the pool wallet |
| POST | `/pool/unstake` | operator | `{ amountTrx, resource }` | `{ txId, explorerUrl }` — UnfreezeBalanceV2; TRX returns after the unstaking period |
| GET | `/queues` | viewer | | `QueueStatsDto[]` |
| GET | `/settings` | viewer | | `AdminSettings` (itrx secret blanked; `itrxApiSecretSet` says whether one is stored) |
| PATCH | `/settings` | admin | `AdminSettingsPatch` (empty `itrxApiSecret` keeps the stored one) | `AdminSettings` |
| GET | `/audit` | viewer | `page,pageSize` | `Paginated<AuditDto>` |

Explorer links: `explorerUrl` fields are absolute URLs (`https://tronscan.org/#/transaction/<tx>` or `.../address/<addr>`, Nile: `https://nile.tronscan.org/#/...`).

## Backup & recovery

- `GET /admin/v1/backup/labels` — labels backup as JSON (`{ version, network, xpub, addresses: [{ index, address, alias, metadata, suspended }], payouts: [{ externalId, to, amount, note, createdAt }] }`); `GET /admin/v1/backup/labels.csv` — the same as CSV. Core also rewrites this file to `LABELS_FILE` on every change.
- `POST /admin/v1/backup/labels` (admin) — apply a labels file to the current rows (matched by address); returns `{ applied, skipped[] }`.
- `POST /admin/v1/recovery/scan` (admin, step-up) — rebuild from the seed phrase + chain: derive addresses with a gap limit of 20, pull each one's USDT history from TronGrid, recreate addresses (named from the labels file or `recovered-<index>`), deposits and confirmed sweeps, and return USDT stuck on one-time hop addresses to the main wallet. Queued on the maintenance worker; `GET /admin/v1/recovery/status` reports progress. Runs automatically after a wallet import.
