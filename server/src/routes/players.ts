import type { FastifyInstance } from "fastify";
import { loadState } from "../state.js";
import { getPlaylist } from "../playlist.js";
import { SpotifyError } from "../spotify.js";

export async function registerPlayersRoutes(app: FastifyInstance) {
  app.get("/api/players", async (_req, reply) => {
    const state = await loadState();
    let total: number | null = null;
    try {
      const p = await getPlaylist();
      total = p.tracks.length;
    } catch (err) {
      if (!(err instanceof SpotifyError)) throw err;
      // Fall through: return names + heard without a "remaining" count.
    }
    const players = Object.entries(state.players).map(([name, data]) => ({
      name,
      heard: data.heard.length,
      remaining: total == null ? null : Math.max(0, total - data.heard.length),
    }));
    return { total, players };
  });
}
