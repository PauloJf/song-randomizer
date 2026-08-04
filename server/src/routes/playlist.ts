import type { FastifyInstance } from "fastify";
import { SpotifyError } from "../spotify.js";
import { getPlaylist } from "../playlist.js";
import { requireApp } from "./appauth.js";

export async function registerPlaylistRoutes(app: FastifyInstance) {
  app.get("/api/playlist", async (req, reply) => {
    if (!requireApp(req, reply)) return;
    try {
      const { snapshotId, tracks } = await getPlaylist();
      return { snapshotId, tracks };
    } catch (err) {
      if (err instanceof SpotifyError) {
        reply.code(err.status === 401 ? 428 : 502).send({
          error: err.status === 401 ? "not_connected" : "spotify_error",
          detail: err.message,
        });
        return;
      }
      throw err;
    }
  });
}
