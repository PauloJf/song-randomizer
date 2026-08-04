import { describe, expect, it } from "vitest";
import { attemptDelay, clearAttempts } from "./ratelimit.js";

describe("attemptDelay", () => {
  it("allows up to 10 attempts, then blocks with a retry delay", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(attemptDelay("k1", t0 + i)).toBe(0);
    }
    expect(attemptDelay("k1", t0 + 100)).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 11; i++) attemptDelay("k2", t0);
    expect(attemptDelay("k2", t0)).toBeGreaterThan(0);
    expect(attemptDelay("k2", t0 + 15 * 60 * 1000 + 1)).toBe(0);
  });

  it("clearAttempts unblocks a key", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 11; i++) attemptDelay("k3", t0);
    expect(attemptDelay("k3", t0)).toBeGreaterThan(0);
    clearAttempts("k3");
    expect(attemptDelay("k3", t0)).toBe(0);
  });

  it("tracks keys independently", () => {
    const t0 = 4_000_000;
    for (let i = 0; i < 11; i++) attemptDelay("k4", t0);
    expect(attemptDelay("k4", t0)).toBeGreaterThan(0);
    expect(attemptDelay("k5", t0)).toBe(0);
  });
});
