import type { FastifyInstance } from "fastify";
import { SpotifyError, spotifyFetch } from "../spotify.js";

type PlayBody = { trackId?: unknown };

function trackIdFrom(body: unknown): string | null {
  if (body && typeof body === "object" && typeof (body as PlayBody).trackId === "string") {
    return (body as { trackId: string }).trackId;
  }
  return null;
}

async function safeParseError(r: Response): Promise<{ message?: string; raw: string }> {
  const text = await r.text();
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    return { message: j?.error?.message, raw: text };
  } catch {
    return { raw: text };
  }
}

export async function registerPlaybackRoutes(app: FastifyInstance) {
  app.post("/api/play", async (req, reply) => {
    const trackId = trackIdFrom(req.body);
    if (!trackId) {
      reply.code(400).send({ error: "trackId_required" });
      return;
    }
    try {
      const r = await spotifyFetch("/me/player/play", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      });
      if (r.status === 204 || r.status === 202) {
        return { ok: true };
      }
      if (r.status === 404) {
        // No active device — surface as 409 so the client can offer the deep link.
        const detail = await safeParseError(r);
        reply.code(409).send({
          error: "no_active_device",
          reason: "no_active_device",
          detail: detail.message,
          deepLink: `spotify:track:${trackId}`,
          webLink: `https://open.spotify.com/track/${trackId}`,
        });
        return;
      }
      if (r.status === 403) {
        // Premium required, restricted content, etc.
        const detail = await safeParseError(r);
        reply.code(403).send({
          error: "premium_required_or_restricted",
          detail: detail.message,
        });
        return;
      }
      if (r.status === 429) {
        reply.code(429).send({
          error: "rate_limited",
          detail: r.headers.get("retry-after"),
        });
        return;
      }
      const detail = await safeParseError(r);
      reply.code(502).send({ error: "spotify_error", status: r.status, detail: detail.message });
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

  app.get("/api/devices", async (_req, reply) => {
    try {
      const r = await spotifyFetch("/me/player/devices");
      if (!r.ok) {
        const detail = await safeParseError(r);
        reply.code(502).send({ error: "spotify_error", status: r.status, detail: detail.message });
        return;
      }
      return await r.json();
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
