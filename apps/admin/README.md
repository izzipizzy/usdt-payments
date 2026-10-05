# @usdt-trx/admin

Operator web UI for the USDT TRC-20 deposit gateway. Refine 4 + Ant Design 5 +
React 19 on Vite 6, talking to the Core service's `/admin/v1` REST API
(contract: `docs/admin-api.md`). Types come from `@usdt-trx/shared`.

## Run locally

```sh
pnpm install                       # from the repo root
pnpm --filter @usdt-trx/shared build   # once, the admin app imports its dist/
pnpm dev:admin                     # http://localhost:5173
```

The dev server proxies `/admin/*` and `/health` to Core using `CORE_URL`
or the configured Core port (see `vite.config.ts`), so start Core first.
On a fresh installation, the setup page creates an administrator using
`SETUP_TOKEN` and enrolls an authenticator. Log in with that account's password
and six-digit authenticator code. Follow the first-launch steps in the
[project guide](../../README.md). The session token is stored in
`localStorage["usdt-trx.admin.token"]` and sent as `Authorization: Bearer`.

## Navigation

Menu: **Wallet**, Addresses, Deposits, Sweeps, Payouts, then a collapsible **Advanced**
group with Dashboard (`/dashboard`), Energy pool, Resources, Settings and
Audit log. `/` and a successful login both land on `/wallet`. The header shows
only the network badge, the RU / EN switch and Logout.

## Wallet page

`/wallet` reads `GET /admin/v1/wallet`
(`{ initialized, network, xpub, addressesIssued, collectorAddress, collectorUsdt, collectorExternal, explorerBase, pool, main, payout }`,
where `main` is `{ address, explorerUrl, usdtBalance, trxBalance, activated, isCollector }`
— the **main wallet** derived from the seed that holds the whole USDT balance,
receives sweeps and sends payouts; `payout` is the same address kept for
compatibility; `pool` is `{ address, explorerUrl, trxBalance, energyAvailable, activated, minTrx, lowBalance }`;
all three are `null` until the wallet is initialised. `collectorAddress` is the
main wallet unless `collectorExternal` is `true`, i.e. an external cold
collector is configured in Core's `.env`; then it is that address and
`collectorUsdt` is its balance).

* Not initialised: two cards — **Create a new wallet** (`POST /wallet/create`
  `{ words: 12 | 24 }`; the returned phrase is shown once in a numbered 3-column
  grid with a Copy button and a warning; a "written it down" checkbox unlocks
  Continue, which reloads the status) and **Import a wallet** (textarea →
  `POST /wallet/import { mnemonic }`; `422` is shown under the field). A `409`
  from either endpoint just reloads the status.
* Initialised, top to bottom:
  1. **Main wallet** (`main`, falling back to `payout` on older Core) — the
     address large with copy + explorer link, the USDT balance big (this is
     the whole balance), the TRX balance small, the "not active yet" hint
     while `activated` is `false`, the explanation "Swept client USDT arrives
     here and payouts are sent from here. No TRX is needed on this address.",
     a **Make a payout** button (operator+) that opens `/payouts?new=1` — the
     Payouts list with the "New payout" dialog already open — and an **All
     payouts** button. When `collectorExternal` is `true` an info line
     "Sweeps go to the external cold address `collectorAddress`
     (`collectorUsdt` USDT)" is added, with copy + explorer link. The Refresh
     button lives in this card's header.
  2. **Client addresses** — network, addresses issued, xpub (short, copyable),
     a primary **Create address** button (the same alias / metadata modal as
     the Addresses page, `src/components/CreateAddressModal.tsx`) and an
     "All addresses" link. The freshly created address is shown below the
     card, large with copy, explorer link and the hint "Send USDT (TRC-20) to
     this address".
  3. **Pool (TRX for fees)** (`pool` present) — the fee-paying service wallet
     derived from the same seed (holds TRX only). Shows the pool address large
     with copy + explorer link, TRX balance and energy available (tabular
     figures), the explanation "The system pays address activations and
     energy from here. Top this address up with TRX — at least `minTrx` TRX
     recommended. Do not send USDT here.", a warning Alert "Pool TRX is low"
     when `lowBalance` is `true`, a hint that the address becomes active after
     the first TRX arrives when `activated` is `false`, and a **Staking &
     energy** link to `/pool` (Advanced).

## Payouts page

`/payouts` lists `GET /admin/v1/payouts` (filters `status`, `to`; sortable by
amount / status / created) with your reference (`externalId`, links to the
detail page), recipient, amount, status tag, tx, attempt, last error and
created. Payouts are two-hop (main → one-time hop address → recipient): a
**Step** column shows `1/2` / `2/2`, the tx column links «step 1» / «step 2»
(`hop1ExplorerUrl` / `explorerUrl`), and the detail page shows the hop address
(`viaAddress`), both transactions and the stage behind an info alert.
Operators get **Retry** (from `failed`) and **Cancel** (only on stage 1 and
before `broadcast` — the server answers `409` otherwise; with a confirmation) row actions and a **New payout** button:
recipient address (validated: `T…`, 34 chars), amount (decimal USDT), your
reference (prefilled `ui-<timestamp>`, editable — the API is idempotent by it)
and a note → `POST /admin/v1/payouts`. A `422` (limits, insufficient balance)
or `409` (payout wallet not set up) is shown under the form; success shows a
toast and refreshes the list (`created: false` means the reference already
existed and the existing payout was returned). `/payouts/:id` shows every
`PayoutDto` field plus the resource-operations table shared with the sweep
detail page (`src/pages/payouts/`).

