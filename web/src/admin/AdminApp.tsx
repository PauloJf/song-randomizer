import { useCallback, useEffect, useState } from "react";
import { adminApi, type AdminPlayer, type AdminSpin } from "../api";

type Gate =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "login"; error?: string }
  | { kind: "in" };

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [spins, setSpins] = useState<AdminSpin[]>([]);
  const [logPlayer, setLogPlayer] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (forPlayer: string) => {
    const [p, s] = await Promise.all([
      adminApi.players(),
      adminApi.spins(forPlayer || undefined),
    ]);
    setPlayers(p.players);
    setSpins(s.spins);
  }, []);

  useEffect(() => {
    adminApi
      .status()
      .then(async (st) => {
        if (!st.enabled) return setGate({ kind: "disabled" });
        if (!st.admin) return setGate({ kind: "login" });
        await refresh("");
        setGate({ kind: "in" });
      })
      .catch(() => setGate({ kind: "login", error: "Could not reach the server." }));
  }, [refresh]);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    if (typeof password !== "string" || !password) return;
    setBusy(true);
    try {
      await adminApi.login(password);
      await refresh(logPlayer);
      setGate({ kind: "in" });
    } catch (err) {
      const status = (err as { status?: number }).status;
      setGate({
        kind: "login",
        error: status === 401 ? "Wrong password." : "Login failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>, doneMsg?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      await refresh(logPlayer);
      if (doneMsg) setNotice(doneMsg);
    } catch (err) {
      const body = (err as { body?: { error?: string } }).body;
      setNotice(`Failed: ${body?.error ?? String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function switchLog(player: string) {
    setLogPlayer(player);
    setSpins((await adminApi.spins(player || undefined)).spins);
  }

  if (gate.kind === "loading") {
    return <main className="app admin"><p className="dim">Loading…</p></main>;
  }
  if (gate.kind === "disabled") {
    return (
      <main className="app admin">
        <h1>Admin</h1>
        <p className="dim">
          Admin features are disabled — set <code>ADMIN_PASSWORD</code> in the
          environment and restart.
        </p>
        <a className="btn" href="/">Back to the wheel</a>
      </main>
    );
  }
  if (gate.kind === "login") {
    return (
      <main className="app admin">
        <h1>Admin</h1>
        <form className="admin-login" onSubmit={handleLogin}>
          <input
            type="password"
            name="password"
            placeholder="Admin password"
            autoFocus
            autoComplete="current-password"
          />
          <button className="btn primary" disabled={busy}>
            Log in
          </button>
          {gate.error && <p className="err">{gate.error}</p>}
        </form>
        <a className="dim" href="/">← Back to the wheel</a>
      </main>
    );
  }

  return (
    <main className="app admin">
      <header className="admin-head">
        <h1>Admin</h1>
        <div className="admin-head-actions">
          <a className="btn" href="/">Wheel</a>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await adminApi.logout();
                setGate({ kind: "login" });
              })
            }
          >
            Log out
          </button>
        </div>
      </header>

      {notice && <p className="admin-notice">{notice}</p>}

      <section className="admin-section">
        <h2>Players</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Heard</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.heardCount}</td>
                <td className="admin-row-actions">
                  <button
                    className="btn small"
                    disabled={busy}
                    onClick={() => {
                      const to = window.prompt(`Rename ${p.name} to:`, p.name);
                      if (to && to !== p.name) {
                        void run(
                          () => adminApi.renamePlayer(p.name, to),
                          `Renamed ${p.name} → ${to}`,
                        );
                      }
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="btn small"
                    disabled={busy || p.heardCount === 0}
                    onClick={() =>
                      run(() => adminApi.reset(p.name), `Reset ${p.name}`)
                    }
                  >
                    Reset
                  </button>
                  <button
                    className="btn small danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove player ${p.name}?`)) {
                        void run(
                          () => adminApi.removePlayer(p.name),
                          `Removed ${p.name}`,
                        );
                      }
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form
          className="admin-add"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem(
              "newPlayer",
            ) as HTMLInputElement;
            const name = input.value.trim();
            if (name) {
              void run(() => adminApi.addPlayer(name), `Added ${name}`);
              input.value = "";
            }
          }}
        >
          <input name="newPlayer" placeholder="New player name" />
          <button className="btn small" disabled={busy}>
            Add
          </button>
          <button
            type="button"
            className="btn small danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Reset heard history for ALL players?")) {
                void run(() => adminApi.reset(), "Reset everyone");
              }
            }}
          >
            Reset all
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>Spin log</h2>
        <div className="admin-log-filter">
          <select
            value={logPlayer}
            onChange={(e) => void switchLog(e.target.value)}
          >
            <option value="">All players</option>
            {players.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {spins.length === 0 ? (
          <p className="dim">No spins yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Player</th>
                <th>Track</th>
              </tr>
            </thead>
            <tbody>
              {spins.map((s) => (
                <tr key={s.id} className={s.undone ? "undone" : undefined}>
                  <td className="admin-when">
                    {new Date(s.at).toLocaleString()}
                  </td>
                  <td>{s.player}</td>
                  <td>
                    {s.trackName ?? s.trackId}
                    {s.artist ? <span className="dim"> — {s.artist}</span> : null}
                    {s.undone ? <span className="undone-tag"> undone</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
