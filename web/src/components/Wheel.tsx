import { useEffect, useRef } from "react";
import type { Track } from "../api";
import { Ticker } from "../audio/ticker";

const TILE_HEIGHT = 128; // px, must match .wheel-tile in CSS
const DURATION_MS = 5000; // total spin time
const EXTRA_LOOPS = 4; // full-strip loops before landing, adds momentum

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

export function Wheel({
  order,
  winnerIndex,
  tracksById,
  ticker,
  onDone,
}: {
  order: string[];
  winnerIndex: number;
  tracksById: Record<string, Track>;
  ticker: Ticker;
  onDone: () => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!stripRef.current) return;
    doneRef.current = false;
    const startTime = performance.now();
    // Final Y translation: put winner in the center of the viewport.
    // Container is TILE_HEIGHT tall; strip's top starts flush with container's
    // top; we translate up by winnerIndex * TILE_HEIGHT so that tile is aligned
    // with the top… then we want it centered. Container's centerline is at
    // TILE_HEIGHT / 2, tile's center is at (winnerIndex + 0.5) * TILE_HEIGHT.
    // Translation needed: -(winnerIndex * TILE_HEIGHT).
    const finalOffset = winnerIndex * TILE_HEIGHT;
    // Add EXTRA_LOOPS full traversals of the (order.length * TILE_HEIGHT) strip
    // so the deceleration feels weighty.
    const loopDistance = order.length * TILE_HEIGHT;
    const totalDistance = EXTRA_LOOPS * loopDistance + finalOffset;

    let lastTileIndex = -1;
    let raf = 0;

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / DURATION_MS);
      const eased = easeOutCubic(t);
      const offset = eased * totalDistance;
      const strip = stripRef.current;
      if (strip) strip.style.transform = `translateY(${-offset}px)`;

      // Tick when a new tile crosses the center line.
      const currentTile = Math.floor(offset / TILE_HEIGHT);
      if (currentTile !== lastTileIndex) {
        lastTileIndex = currentTile;
        ticker.tick();
      }
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // We intentionally re-run only on order/winnerIndex change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, winnerIndex]);

  // Render EXTRA_LOOPS+1 copies of the strip so the DOM has enough tiles to
  // scroll through without the winner tile appearing early on-screen.
  const strips: string[] = [];
  for (let i = 0; i < EXTRA_LOOPS + 1; i++) strips.push(...order);

  return (
    <div className="wheel">
      <div className="wheel-viewport">
        <div className="wheel-strip" ref={stripRef}>
          {strips.map((id, i) => {
            const t = tracksById[id];
            return (
              <div key={`${id}-${i}`} className="wheel-tile">
                {t?.albumArt ? (
                  <img src={t.albumArt} alt="" loading="lazy" />
                ) : (
                  <div className="wheel-tile-placeholder">{t?.name ?? id}</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="wheel-indicator" aria-hidden="true" />
      </div>
    </div>
  );
}
