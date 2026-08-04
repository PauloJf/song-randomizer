import { useState } from "react";
import type { Track } from "../api";
import { api } from "../api";
import { Confetti } from "./Confetti";

type PlayState =
  | { kind: "idle" }
  | { kind: "playing" }
  | { kind: "played" }
  | {
      kind: "no_device";
      deepLink: string;
      webLink: string;
    }
  | { kind: "error"; message: string };

export function ResultCard({
  player,
  track,
  onAgain,
  onUndo,
  busy,
}: {
  player: string;
  track: Track;
  onAgain: () => void;
  onUndo: () => void;
  busy?: boolean;
}) {
  const [playState, setPlayState] = useState<PlayState>({ kind: "idle" });
  const [queueState, setQueueState] = useState<"idle" | "busy" | "done" | "error">(
    "idle",
  );
  const [queueError, setQueueError] = useState<string | null>(null);
  const mins = Math.floor(track.durationMs / 60_000);
  const secs = Math.floor((track.durationMs % 60_000) / 1000)
    .toString()
    .padStart(2, "0");

  async function handlePlay() {
    setPlayState({ kind: "playing" });
    try {
      await api.play(track.id);
      setPlayState({ kind: "played" });
    } catch (e) {
      const err = e as Error & {
        status?: number;
        body?: {
          reason?: string;
          deepLink?: string;
          webLink?: string;
          detail?: string;
        };
      };
      if (err.status === 409 && err.body?.reason === "no_active_device") {
        setPlayState({
          kind: "no_device",
          deepLink: err.body.deepLink ?? `spotify:track:${track.id}`,
          webLink:
            err.body.webLink ?? `https://open.spotify.com/track/${track.id}`,
        });
      } else if (err.status === 403) {
        setPlayState({
          kind: "error",
          message:
            err.body?.detail ??
            "Playback needs Spotify Premium or the track is restricted.",
        });
      } else if (err.status === 429) {
        setPlayState({
          kind: "error",
          message: "Rate-limited by Spotify. Try again in a moment.",
        });
      } else if (err.status === 428) {
        setPlayState({ kind: "error", message: "Not connected to Spotify." });
      } else {
        setPlayState({
          kind: "error",
          message: err.body?.detail ?? err.message ?? "Playback failed.",
        });
      }
    }
  }

  async function handleQueue() {
    setQueueState("busy");
    setQueueError(null);
    try {
      await api.queue(track.id);
      setQueueState("done");
    } catch (e) {
      const err = e as Error & {
        status?: number;
        body?: { reason?: string; detail?: string };
      };
      setQueueState("error");
      if (err.status === 409 && err.body?.reason === "no_active_device") {
        setQueueError(
          "No active device — play something in Spotify once, then retry.",
        );
      } else if (err.status === 403) {
        setQueueError("Queueing needs Spotify Premium.");
      } else {
        setQueueError(err.body?.detail ?? err.message ?? "Queueing failed.");
      }
    }
  }

  return (
    <section className="result">
      <Confetti />
      <p className="result-caller">{player}'s spin</p>
      <div className="result-art">
        {track.albumArt ? (
          <img src={track.albumArt} alt={track.album} />
        ) : (
          <div className="wheel-tile-placeholder">no art</div>
        )}
      </div>
      <h2 className="result-title">{track.name}</h2>
      <p className="result-artist">{track.artist}</p>
      <p className="result-meta">
        {track.album} · {mins}:{secs}
      </p>
      <div className="result-actions">
        {playState.kind === "no_device" ? (
          <>
            <a
              className="btn primary"
              href={playState.deepLink}
              onClick={() => {
                // On desktop the deep link may not resolve; fall back to web
                // after a short delay if the tab is still focused.
                setTimeout(() => {
                  if (!document.hidden) window.location.href = playState.webLink;
                }, 1500);
              }}
            >
              Open in Spotify
            </a>
            <button
              className="btn"
              onClick={() => setPlayState({ kind: "idle" })}
            >
              Retry
            </button>
          </>
        ) : (
          <button
            className="btn primary"
            onClick={handlePlay}
            disabled={playState.kind === "playing"}
          >
            {playState.kind === "playing"
              ? "Starting…"
              : playState.kind === "played"
                ? "Playing"
                : "Play"}
          </button>
        )}
        <button
          className="btn"
          onClick={handleQueue}
          disabled={queueState === "busy" || queueState === "done"}
        >
          {queueState === "busy"
            ? "Queueing…"
            : queueState === "done"
              ? "Queued ✓"
              : "Play next"}
        </button>
        <button className="btn" onClick={onUndo} disabled={busy}>
          Undo
        </button>
        <button className="btn" onClick={onAgain} disabled={busy}>
          Next spin
        </button>
      </div>
      {playState.kind === "no_device" && (
        <p className="dim playhint">
          Open Spotify and play anything once to register the speaker.
        </p>
      )}
      {playState.kind === "error" && (
        <p className="err">{playState.message}</p>
      )}
      {queueError && <p className="err">{queueError}</p>}
    </section>
  );
}
