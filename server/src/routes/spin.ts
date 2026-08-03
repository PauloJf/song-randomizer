import type { FastifyInstance } from "fastify";
import { getPlaylist } from "../playlist.js";
import { SpotifyError } from "../spotify.js";
import { loadState, mutateState } from "../state.js";
import { buildWheelOrder, pickTrackId } from "../spin.js";

type SpinBody = { player?: unknown };
type ResetBody = { player?: unknown };

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

    const state = await loadState();
    if (!state.players[player]) {
      reply.code(404).send({ error: "unknown_player", player });
      return;
    }

    const allIds = playlist.tracks.map((t) => t.id);
    const winnerId = pickTrackId(allIds, state.players[player].heard);
    if (!winnerId) {
      reply.code(409).send({ error: "exhausted", reason: "exhausted" });
      return;
    }
    const track = playlist.tracks.find((t) => t.id === winnerId)!;
    const wheel = buildWheelOrder(allIds, winnerId);

    await mutateState((st) => {
      st.players[player].heard.push(winnerId);
      st.spins.push({
        player,
        trackId: winnerId,
        at: new Date().toISOString(),
      });
    });

    return {
      track,
      wheelOrder: wheel.order,
      winnerIndex: wheel.winnerIndex,
    };
  });

  app.post("/api/spin/undo", async (_req, reply) => {
    const undone = await mutateState((st) => {
      const last = st.spins.pop();
      if (!last) return null;
      const heard = st.players[last.player]?.heard;
      if (heard) {
        // Remove only the most-recent occurrence of that trackId.
        const idx = heard.lastIndexOf(last.trackId);
        if (idx >= 0) heard.splice(idx, 1);
      }
      return last;
    });
    if (!undone) {
      reply.code(404).send({ error: "no_spins_to_undo" });
      return;
    }
    return { undone };
  });

  app.post("/api/reset", async (req) => {
    const body = (req.body ?? {}) as ResetBody;
    const target =
      typeof body.player === "string" && body.player.length ? body.player : null;
    await mutateState((st) => {
      if (target) {
        if (st.players[target]) {
          st.players[target].heard = [];
          st.spins = st.spins.filter((s) => s.player !== target);
        }
      } else {
        for (const p of Object.values(st.players)) p.heard = [];
        st.spins = [];
      }
    });
    return { reset: target ?? "all" };
  });
}
