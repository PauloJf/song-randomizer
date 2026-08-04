import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";
import { getPlaylist } from "../playlist.js";
import { SpotifyError } from "../spotify.js";
import { requireApp } from "./appauth.js";

export async function registerPlayersRoutes(app: FastifyInstance) {
  app.get("/api/players", async (req, reply) => {
    if (!requireApp(req, reply)) return;
    let total: number | null = null;
    try {
      const p = await getPlaylist();
      total = p.tracks.length;
    } catch (err) {
      if (!(err instanceof SpotifyError)) throw err;
      // Fall through: return names + heard without a "remaining" count.
    }
    const players = getDb()
      .listPlayers()
      .map((p) => ({
        name: p.name,
        heard: p.heardCount,
        remaining: total == null ? null : Math.max(0, total - p.heardCount),
      }));
    return { total, players };
  });
}
