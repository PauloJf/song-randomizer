import type { PlayerSummary } from "../api";

export function PlayerPicker({
  players,
  onPick,
  disabled,
}: {
  players: PlayerSummary[];
  onPick: (name: string) => void;
  disabled?: boolean;
}) {
  return (
    <section className="picker">
      <h2>Who's up?</h2>
      <div className="picker-grid">
        {players.map((p) => {
          const exhausted = p.remaining === 0;
          return (
            <button
              key={p.name}
              className={`player-btn${exhausted ? " exhausted" : ""}`}
              disabled={disabled || exhausted}
              onClick={() => onPick(p.name)}
            >
              <span className="player-name">{p.name}</span>
              <span className="player-meta">
                {p.remaining == null
                  ? `${p.heard} heard`
                  : exhausted
                    ? "Exhausted"
                    : `${p.remaining} left`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
