import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getDb } from "../db.js";
import { getPlaylist } from "../playlist.js";
import { SpotifyError } from "../spotify.js";

const COOKIE_NAME = "admin";
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
  const exp = Number(unsigned.value);
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

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/api/admin/login", async (req, reply) => {
    if (!adminPassword()) {
      reply.code(503).send({ error: "admin_disabled" });
      return;
    }
    const body = (req.body ?? {}) as { password?: unknown };
    if (typeof body.password !== "string" || !passwordMatches(body.password)) {
      reply.code(401).send({ error: "wrong_password" });
      return;
    }
    const expires = Date.now() + SESSION_MS;
    reply.setCookie(COOKIE_NAME, String(expires), {
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
