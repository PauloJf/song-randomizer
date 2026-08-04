import type { FastifyInstance } from "fastify";
import { getPlaylist } from "../playlist.js";
import { SpotifyError } from "../spotify.js";
import { getDb } from "../db.js";
import { buildWheelOrder, pickTrackId } from "../spin.js";
import { isAdmin } from "./admin.js";

type SpinBody = { player?: unknown };

function playerName(b: unknown): string | null {
  if (b && typeof b === "object" && typeof (b as SpinBody).player === "string") {
    return (b as { player: string }).player;
  }
  return null;
}

export async function registerSpinRoutes(app: FastifyInstance) {
  app.post("/api/spin", async (req, reply) => {
    const player = playerName(req.body);
    if (!player) {
      reply.code(400).send({ error: "player_required" });
      return;
    }
    let playlist;
    try {
      playlist = await getPlaylist();
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

    const db = getDb();
    if (!db.hasPlayer(player)) {
      reply.code(404).send({ error: "unknown_player", player });
      return;
    }

    const allIds = playlist.tracks.map((t) => t.id);
    const winnerId = pickTrackId(allIds, db.getHeard(player));
    if (!winnerId) {
      reply.code(409).send({ error: "exhausted", reason: "exhausted" });
      return;
    }
    const track = playlist.tracks.find((t) => t.id === winnerId)!;
    const wheel = buildWheelOrder(allIds, winnerId);

    db.recordSpin(player, { id: track.id, name: track.name, artist: track.artist });

    return {
      track,
      wheelOrder: wheel.order,
      winnerIndex: wheel.winnerIndex,
    };
  });

  app.post("/api/spin/undo", async (_req, reply) => {
    const undone = getDb().undoLastSpin();
    if (!undone) {
      reply.code(404).send({ error: "no_spins_to_undo" });
      return;
    }
    return { undone };
  });

  // Reset requires the admin session when ADMIN_PASSWORD is configured;
  // on installs without one it stays open (nothing to authenticate against).
  app.post("/api/reset", async (req, reply) => {
    if (process.env.ADMIN_PASSWORD && !isAdmin(req)) {
      reply.code(401).send({ error: "admin_required" });
      return;
    }
    const body = (req.body ?? {}) as { player?: unknown };
    const target =
      typeof body.player === "string" && body.player.length ? body.player : null;
    const db = getDb();
    if (target) {
      db.resetPlayer(target);
    } else {
      db.resetAll();
    }
    return { reset: target ?? "all" };
  });
}
