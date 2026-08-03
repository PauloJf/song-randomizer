import { describe, expect, it } from "vitest";
import { buildWheelOrder, eligibleTrackIds, pickTrackId } from "./spin.js";

/** Deterministic RNG that walks a fixed sequence in [0,1). */
function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("eligibleTrackIds", () => {
  it("removes heard tracks in order", () => {
    expect(eligibleTrackIds(["a", "b", "c", "d"], ["b", "d"])).toEqual(["a", "c"]);
  });
  it("handles empty heard", () => {
    expect(eligibleTrackIds(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("pickTrackId", () => {
  it("never returns a heard track", () => {
    const rng = fixedRng([0.1, 0.5, 0.999]);
    for (let i = 0; i < 3; i++) {
      const pick = pickTrackId(["a", "b", "c", "d"], ["b", "c"], rng);
      expect(["a", "d"]).toContain(pick);
    }
  });

  it("returns null when the pool is exhausted", () => {
    expect(pickTrackId(["a", "b"], ["a", "b"])).toBeNull();
  });

  it("returns the sole remaining track deterministically", () => {
    expect(pickTrackId(["a", "b", "c"], ["a", "c"])).toBe("b");
  });

  it("clamps the index when rng returns 1", () => {
    // pool = ['a','b','c']; rng()=0.999 → floor(2.997)=2 → 'c'
    // rng()=1.0 (defensive) → clamped
    const rng = () => 1.0;
    expect(pickTrackId(["a", "b", "c"], [], rng)).toBe("c");
  });

  it("walks the whole playlist without repeats, then null (exhaustion)", () => {
    const all = ["a", "b", "c", "d", "e", "f"];
    const heard: string[] = [];
    for (let i = 0; i < all.length; i++) {
      const pick = pickTrackId(all, heard);
      expect(pick).not.toBeNull();
      expect(heard).not.toContain(pick!);
      heard.push(pick!);
    }
    expect(new Set(heard).size).toBe(all.length);
    expect(pickTrackId(all, heard)).toBeNull();
  });
});

describe("buildWheelOrder", () => {
  it("places the winner exactly at winnerIndex", () => {
    const { order, winnerIndex } = buildWheelOrder(
      ["a", "b", "c", "d", "e"],
      "w",
      60,
      Math.random,
    );
    expect(order[winnerIndex]).toBe("w");
    expect(order.length).toBe(60);
  });

  it("keeps winner near the end", () => {
    for (let i = 0; i < 20; i++) {
      const { winnerIndex } = buildWheelOrder(["a", "b"], "w", 60);
      expect(winnerIndex).toBeGreaterThanOrEqual(Math.floor(60 * 0.7));
      expect(winnerIndex).toBeLessThanOrEqual(60 - 5);
    }
  });

  it("still works when the playlist has only the winner", () => {
    const { order, winnerIndex } = buildWheelOrder([], "w", 10);
    expect(order.length).toBe(10);
    expect(order[winnerIndex]).toBe("w");
    expect(order.every((id) => id === "w")).toBe(true);
  });
});
