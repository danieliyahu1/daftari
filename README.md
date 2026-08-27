# Daftari

A **chama** (rotating savings group) app on the Kaspa testnet-10 network.

**Live:** https://daftari.danieliyahu.com

In Daftari, a chama is a real Kaspa wallet. Members pool money into it by paying on-chain, the group's history is its on-chain ledger (the "book"), and members bring people in and send money out — all verified by real transactions on the network.

## How it works

- **Every chama is its own Kaspa wallet** (a `group` wallet). Members are `user` wallets who pay into it on-chain.
- **Money lives on the chain** — contributions and withdrawals are real Kaspa transactions built server-side, signed in the browser via the **Kastle** wallet extension, and broadcast to testnet-10.
- **Social state lives in a hosted Turso (libSQL) database** — names, memberships, and sign-in challenges.
- **Membership is self-enforcing**: a wallet can only join a chama after it has actually transacted with the chama's wallet.

## Authentication

Daftari authenticates users with **Kaspa message signatures** (no passwords, no third-party identity providers):

1. The client requests a challenge and receives a signed message containing a one-time **nonce**.
2. The user signs the message with their private key in **Kastle** (`signMessage`). This is off-chain and free — nothing is broadcast.
3. The backend verifies the BIP340 Schnorr signature against the address's public key, checks the nonce (one-time + 5-minute TTL stored in SQLite), and issues a **15-minute JWT**.
4. Protected endpoints require the bearer token; identity is derived from the token, never from a client-supplied `?user=` param.

This proves the client truly owns the claimed wallet, prevents replay (one-time nonce), and stops impersonation — the backend never trusts a self-claimed address.

## Tech stack

- **Backend**: Node.js + TypeScript, Express 5, Turso (libSQL via `@libsql/client`)
- **Frontend**: React 18 + Vite, React Router
- **Crypto**: `@noble/hashes`, `@noble/curves` (BLAKE2b + BIP340 Schnorr), `jose` (JWT)
- **Wallet**: [Kastle](https://kastle.cc) browser extension
- **Chain**: Kaspa testnet-10 (`api-tn10.kaspa.org`)

## Getting started

### Prerequisites

- Node.js (any modern LTS)
- The **Kastle** browser extension, on testnet-10

### Install

```bash
npm install
```

### Run the dev servers

Starts both the API (port `3001`) and the Vite frontend with a proxy to `/api`:

```bash
npm run dev
```

Open the frontend, connect your Kastle wallet, and confirm the sign-in message.

### Configuration (environment variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | API port |
| `DAFTARI_TURSO_URL` | _(required)_ | Turso database client URL, e.g. `libsql://daftari-<org>.turso.io` |
| `DAFTARI_TURSO_AUTH_TOKEN` | _(required)_ | Per-database Turso auth token (`turso db tokens create daftari`) |
| `DAFTARI_AUTH_SECRET` | dev-only fallback | HMAC secret for signing JWTs. **Set this in production.** |
| `DAFTARI_ORIGIN` | `http://localhost:5173` | The origin embedded in sign-in messages (must match where the frontend is served) |

> **Note:** `DAFTARI_AUTH_SECRET` defaults to an insecure development value and logs a warning. Always set it in production. A `.env` file is loaded via `dotenv` in development; copy `.env.example` and fill in the values.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run API + frontend dev servers |
| `npm run dev:server` | Run only the API (`tsx watch`) |
| `npm run dev:web` | Run only the frontend (Vite) |
| `npm test` | Backend + shared unit tests (Vitest) |
| `npm run test:web` | Frontend tests (Vitest) |
| `npm run typecheck` | Backend typecheck |
| `npm run build` | Build the frontend for production |
| `npm run serve` | Serve the API (production mode, serves `frontend/dist`) |

## Project layout

```
backend/    Express API, stores, transaction building, Kaspa client, auth
frontend/   React app (Vite)
shared/     Types and network config shared by backend and frontend
```
