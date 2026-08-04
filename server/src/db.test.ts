import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Db } from "./db.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "roulette-db-"));
  process.env.PLAYERS = "Alice,Bob";
});

afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("fresh database", () => {
  it("seeds players from PLAYERS env once", () => {
    db = new Db(dir);
    expect(db.listPlayers().map((p) => p.name)).toEqual(["Alice", "Bob"]);
    db.close();
    // Re-open with a different env: seed must NOT re-run.
    process.env.PLAYERS = "Zoe";
    db = new Db(dir);
    expect(db.listPlayers().map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("stores and retrieves tokens", () => {
    db = new Db(dir);
    expect(db.getTokens()).toBeNull();
    const t = { access_token: "a", refresh_token: "r", expires_at: 123 };
    db.setTokens(t);
    expect(db.getTokens()).toEqual(t);
    db.setTokens(null);
    expect(db.getTokens()).toBeNull();
  });
});

describe("legacy state.json import", () => {
  it("imports tokens, players, heard, and spins, then renames the file", () => {
    const legacy = {
      tokens: { access_token: "a", refresh_token: "r", expires_at: 99 },
      playlistSnapshotId: "snap1",
      players: {
        Carol: { heard: ["t1", "t2"] },
        Dave: { heard: [] },
      },
      spins: [
        { player: "Carol", trackId: "t1", at: "2026-08-01T00:00:00Z" },
        { player: "Carol", trackId: "t2", at: "2026-08-02T00:00:00Z" },
      ],
    };
    writeFileSync(path.join(dir, "state.json"), JSON.stringify(legacy));
    db = new Db(dir);
    expect(db.getTokens()?.access_token).toBe("a");
    expect(db.getSnapshotId()).toBe("snap1");
    expect(db.listPlayers()).toEqual([
      { name: "Carol", heardCount: 2 },
      { name: "Dave", heardCount: 0 },
    ]);
    expect(db.spinLog("Carol")).toHaveLength(2);
    expect(existsSync(path.join(dir, "state.json"))).toBe(false);
    expect(existsSync(path.join(dir, "state.json.imported"))).toBe(true);
  });
});

describe("spin lifecycle", () => {
  beforeEach(() => {
    db = new Db(dir);
  });

  it("recordSpin adds to heard and the log", () => {
    db.recordSpin("Alice", { id: "t1", name: "Song", artist: "Artist" });
    expect(db.getHeard("Alice")).toEqual(["t1"]);
    const log = db.spinLog("Alice");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      player: "Alice",
      trackId: "t1",
      trackName: "Song",
      artist: "Artist",
      undone: false,
    });
  });

  it("undoLastSpin removes heard and marks the log entry undone", () => {
    db.recordSpin("Alice", { id: "t1", name: "S1", artist: "A" });
    db.recordSpin("Bob", { id: "t2", name: "S2", artist: "A" });
    const undone = db.undoLastSpin();
    expect(undone).toMatchObject({ player: "Bob", trackId: "t2" });
    expect(db.getHeard("Bob")).toEqual([]);
    expect(db.getHeard("Alice")).toEqual(["t1"]);
    // The log keeps the undone row, flagged.
    expect(db.spinLog("Bob")[0].undone).toBe(true);
    // A second undo pops Alice's spin, not Bob's again.
    expect(db.undoLastSpin()).toMatchObject({ player: "Alice", trackId: "t1" });
    expect(db.undoLastSpin()).toBeNull();
  });

  it("undoSpin undoes a specific row, not just the last", () => {
    db.recordSpin("Alice", { id: "t1", name: "S1", artist: "A" });
    db.recordSpin("Alice", { id: "t2", name: "S2", artist: "A" });
    const first = db.spinLog("Alice").find((s) => s.trackId === "t1")!;
    expect(db.undoSpin(first.id)).toMatchObject({ player: "Alice", trackId: "t1" });
    expect(db.getHeard("Alice")).toEqual(["t2"]);
    // Undoing the same row again is a no-op.
    expect(db.undoSpin(first.id)).toBeNull();
  });

  it("stats aggregates exclude undone spins", () => {
    db.recordSpin("Alice", { id: "t1", name: "S1", artist: "Artist X" });
    db.recordSpin("Alice", { id: "t2", name: "S2", artist: "Artist X" });
    db.recordSpin("Bob", { id: "t3", name: "S3", artist: "Artist Y" });
    db.undoLastSpin(); // removes Bob's
    const s = db.stats();
    expect(s.totalSpins).toBe(2);
    expect(s.perPlayer).toEqual([{ player: "Alice", spins: 2 }]);
    expect(s.topArtists).toEqual([{ artist: "Artist X", count: 2 }]);
  });

  it("reset clears heard but preserves the spin log", () => {
    db.recordSpin("Alice", { id: "t1", name: "S1", artist: "A" });
    db.recordSpin("Alice", { id: "t2", name: "S2", artist: "A" });
    db.resetPlayer("Alice");
    expect(db.getHeard("Alice")).toEqual([]);
    expect(db.spinLog("Alice")).toHaveLength(2);
  });

  it("pruneHeard drops only tracks missing from the playlist", () => {
    db.recordSpin("Alice", { id: "t1", name: "S1", artist: "A" });
    db.recordSpin("Alice", { id: "gone", name: "S2", artist: "A" });
    db.pruneHeard(new Set(["t1", "t3"]));
    expect(db.getHeard("Alice")).toEqual(["t1"]);
  });
});

describe("player management", () => {
  beforeEach(() => {
    db = new Db(dir);
  });

  it("add, rename, remove", () => {
    db.addPlayer("Carol");
    expect(db.listPlayers().map((p) => p.name)).toEqual(["Alice", "Bob", "Carol"]);

    db.recordSpin("Carol", { id: "t1", name: "S", artist: "A" });
    db.renamePlayer("Carol", "Caroline");
    expect(db.hasPlayer("Carol")).toBe(false);
    expect(db.getHeard("Caroline")).toEqual(["t1"]);
    expect(db.spinLog("Caroline")).toHaveLength(1);

    db.removePlayer("Caroline");
    expect(db.hasPlayer("Caroline")).toBe(false);
    // Historical log survives removal.
    expect(db.spinLog("Caroline")).toHaveLength(1);
  });
});
