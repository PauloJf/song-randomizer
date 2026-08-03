# Deploy — Spotify Roulette

One-time setup per VPS. `PLAN.md` is still the source of truth for the app.

## 1. Spotify app config

At [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard):

1. Open your existing app (or create one). Copy the **Client ID** — no secret is needed, PKCE only.
2. Under **Redirect URIs**, add both:
   - `https://<your-domain>/api/auth/callback` — production
   - `http://127.0.0.1:3000/api/auth/callback` — local dev
3. Scopes needed (requested automatically at login): `playlist-read-private`, `user-read-playback-state`, `user-modify-playback-state`.
4. In **User Management**, allowlist the host account. Only one Spotify account authorizes — that account must be Premium for playback control.

## 2. Host `.env`

Copy `.env.example` to `.env` on the VPS and fill in:

```
SPOTIFY_CLIENT_ID=<from step 1>
PLAYLIST_ID=<the playlist to roulette>
PLAYERS=Alice,Bob,Carol,Dave
BASE_URL=https://<your-domain>
PORT=3000
COOKIE_SECRET=<any random string ≥ 32 chars>
```

## 3. Bring it up

```bash
docker compose up -d --build
```

State (Spotify tokens + heard history + spin log) lives in the named volume `roulette-state` under `/data/state.json`. It survives `docker compose restart`, `docker compose down`, and image rebuilds. It does **not** survive `docker compose down -v` — that removes the volume.

## 4. Apache reverse proxy

See [`deploy/apache-vhost.conf.example`](deploy/apache-vhost.conf.example). Copy, replace the domain, enable, reload.

## 5. First-time authorization

Visit `https://<your-domain>/` on any device. Tap **Connect Spotify**, complete the OAuth flow **once** with the host account. The tokens land in `/data/state.json` and refresh on their own from then on.

## 6. Speaker setup at party time

Spotify Connect targets whichever device is currently "active". On the host phone:

1. Open Spotify.
2. Play any track through the speaker once. That registers the speaker as the active device.
3. Pause. Now `/api/play` from Roulette will play on that speaker.

If no device is active, the Play button flips to **Open in Spotify**, which opens the app via `spotify:track:<id>`.

## 7. Debug helpers

- `GET /api/health` — liveness
- `GET /api/auth/status` — is the host account connected?
- `GET /api/devices` — list Connect devices Spotify sees
- `GET /api/playlist` — the cached playlist
- `POST /api/reset` — clear all history (body `{}` for everyone, `{"player":"Alice"}` for one)

## 8. Updating

```bash
git pull
docker compose up -d --build
```

Because state is in the volume, no re-auth is needed unless the Spotify refresh token itself has been revoked.
