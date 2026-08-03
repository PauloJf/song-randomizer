import { useEffect, useState } from "react";

type Health = { status: string; time: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="scaffold">
      <h1>Spotify Roulette</h1>
      <p className="tag">Placeholder — Phase 1 scaffold</p>
      <section className="health">
        {error && <p className="err">API error: {error}</p>}
        {!error && !health && <p>Checking backend…</p>}
        {health && (
          <p>
            Backend: <strong>{health.status}</strong> · {health.time}
          </p>
        )}
      </section>
    </main>
  );
}
