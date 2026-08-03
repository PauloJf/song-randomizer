import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

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
