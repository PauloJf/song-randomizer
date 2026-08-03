# Spotify Roulette

A self-hosted PWA that picks a random song from a Spotify playlist with a decelerating roulette wheel of album covers and a synced tick sound. Built for a small party of players who take turns spinning — the app guarantees no player hears the same song twice.

- **Stack**: Fastify + TypeScript backend, React + Vite frontend, single Docker image.
- **State**: one JSON file in a Docker volume (`/data/state.json`). No database.
- **Auth**: Spotify PKCE, server-side only. Tokens never reach the browser.
- **Playback**: Spotify Connect (host account must be Premium), deep-link fallback if no device is active.

Source: [github.com/PauloJf/song-randomizer](https://github.com/PauloJf/song-randomizer).

## Run

### `docker compose` (recommended)

```yaml
services:
  app:
    image: <your-dockerhub-user>/song-randomizer:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      SPOTIFY_CLIENT_ID: ${SPOTIFY_CLIENT_ID}
      PLAYLIST_ID: ${PLAYLIST_ID}
      PLAYERS: Alice,Bob,Carol,Dave
      BASE_URL: https://your-domain.example
      PORT: 3000
      COOKIE_SECRET: ${COOKIE_SECRET}
    volumes:
      - roulette-state:/data

volumes:
  roulette-state:
```

### `docker run`

```bash
docker run -d --name spotify-roulette \
  -p 3000:3000 \
  -v roulette-state:/data \
  -e SPOTIFY_CLIENT_ID=your_client_id \
  -e PLAYLIST_ID=your_playlist_id \
  -e PLAYERS=Alice,Bob,Carol,Dave \
  -e BASE_URL=https://your-domain.example \
  -e COOKIE_SECRET=$(openssl rand -hex 32) \
  <your-dockerhub-user>/song-randomizer:latest
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | yes | Spotify app client id (PKCE, no secret) |
| `PLAYLIST_ID` | yes | Spotify playlist to roulette from |
| `PLAYERS` | yes | Comma-separated player names |
| `BASE_URL` | yes | Public origin, e.g. `https://roulette.example.com` |
| `PORT` | no | Defaults to `3000` |
| `COOKIE_SECRET` | yes | Random 32+ char string, signs the PKCE cookie |

## First run

1. Register a Spotify app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard). Copy the client id.
2. Add the redirect URI: `${BASE_URL}/api/auth/callback`. In dev mode, allowlist the host account under **User Management**.
3. Requested scopes: `playlist-read-private`, `user-read-playback-state`, `user-modify-playback-state`. The host account must be Premium for playback control.
4. Start the container, visit `${BASE_URL}` in a browser, tap **Connect Spotify**, and complete the OAuth flow once. Tokens land in `/data/state.json` and refresh automatically.

Full deployment notes (Apache reverse-proxy vhost, HTTPS): see [`DEPLOY.md`](https://github.com/PauloJf/song-randomizer/blob/main/DEPLOY.md).

## Tags

- `latest` — the newest published tag
- `X.Y.Z` — pinned version
- `X.Y` — floats within a minor

## Data

State lives at `/data/state.json` inside the container. Mount a named Docker volume so it survives image upgrades:

```
-v roulette-state:/data
```

`docker compose down -v` **will** remove that volume, so avoid it unless you want a hard reset.