`WalletGuard` (rendered inside the authenticated layout) calls the same GET
through `useWalletStatus()` and redirects every page to `/wallet` while
`initialized` is `false`; a failed request (older Core, network error) leaves
navigation alone.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE` | `` (empty) | Base URL of Core, without the `/admin/v1` suffix. Empty = same origin, which is what the Vite proxy and the nginx image expect. Set e.g. `https://core.example.com` for a cross-origin deployment (Core must then allow CORS). Baked in at build time. |

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Vite dev server on :5173 with API proxy |
| `pnpm build` | `tsc --noEmit && vite build` → `dist/` |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` |
| `pnpm test` | vitest (formatting helpers, i18n catalog parity) |

## Languages

The UI ships in Russian and English (`src/i18n/ru.json`, `src/i18n/en.json`,
wired into Refine's `i18nProvider` via `i18next` + `react-i18next`). Both files
carry the full Refine built-in key set (`buttons.*`, `pages.*`,
`notifications.*`, …) plus every app string; `pnpm test` fails if the two
catalogs' key sets or `{{placeholders}}` drift apart. Missing keys fall back to
English.

The RU / EN switch lives in the header (and on the login card). The Addresses
list shows alias, address, USDT balance, status and last deposit by default;
on-chain status, derivation index, balance-checked and created dates sit behind
the row expander. The choice is
stored in `localStorage["usdt-trx.admin.lang"]`; with nothing stored, a browser
language starting with `ru` selects Russian, anything else English. Switching
also re-localises antd (`ruRU` / `enUS` — pickers, pagination, empty states) and
dayjs (dates render with the locale's `L LTS` format and relative-time words).
Status codes (`energy_pending`, `superseded`, `credited`, …), energy sources,
resource-operation kinds and role names are mapped to human labels through
`src/i18n/labels.ts`; the raw code stays in the tag's `title` tooltip.

Not translated on purpose: ticker symbols (`USDT`, `TRX`, `SUN`), network names
from the API, CSV export headers (DTO field names, machine-readable) and the
`reason` text sent with a sweep cancel (it is stored in Core's audit log).

## Docker

Multi-stage image: node build → `nginx:alpine` serving `dist/` and proxying
`/admin/` and `/health` to `http://core:3000` (`nginx.conf`). Build from the
repo root so the workspace is in context:

```sh
docker build -f apps/admin/Dockerfile -t usdt-trx-admin .
docker run --rm -p 8080:80 --network <compose-network> usdt-trx-admin
```

Pass `--build-arg VITE_API_BASE=https://…` only when the API is not behind the
same origin.

## Roles

| Role | UI |
|---|---|
Login is a single password, so the role comes from Core's `/me`; the gating
below is kept but the role badge is no longer shown.

| `viewer` | read-only: all pages, no action buttons |
| `operator` | + sweep / suspend / resume / refresh / retry / cancel / rebuild, "Recalculate balances", "Sweep all above threshold", pool "Stake" / "Unstake", "New payout" / payout retry / cancel |
| `admin` | + save on Settings |

Settings opens with an **Energy rental — itrx.io** section (API key, write-only API secret, rent period `1H`/`1D`, a "Use itrx.io first" checkbox that moves `itrx` to the front of `providerOrder` or removes it, and an operator-level **Test connection** button → `POST /admin/v1/providers/itrx/test`, shown inline as price per energy / cost per transfer / balance). A **Payouts**
section carries `payoutMaxUsdt` ("Max payout (USDT)") and `payoutDailyMaxUsdt`
("Daily payout limit (USDT)"), decimal strings where `0` means unlimited.

A `401` from any request logs the session out.

## Energy pool page

`/pool` ("Energy pool" / «Пул Energy») reads `GET /admin/v1/pool` every 30 s
and shows the pool wallet (explorer link), TRX balance (+ SUN), an energy
used/limit progress bar, available energy and bandwidth, TRX staked for energy
and bandwidth, TRX delegated out, energy per staked TRX per day and the
estimated sweeps per day, plus the helper line "≈ N energy per staked TRX per
day; one USDT transfer needs ~65 000".

"Stake" and "Unstake" (operator+) open a form — amount in TRX, resource
`ENERGY` / `BANDWIDTH` — then a confirmation modal, and POST
`/admin/v1/pool/stake` or `/admin/v1/pool/unstake` with
`{ amountTrx, resource }`. A success toast links the returned `txId` to its
`explorerUrl`; a 409 `{ message }` (not configured, insufficient balance,
signer refused) is shown as an error toast. When the endpoint answers
`{ configured: false, reason }` the page shows a warning with the reason and
the buttons are disabled with a hint. The dashboard carries a small "Energy
pool" card (energy available, TRX balance, link to `/pool`) that is hidden
while the pool is not configured.

## Layout

```
src/
  api/          fetch wrapper (auth header, HttpError), DTO helper types, useAction()
  providers/    Refine data/auth/access-control providers, useMe()
  providers/    …plus useWalletStatus() (shared GET /wallet query)
  components/   ExplorerLink, StatusTag, Money, DateCell, Ellipsis, Header, LangSwitch, Title, FilterBar,
                CreateAddressModal, WalletGuard
  i18n/         i18next setup, ru.json / en.json catalogs, lang helpers, enum → label helpers
  pages/        wallet, dashboard, addresses (list/show), deposits, sweeps (list/show), payouts (list/show + CreatePayoutModal),
                resources, pool, settings, audit, login
  utils/        decimal/SUN formatting (no floats), csv export, status colours
```

`@usdt-trx/shared`'s barrel re-exports a Node-only dotenv helper
(`loadDotenv` → `node:fs`, `node:path`). The admin never calls it, but the
browser bundle must still resolve those imports, so `vite.config.ts` aliases
alias once shared stops exporting Node code from its browser entry.
