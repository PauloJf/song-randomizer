import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { registerAuthRoutes } from "./auth.js";
import { registerPlaylistRoutes } from "./routes/playlist.js";
import { registerPlayersRoutes } from "./routes/players.js";
import { registerSpinRoutes } from "./routes/spin.js";
import { registerPlaybackRoutes } from "./routes/playback.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAppAuthRoutes } from "./routes/appauth.js";
import { getDb } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

// In the runtime image the built frontend is copied to /app/web-dist.
// In local dev (tsx from server/src/) it's at ../../web/dist.
const staticCandidates = [
  path.resolve(__dirname, "../web-dist"),
  path.resolve(__dirname, "../../web/dist"),
];
const staticRoot = staticCandidates.find((p) => existsSync(p));

// trustProxy: the app sits behind Apache in production, so req.ip must come
// from X-Forwarded-For for the login rate limiter to see real clients.
const app = Fastify({ logger: true, trustProxy: true });

// Lenient JSON: some clients send `content-type: application/json` with an
// empty body on POST/DELETE. Treat that as {} instead of a 400.
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => {
    if (body === "" || body == null) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error);
    }
  },
);

const cookieSecret = process.env.COOKIE_SECRET;
if (!cookieSecret || cookieSecret.length < 16) {
  // Session and PKCE cookies are only as strong as this secret. A predictable
  // fallback in production would let anyone forge an admin session.
  if (process.env.NODE_ENV === "production") {
    app.log.fatal("COOKIE_SECRET is missing or too short (<16 chars). Refusing to start.");
    process.exit(1);
  }
  app.log.warn("COOKIE_SECRET is missing or too short (<16 chars). Dev fallback in use.");
}
await app.register(fastifyCookie, {
  secret: cookieSecret ?? "dev-cookie-secret-change-me-please",
});

// Baseline security headers. The CSP allows self plus Spotify's image CDNs
// (album art); everything else stays same-origin.
app.addHook("onSend", async (_req, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header(
    "content-security-policy",
    "default-src 'self'; img-src 'self' https: data:; script-src 'self'; " +
      "style-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
  );
});

await registerAuthRoutes(app);
await registerPlaylistRoutes(app);
await registerPlayersRoutes(app);
await registerSpinRoutes(app);
await registerPlaybackRoutes(app);
await registerAdminRoutes(app);
await registerAppAuthRoutes(app);

// Open the database on boot so schema creation and the one-time state.json
// import run before the first request.
getDb();

app.get("/api/health", async () => ({
  status: "ok",
  time: new Date().toISOString(),
}));

if (staticRoot) {
  await app.register(fastifyStatic, {
    root: staticRoot,
    prefix: "/",
    wildcard: false,
  });

  // SPA fallback: any non-API GET that isn't a real file → index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api/")) {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    reply.sendFile("index.html");
  });
} else {
  app.log.warn(
    "No built frontend found. Backend running API-only. Run `npm run build` in web/ or use Vite dev server.",
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    getDb().close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
