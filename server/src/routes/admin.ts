import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "../db.js";
import { clearPlaylistCache, getPlaylist, resolveUserNames } from "../playlist.js";
import { isConnected, SpotifyError, spotifyFetch } from "../spotify.js";
import { attemptDelay, clearAttempts } from "../ratelimit.js";

const COOKIE_NAME = "admin";
// The scope prefix is part of the signed value. Without it, the `app` and
// `admin` cookies would be interchangeable (same secret, same shape) and a
// party guest could replay their app cookie under the admin name.
const SCOPE = "admin:";
const SESSION_MS = 12 * 60 * 60 * 1000; // 12h — covers a party and then some

function adminPassword(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

function isSecure(): boolean {
  return (process.env.BASE_URL ?? "").startsWith("https://");
}

function passwordMatches(candidate: string): boolean {
  const expected = adminPassword();
  if (!expected) return false;
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** True when the request carries a valid, unexpired admin session cookie. */
export function isAdmin(req: FastifyRequest): boolean {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return false;
  if (!unsigned.value.startsWith(SCOPE)) return false;
  const exp = Number(unsigned.value.slice(SCOPE.length));
  return Number.isFinite(exp) && exp > Date.now();
}

/**
 * Admin gate. When no ADMIN_PASSWORD is configured, admin features are
 * disabled and this always rejects (503 so the client can say why).
 */
function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!adminPassword()) {
    reply.code(503).send({ error: "admin_disabled" });
    return false;
  }
  if (!isAdmin(req)) {
    reply.code(401).send({ error: "admin_required" });
    return false;
  }
  return true;
}

type Overview = {
  connected: boolean;
  playlist: { name: string; tracks: number; snapshotId: string } | null;
  playlistError: string | null;
  devices: { id: string; name: string; type: string; is_active: boolean }[] | null;
};

