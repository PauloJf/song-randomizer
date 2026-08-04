import { useEffect, useMemo, useRef, useState } from "react";
import { api, type PlayerSummary, type SpinResult, type Track } from "./api";
import { Ticker } from "./audio/ticker";
import { Connect } from "./components/Connect";
import { PlayerPicker } from "./components/PlayerPicker";
import { Wheel } from "./components/Wheel";
import { ResultCard } from "./components/ResultCard";

type Phase =
  | { kind: "boot" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string }
  | { kind: "idle" }
  | { kind: "spinning"; player: string; spin: SpinResult }
  | { kind: "result"; player: string; spin: SpinResult }
  | { kind: "exhausted"; player: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const tickerRef = useRef(new Ticker());

  const tracksById = useMemo<Record<string, Track>>(() => {
    const map: Record<string, Track> = {};
    for (const t of tracks) map[t.id] = t;
    return map;
  }, [tracks]);

  async function loadAll() {
    setPhase({ kind: "boot" });
    try {
      const status = await api.authStatus();
      if (!status.connected) {
        setPhase({ kind: "disconnected" });
        return;
      }
      const [pl, ps] = await Promise.all([api.playlist(), api.players()]);
      setTracks(pl.tracks);
      setPlayers(ps.players);
      // Kick off browser image caching for tile art in the background.
      for (const t of pl.tracks) {
        if (t.albumArt) {
          const img = new Image();
          img.src = t.albumArt;
        }
      }
      setPhase({ kind: "idle" });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 428) {
        setPhase({ kind: "disconnected" });
      } else {
        setPhase({ kind: "error", message: err.message ?? String(e) });
      }
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handlePick(player: string) {
    // AudioContext must be unlocked inside the tap handler on iOS.
    tickerRef.current.unlock();
    if (busy) return;
    setBusy(true);
    try {
      const spin = await api.spin(player);
      setPhase({ kind: "spinning", player, spin });
    } catch (e) {
      const err = e as Error & { status?: number; body?: { reason?: string } };
      if (err.status === 409 && err.body?.reason === "exhausted") {
        setPhase({ kind: "exhausted", player });
      } else if (err.status === 428) {
        setPhase({ kind: "disconnected" });
      } else {
        setPhase({ kind: "error", message: err.message ?? String(e) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshPlayers() {
    try {
      const ps = await api.players();
      setPlayers(ps.players);
    } catch {
      /* non-fatal */
    }
  }

  function handleWheelDone() {
    if (phase.kind !== "spinning") return;
    setPhase({ kind: "result", player: phase.player, spin: phase.spin });
    void refreshPlayers();
  }

  async function handleUndo() {
    if (busy) return;
    setBusy(true);
    try {
      await api.undo();
      await refreshPlayers();
      setPhase({ kind: "idle" });
    } catch {
      /* nothing user-actionable */
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPlayer(name: string) {
    if (busy) return;
    setBusy(true);
    setResetError(null);
    try {
      await api.reset(name);
      await refreshPlayers();
      setPhase({ kind: "idle" });
    } catch (e) {
      const err = e as Error & { status?: number };
      setResetError(
        err.status === 401
          ? "Resets need the admin login."
          : `Reset failed: ${err.message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>Spotify Roulette</h1>
      </header>
      {phase.kind === "boot" && <p className="dim">Loading…</p>}
      {phase.kind === "disconnected" && <Connect />}
      {phase.kind === "error" && (
        <div className="error">
          <p>Error: {phase.message}</p>
          <button className="btn" onClick={loadAll}>
            Retry
          </button>
        </div>
      )}
      {phase.kind === "idle" && (
        <PlayerPicker players={players} onPick={handlePick} disabled={busy} />
      )}
      {phase.kind === "spinning" && (
        <>
          <p className="dim">{phase.player}'s spin</p>
          <Wheel
            order={phase.spin.wheelOrder}
            winnerIndex={phase.spin.winnerIndex}
            tracksById={tracksById}
            ticker={tickerRef.current}
            onDone={handleWheelDone}
          />
        </>
      )}
      {phase.kind === "result" && (
        <ResultCard
          player={phase.player}
          track={phase.spin.track}
          onAgain={() => setPhase({ kind: "idle" })}
          onUndo={handleUndo}
          busy={busy}
        />
      )}
      {phase.kind === "exhausted" && (
        <section className="exhausted">
          <h2>{phase.player} has heard it all</h2>
          <p className="dim">
            No unheard tracks left. Reset just this player, or pick someone
            else.
          </p>
          <div className="result-actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => handleResetPlayer(phase.player)}
            >
              Reset {phase.player}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => setPhase({ kind: "idle" })}
            >
              Back
            </button>
          </div>
          {resetError && (
            <p className="err">
              {resetError} <a href="/admin">Open admin</a>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
