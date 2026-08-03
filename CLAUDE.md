# Spotify Roulette — Working notes for Claude Code

Read `PLAN.md` for the full spec. This file is the quick-reference cheatsheet.

## Stack

- Backend: Fastify + TypeScript (`server/`)
- Frontend: React + Vite + TypeScript (`web/`)
- Deployment: single Docker image, backend serves the built frontend as static files
- State: `/data/state.json` inside the container (Docker volume). No database.

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

- State file is `/data/state.json`. Writes must be **atomic** (write to `state.json.tmp`, `fs.rename`).
- `spins` is an append-only log. Undo removes the last entry from `spins` and pops the matching track from that player's `heard`.
- Never commit `.env`. `.env.example` is the template; real secrets live only on the host.
- Selection is server-side. `/api/spin` returns both the chosen track and a `wheelOrder` array so the frontend animation is deterministic.
- No in-browser playback of the actual track (Web Playback SDK unsupported on iOS, preview URLs deprecated). Playback goes through Spotify Connect.

## Environment variables

See `.env.example`. Required: `SPOTIFY_CLIENT_ID`, `PLAYLIST_ID`, `PLAYERS` (comma-separated), `BASE_URL`, `PORT`.

## Working style

One phase per session. Start each session with "Read PLAN.md, we are on Phase N". Commit at the end of each phase with the phase name in the message.