async function buildOverview(): Promise<Overview> {
  const connected = isConnected();
  const overview: Overview = {
    connected,
    playlist: null,
    playlistError: null,
    devices: null,
  };
  if (!connected) return overview;
  try {
    const p = await getPlaylist();
    overview.playlist = {
      name: p.name,
      tracks: p.tracks.length,
      snapshotId: p.snapshotId,
    };
  } catch (err) {
    overview.playlistError =
      err instanceof SpotifyError ? err.message : "playlist fetch failed";
  }
  try {
    const r = await spotifyFetch("/me/player/devices");
    if (r.ok) {
      const j = (await r.json()) as { devices: Overview["devices"] };
      overview.devices = j.devices ?? [];
    }
  } catch {
    // devices stay null — the panel shows "unavailable"
  }
  return overview;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/api/admin/login", async (req, reply) => {
    if (!adminPassword()) {
      reply.code(503).send({ error: "admin_disabled" });
      return;
    }
    const rateKey = `admin:${req.ip}`;
    const wait = attemptDelay(rateKey);
    if (wait > 0) {
      reply.code(429).send({ error: "too_many_attempts", retryAfterSeconds: wait });
      return;
    }
    const body = (req.body ?? {}) as { password?: unknown };
    if (typeof body.password !== "string" || !passwordMatches(body.password)) {
      reply.code(401).send({ error: "wrong_password" });
      return;
    }
    clearAttempts(rateKey);
    const expires = Date.now() + SESSION_MS;
    reply.setCookie(COOKIE_NAME, `${SCOPE}${expires}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure(),
      signed: true,
      path: "/",
      maxAge: Math.floor(SESSION_MS / 1000),
    });
    return { admin: true };
  });

  app.post("/api/admin/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { admin: false };
  });

  app.get("/api/admin/status", async (req) => ({
    enabled: !!adminPassword(),
    admin: isAdmin(req),
  }));

  app.get("/api/admin/players", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { players: getDb().listPlayers() };
  });

  app.post("/api/admin/players", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body ?? {}) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      reply.code(400).send({ error: "name_required" });
      return;
    }
    if (name.length > 40) {
      reply.code(400).send({ error: "name_too_long", max: 40 });
      return;
    }
    const db = getDb();
    if (db.hasPlayer(name)) {
      reply.code(409).send({ error: "player_exists" });
      return;
    }
    db.addPlayer(name);
    return { players: db.listPlayers() };
  });

  app.post("/api/admin/players/rename", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body ?? {}) as { from?: unknown; to?: unknown };
    const from = typeof body.from === "string" ? body.from : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";
    const db = getDb();
    if (!from || !db.hasPlayer(from)) {
      reply.code(404).send({ error: "unknown_player" });
      return;
    }
    if (!to) {
      reply.code(400).send({ error: "name_required" });
      return;
    }
    if (to.length > 40) {
      reply.code(400).send({ error: "name_too_long", max: 40 });
      return;
    }
    if (db.hasPlayer(to)) {
      reply.code(409).send({ error: "player_exists" });
      return;
    }
    db.renamePlayer(from, to);
    return { players: db.listPlayers() };
  });

  app.delete("/api/admin/players/:name", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { name } = req.params as { name: string };
    const db = getDb();
    if (!db.hasPlayer(name)) {
      reply.code(404).send({ error: "unknown_player" });
      return;
    }
    db.removePlayer(name);
    return { players: db.listPlayers() };
  });

  app.post("/api/admin/reset", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body ?? {}) as { player?: unknown };
    const target =
      typeof body.player === "string" && body.player.length ? body.player : null;
    const db = getDb();
    if (target) db.resetPlayer(target);
    else db.resetAll();
    return { reset: target ?? "all", players: db.listPlayers() };
  });

  app.get("/api/admin/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const base = getDb().stats();
    // Playlist contributor stats: who added what, from Spotify's added_by.
    let playlistStats: {
      totalTracks: number;
      totalMs: number;
      avgMs: number;
      adders: {
        name: string;
        player: string | null;
        songs: number;
        totalMs: number;
        avgMs: number;
      }[];
    } | null = null;
    try {
      const p = await getPlaylist();
      const byAdder = new Map<string, { songs: number; totalMs: number }>();
      let totalMs = 0;
      for (const t of p.tracks) {
        totalMs += t.durationMs;
        const key = t.addedBy ?? "unknown";
        const agg = byAdder.get(key) ?? { songs: 0, totalMs: 0 };
        agg.songs++;
        agg.totalMs += t.durationMs;
        byAdder.set(key, agg);
      }
      const names = await resolveUserNames(
        [...byAdder.keys()].filter((k) => k !== "unknown"),
      );
      // Contributors are usually the players themselves — link them up when
      // the Spotify display name matches a player name (case-insensitive).
      const playerNames = new Map(
        getDb()
          .listPlayers()
          .map((pl) => [pl.name.toLowerCase(), pl.name]),
      );
      playlistStats = {
        totalTracks: p.tracks.length,
        totalMs,
        avgMs: p.tracks.length ? Math.round(totalMs / p.tracks.length) : 0,
        adders: [...byAdder.entries()]
          .map(([id, agg]) => {
            const name = id === "unknown" ? "unknown" : (names.get(id) ?? id);
            return {
              name,
              player: playerNames.get(name.toLowerCase()) ?? null,
              songs: agg.songs,
              totalMs: agg.totalMs,
              avgMs: Math.round(agg.totalMs / agg.songs),
            };
          })
          .sort((a, b) => b.songs - a.songs || a.name.localeCompare(b.name)),
      };
    } catch (err) {
      if (!(err instanceof SpotifyError)) throw err;
      // Not connected — spins-only stats.
    }
    return { ...base, playlistStats };
  });

  // The "why isn't it working" panel: connection, devices, playlist.
  app.get("/api/admin/overview", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return buildOverview();
  });

  app.post("/api/admin/playlist/refresh", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    clearPlaylistCache();
    return buildOverview();
  });

  app.post("/api/admin/spins/:id/undo", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400).send({ error: "bad_spin_id" });
      return;
    }
    const undone = getDb().undoSpin(id);
    if (!undone) {
      reply.code(404).send({ error: "spin_not_found_or_already_undone" });
      return;
    }
    return { undone };
  });

  app.get("/api/admin/spins", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = req.query as { player?: string };
    const rows = getDb().spinLog(q.player || undefined);
    // Fill in track names missing from pre-SQLite spins using the playlist
    // cache, when available.
    const unnamed = rows.some((r) => !r.trackName);
    if (unnamed) {
      try {
        const { tracks } = await getPlaylist();
        const byId = new Map(tracks.map((t) => [t.id, t]));
        for (const r of rows) {
          if (!r.trackName) {
            const t = byId.get(r.trackId);
            if (t) {
              r.trackName = t.name;
              r.artist = t.artist;
            }
          }
        }
      } catch (err) {
        if (!(err instanceof SpotifyError)) throw err;
        // Not connected — leave ids as-is.
      }
    }
    return { spins: rows };
  });
}
