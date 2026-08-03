/**
 * Pure spin logic — inputs and outputs only, no I/O. Kept separate so the
 * eligibility filter and the wheel-strip builder are unit-testable without
 * mocking Spotify or the state file.
 */

export type Rng = () => number;

export function eligibleTrackIds(
  allTrackIds: readonly string[],
  heard: readonly string[],
): string[] {
  const heardSet = new Set(heard);
  return allTrackIds.filter((id) => !heardSet.has(id));
}

/** Return one uniformly-random track id the player hasn't heard, or null. */
export function pickTrackId(
  allTrackIds: readonly string[],
  heard: readonly string[],
  rng: Rng = Math.random,
): string | null {
  const pool = eligibleTrackIds(allTrackIds, heard);
  if (pool.length === 0) return null;
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.min(idx, pool.length - 1)];
}

export type WheelOrder = { order: string[]; winnerIndex: number };

/**
 * Build a wheel strip: `length` tiles drawn (with replacement, if the pool is
 * small) from `allTrackIds`, with `winnerId` slotted at a random index near
 * the end so the visual deceleration finishes on the winner.
 */
export function buildWheelOrder(
  allTrackIds: readonly string[],
  winnerId: string,
  length = 60,
  rng: Rng = Math.random,
): WheelOrder {
  const pool = allTrackIds.length > 0 ? allTrackIds : [winnerId];
  const order = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    order[i] = pool[Math.floor(rng() * pool.length) % pool.length];
  }
  // Winner rests near the end (but not the very last tile) so tiles above it
  // "flew past" during deceleration.
  const minIdx = Math.max(0, Math.floor(length * 0.7));
  const maxIdx = Math.max(minIdx, length - 5);
  const span = Math.max(1, maxIdx - minIdx + 1);
  const winnerIndex = minIdx + (Math.floor(rng() * span) % span);
  order[winnerIndex] = winnerId;
  return { order, winnerIndex };
}
