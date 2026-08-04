import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { exchangeCode, isConnected, redirectUri } from "./spotify.js";
import { getDb } from "./db.js";

const SCOPES = [
  "playlist-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

const COOKIE_NAME = "pkce";
const COOKIE_MAX_AGE = 600; // seconds

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeVerifier(): string {
  // 64 bytes → 86-char base64url string, well within Spotify's 43–128 window.
  return base64url(randomBytes(64));
}

function makeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("SPOTIFY_CLIENT_ID is not set");
  return id;
}

function isSecure(): boolean {
  return (process.env.BASE_URL ?? "").startsWith("https://");
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/login", async (req, reply) => {
    const verifier = makeVerifier();
    const state = base64url(randomBytes(16));
    const payload = JSON.stringify({ v: verifier, s: state });
    reply.setCookie(COOKIE_NAME, payload, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecure(),
      signed: true,
      path: "/api/auth",
      maxAge: COOKIE_MAX_AGE,
    });
    const params = new URLSearchParams({
      client_id: clientId(),
      response_type: "code",
      redirect_uri: redirectUri(),
      code_challenge_method: "S256",
      code_challenge: makeChallenge(verifier),
      state,
      scope: SCOPES,
    });
    reply.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`, 302);
  });

  app.get("/api/auth/callback", async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    if (query.error) {
      reply.code(400).send({ error: "spotify_error", detail: query.error });
      return;
    }
    if (!query.code || !query.state) {
      reply.code(400).send({ error: "missing_code_or_state" });
      return;
    }
    const raw = req.cookies[COOKIE_NAME];
    if (!raw) {
      reply.code(400).send({ error: "missing_pkce_cookie" });
      return;
    }
    const unsigned = reply.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      reply.code(400).send({ error: "invalid_pkce_cookie" });
      return;
    }
    let payload: { v: string; s: string };
    try {
      payload = JSON.parse(unsigned.value);
    } catch {
      reply.code(400).send({ error: "malformed_pkce_cookie" });
      return;
    }
    if (payload.s !== query.state) {
      reply.code(400).send({ error: "state_mismatch" });
      return;
    }
    try {
      const tokens = await exchangeCode(query.code, payload.v);
      getDb().setTokens(tokens);
    } catch (err) {
      req.log.error({ err }, "token exchange failed");
      reply.code(502).send({ error: "token_exchange_failed" });
      return;
    }
    reply.clearCookie(COOKIE_NAME, { path: "/api/auth" });
    reply.redirect("/", 302);
  });

  app.get("/api/auth/status", async () => ({ connected: isConnected() }));
}
