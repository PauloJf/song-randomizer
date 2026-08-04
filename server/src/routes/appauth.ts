import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAdmin } from "./admin.js";
import { attemptDelay, clearAttempts } from "../ratelimit.js";

const COOKIE_NAME = "app";
// Scope prefix inside the signed value — see the note in admin.ts.
const SCOPE = "app:";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — it's a party app

function appPassword(): string | null {
  const pw = process.env.APP_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

function isSecure(): boolean {
  return (process.env.BASE_URL ?? "").startsWith("https://");
}

function passwordMatches(candidate: string): boolean {
  const expected = appPassword();
  if (!expected) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isAppAuthed(req: FastifyRequest): boolean {
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return false;
  if (!unsigned.value.startsWith(SCOPE)) return false;
  const exp = Number(unsigned.value.slice(SCOPE.length));
  return Number.isFinite(exp) && exp > Date.now();
}

/**
 * Party-page gate. Open when no APP_PASSWORD is configured. An admin
 * session counts too, so the host never logs in twice.
 */
export function requireApp(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!appPassword()) return true;
  if (isAppAuthed(req) || isAdmin(req)) return true;
  reply.code(401).send({ error: "app_password_required" });
  return false;
}

export async function registerAppAuthRoutes(app: FastifyInstance) {
  app.get("/api/app/status", async (req) => ({
    locked: !!appPassword(),
    authed: !appPassword() || isAppAuthed(req) || isAdmin(req),
  }));

  app.post("/api/app/login", async (req, reply) => {
    if (!appPassword()) {
      // Nothing to log into — report success so the client just proceeds.
      return { authed: true };
    }
    const rateKey = `app:${req.ip}`;
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
    return { authed: true };
  });
}
