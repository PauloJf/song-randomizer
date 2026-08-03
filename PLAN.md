# Spotify Roulette — Implementation Plan

A self-hosted PWA that picks a random song from a Spotify playlist with a decelerating roulette wheel of album covers and a synced tick sound. Built for a 4-person bet: each person spins in arbitrary turn order, and the app guarantees no person hears the same song twice. Runs in Docker on the existing VPS behind Apache (HTTPS), installable as a PWA on iOS.

This document is written to be executed phase-by-phase in Claude Code. Keep it in the repo root as `PLAN.md`. Work one phase per session, commit at the end of each phase, and check off acceptance criteria before moving on.

---

## Decisions already made (do not re-litigate)

- **Stack**: Fastify + TypeScript backend, React + Vite frontend, single Docker image (backend serves the built frontend as static files). Docker Compose for the volume + env wiring.
- **Auth**: Spotify Authorization Code with PKCE, handled **server-side**. Tokens never reach the browser. One Spotify account (the host's, must be Premium for playback control) is authorized once; everyone else just uses the web UI.
- **State**: a single JSON file in a Docker volume (`/data/state.json`). No database. Four players and one playlist do not justify more.
- **Playback**: Spotify Connect (`PUT /v1/me/player/play`) as primary — starts the track on whatever device is active (phone connected to speaker). Deep link `spotify:track:{id}` as fallback button when no active device is found (API returns 404). No in-browser audio playback of the track itself — Web Playback SDK is unsupported on iOS Safari and preview URLs are deprecated.
- **Tick sound**: Web Audio API, generated or a short sample, scheduled against the same animation timeline as the wheel so deceleration is naturally synced. AudioContext unlocked on the spin tap (iOS requirement).
- **Selection is server-side**: the backend picks the track (filtered by the spinning player's history) *before* the animation starts, and the frontend animates the wheel to land on it. This makes the no-repeat guarantee trustworthy and the animation deterministic.

## Non-goals

- No multi-account Spotify auth, no user login system — players are just names in a config.
- No public release hardening (rate limiting, CSRF beyond basics, i18n). Personal tool.
- No offline mode. The service worker exists only to satisfy PWA installability; the app requires network.
- No BPM-Tagger integration. Separate repo.

---

## Prerequisites (manual, before Phase 1)

1. Create an app at developer.spotify.com/dashboard. Note **Client ID** (no secret needed for PKCE).
2. Add redirect URI: `https://<your-domain>/api/auth/callback` (and `http://127.0.0.1:3000/api/auth/callback` for local dev).
3. Scopes needed: `playlist-read-private`, `user-read-playback-state`, `user-modify-playback-state`.
4. In dev mode, allowlist the host Spotify account (User Management). Only the host account authenticates, so one entry suffices.
5. Pick the playlist and copy its ID. Confirm the host account is Premium.
6. Decide the four player names.

---

## Repo structure (target)

```
spotify-roulette/
├── PLAN.md
├── CLAUDE.md                  # short: stack, commands, conventions
├── docker-compose.yml
├── Dockerfile                 # multi-stage: build frontend, run backend
├── .env.example               # SPOTIFY_CLIENT_ID, PLAYLIST_ID, PLAYERS, BASE_URL, PORT
├── server/
│   ├── src/
│   │   ├── index.ts           # Fastify bootstrap, static serving
│   │   ├── spotify.ts         # API client, token refresh
│   │   ├── auth.ts            # PKCE flow routes
│   │   ├── state.ts           # JSON file read/write, atomic
│   │   └── routes/
│   │       ├── playlist.ts
│   │       ├── spin.ts
│   │       └── playback.ts
│   ├── package.json
│   └── tsconfig.json
└── web/
    ├── src/
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── PlayerPicker.tsx
    │   │   ├── Wheel.tsx      # slot-machine strip of album covers
    │   │   └── ResultCard.tsx
    │   ├── audio/ticker.ts    # Web Audio tick scheduler
    │   └── pwa/               # manifest, icons, sw registration
    ├── index.html
    ├── vite.config.ts
    └── package.json
```

## Data model (`/data/state.json`)

```json
{
  "tokens": { "access_token": "...", "refresh_token": "...", "expires_at": 0 },
  "playlistSnapshotId": "abc",
  "players": {
    "Player1": { "heard": ["trackId1", "trackId2"] },
    "Player2": { "heard": [] },
    "Player3": { "heard": [] },
    "Player4": { "heard": [] }
  },
  "spins": [
    { "player": "Player1", "trackId": "trackId2", "at": "2026-08-02T21:14:00Z" }
  ]
}
```

Writes must be atomic (write to temp file, rename). `spins` is an append-only log so a mistaken spin can be undone by removing the last entry.

## API surface

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/auth/login` | Redirect to Spotify authorize (PKCE) |
| GET | `/api/auth/callback` | Exchange code, persist tokens |
| GET | `/api/auth/status` | Is the host account connected? |
| GET | `/api/playlist` | Cached playlist tracks: id, name, artist, album art URL, duration |
| GET | `/api/players` | Player names + remaining-track counts |
| POST | `/api/spin` | Body `{ player }` → picks eligible track, records it, returns `{ track, wheelOrder }` |
| POST | `/api/spin/undo` | Removes last spin (mis-taps happen at parties) |
| POST | `/api/play` | Body `{ trackId }` → Connect play; 409 with `{ reason: "no_active_device" }` on Spotify 404 |
| GET | `/api/devices` | List available Connect devices (debug/setup aid) |
| POST | `/api/reset` | Body `{ player }` or `{}` → clear history per player or all |

---

## Phases

### Phase 1 — Scaffold & Docker skeleton

Fastify TS server with `/api/health`, Vite React app with a placeholder screen, multi-stage Dockerfile, compose file with the `/data` volume and env vars, `@fastify/static` serving the built frontend, dev scripts (`npm run dev` in both, Vite proxying `/api`).

**Done when:**
- [ ] `docker compose up` serves the React placeholder on the configured port
- [ ] `/api/health` returns ok from inside the container
- [ ] Local dev works without Docker (two dev servers, proxy)

### Phase 2 — Spotify auth (PKCE) & token lifecycle

Implement `auth.ts`: generate verifier/challenge, store verifier in a short-lived signed cookie, exchange code at callback, persist tokens to state file. `spotify.ts` wraps fetch with automatic refresh when `expires_at` is near. `/api/auth/status` for the frontend to show a "Connect Spotify" screen only when needed.

**Done when:**
- [ ] Visiting `/api/auth/login` completes the flow and status returns connected
- [ ] Access token auto-refreshes (test by forcing `expires_at` into the past)
- [ ] Tokens survive container restart (volume)

### Phase 3 — Playlist, players, spin logic

`/api/playlist` fetches all tracks (paginate, 50/page), caches in memory keyed by `snapshot_id`, stores the snapshot id in state. `/api/spin` filters the playlist by the player's `heard` list, picks uniformly at random, appends to `heard` and `spins`, returns the chosen track plus a `wheelOrder` array (the subset of track IDs the wheel will display, with the winner's index) so the frontend can animate to a known landing position. Handle the exhausted case: return 409 `{ reason: "exhausted" }`; frontend offers reset-for-that-player.

**Done when:**
- [ ] Repeated spins for one player never repeat a track until exhaustion
- [ ] Exhaustion returns 409 and `/api/reset` recovers
- [ ] Playlist edits (snapshot change) refresh the cache; removed tracks are pruned from `heard` lists
- [ ] Undo removes the last spin from both `spins` and `heard`
- [ ] Vitest tests cover the spin filter and exhaustion logic

### Phase 4 — Roulette wheel UI + tick audio

Player picker (four big buttons, remaining counts). Wheel: a vertical slot-machine strip of album covers is simpler and reads better on a phone than a circular wheel — CSS `translateY` driven by `requestAnimationFrame` with a cubic ease-out over ~4–6 s, landing exactly on the winner index from `/api/spin`. Ticks: schedule Web Audio blips whenever a cover boundary crosses the center line — deceleration sync is then automatic. Unlock AudioContext in the spin tap handler. End with a result card: large album art, title, artist, and the action buttons for Phase 5.

**Done when:**
- [ ] Spin lands visually on the exact track returned by the API
- [ ] Ticks slow down with the strip and are audible on iOS Safari after first tap
- [ ] Works one-handed on a phone viewport; covers lazy-load
- [ ] Rapid double-tap cannot fire two spins (button locks during animation)

### Phase 5 — Playback

`/api/play` calls Connect; map Spotify's 404 to a 409 the frontend understands. Result card: primary button **Play** (Connect), on `no_active_device` swap to **Open in Spotify** (`spotify:track:{id}` link, fallback `https://open.spotify.com/track/{id}`). Show a one-line hint: "Open Spotify and play anything once to register the speaker."

**Done when:**
- [ ] With Spotify open on a device, Play starts the exact track there
- [ ] With no active device, the deep-link fallback appears and opens the Spotify app on iOS
- [ ] Premium-required and rate-limit errors surface as readable messages

### Phase 6 — PWA & deploy

Manifest (name, icons incl. 180×180 apple-touch-icon, `display: standalone`, theme color), minimal service worker (cache app shell only, network-first for `/api`), meta tags for iOS. Deploy: compose on the VPS, Apache vhost reverse-proxying to the container port with the existing HTTPS cert. Update the Spotify app redirect URI to the production URL and re-auth once.

**Done when:**
- [ ] "Add to Home Screen" on iOS installs it with icon, no browser chrome
- [ ] App works over HTTPS on the domain end-to-end (auth, spin, play)
- [ ] Container restarts cleanly with state intact (`docker compose restart`)

### Phase 7 — Party polish (optional)

Haptics via `navigator.vibrate` where supported, subtle confetti on landing, a history screen (who got what, from `spins`), a session timer showing the track duration counting down after play starts (the ~5-minute action window).

---

## Open questions (answer before or during Phase 3)

1. When a player exhausts the playlist: auto-reset silently, or require an explicit reset tap? (Plan assumes explicit.)
2. When the playlist changes, reset everyone's history or only prune removed tracks? (Plan assumes prune only.)
3. Is the winner shown on one shared screen, or does each person spin on their own phone? State is server-side either way, but a shared screen might justify a bigger result layout.

## Working with Claude Code

- Create `CLAUDE.md` in Phase 1 with: stack summary, `npm` commands for both packages, "state file is `/data/state.json`, writes must be atomic", and "never commit `.env`".
- One phase per session; start each session with "Read PLAN.md, we are on Phase N".
- Commit per phase with the phase name in the message; tag `v0.1` after Phase 6.
