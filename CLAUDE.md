# Spotify Roulette — Working notes for Claude Code

Read `PLAN.md` for the full spec. This file is the quick-reference cheatsheet.

## Stack

- Backend: Fastify + TypeScript (`server/`)
- Frontend: React + Vite + TypeScript (`web/`)
- Deployment: single Docker image, backend serves the built frontend as static files
- State: SQLite at `/data/roulette.db` inside the container (Docker volume), via Node's built-in `node:sqlite` — no native deps, no DB server.

## Commands

Server (`cd server`):
- `npm run dev` — Fastify with tsx watch on `:3000`
- `npm run build` — compile TS to `dist/`
- `npm start` — run compiled server

Web (`cd web`):
- `npm run dev` — Vite dev server on `:5173`, proxies `/api` to `:3000`
- `npm run build` — build to `web/dist/`
- `npm run preview` — preview the production build

Root:
- `docker compose up --build` — builds the full image and runs it (backend serves web on the port from `.env`)

## Conventions

- State is SQLite at `/data/roulette.db` via Node's built-in `node:sqlite` (needs Node ≥ 22.5; Docker image uses node:24). Tables: `meta` (tokens, snapshot id), `players`, `heard`, `spins`.
- A legacy `/data/state.json` is imported once on first boot and renamed to `state.json.imported`.
- `spins` is an append-only log and is **preserved** across resets and player removal (it's the admin history). Undo flags the last spin `undone=1` and deletes the matching `heard` row. Reset only clears `heard`.
- `PLAYERS` env only seeds the players table when it's empty; after that, players are managed in the DB.
- Never commit `.env`. `.env.example` is the template; real secrets live only on the host.
- Selection is server-side. `/api/spin` returns both the chosen track and a `wheelOrder` array so the frontend animation is deterministic.
- No in-browser playback of the actual track (Web Playback SDK unsupported on iOS, preview URLs deprecated). Playback goes through Spotify Connect.

## Environment variables

See `.env.example`. Required: `SPOTIFY_CLIENT_ID`, `PLAYLIST_ID`, `PLAYERS` (comma-separated), `BASE_URL`, `PORT`.

## Working style

One phase per session. Start each session with "Read PLAN.md, we are on Phase N". Commit at the end of each phase with the phase name in the message.
