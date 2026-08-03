import type { Track } from "../api";

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
  const mins = Math.floor(track.durationMs / 60_000);
  const secs = Math.floor((track.durationMs % 60_000) / 1000)
    .toString()
    .padStart(2, "0");
  return (
    <section className="result">
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
        <button className="btn primary" disabled title="Wired up in Phase 5">
          Play
        </button>
        <button className="btn" onClick={onUndo} disabled={busy}>
          Undo
        </button>
        <button className="btn" onClick={onAgain} disabled={busy}>
          Next spin
        </button>
      </div>
    </section>
  );
}
