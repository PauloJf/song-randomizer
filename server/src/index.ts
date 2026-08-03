import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import { registerAuthRoutes } from "./auth.js";
import { loadState } from "./state.js";

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

const app = Fastify({ logger: true });

const cookieSecret = process.env.COOKIE_SECRET;
if (!cookieSecret || cookieSecret.length < 16) {
  app.log.warn(
    "COOKIE_SECRET is missing or too short (<16 chars). The PKCE cookie won't be signed strongly.",
  );
}
await app.register(fastifyCookie, {
  secret: cookieSecret ?? "dev-cookie-secret-change-me-please",
});

await registerAuthRoutes(app);

// Warm the state cache on boot so the file is created if missing and any
// migration in loadState runs before the first request.
await loadState();

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

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
