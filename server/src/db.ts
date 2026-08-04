import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Tokens } from "./types.js";

export type PlayerRow = { name: string; heardCount: number };
export type SpinRow = {
  id: number;
  player: string;
  trackId: string;
  trackName: string | null;
  artist: string | null;
  at: string;
  undone: boolean;
};

/** Shape of the legacy Phase-2 JSON state file, imported once if present. */
type LegacyState = {
  tokens: Tokens | null;
  playlistSnapshotId: string | null;
  players: Record<string, { heard: string[] }>;
  spins: { player: string; trackId: string; at: string }[];
};

export class Db {
  private db: DatabaseSync;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "roulette.db");
    const fresh = !existsSync(file);
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS players (
        name     TEXT PRIMARY KEY,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS heard (
        player   TEXT NOT NULL,
        track_id TEXT NOT NULL,
        at       TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (player, track_id)
      );
      CREATE TABLE IF NOT EXISTS spins (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        player     TEXT NOT NULL,
        track_id   TEXT NOT NULL,
        track_name TEXT,
        artist     TEXT,
        at         TEXT NOT NULL,
        undone     INTEGER NOT NULL DEFAULT 0
      );
    `);
    if (fresh) this.importLegacyJson(dir);
    this.seedPlayersFromEnv();
  }

  /** One-time import of the pre-SQLite state.json, then rename it aside. */
  private importLegacyJson(dir: string): void {
    const jsonFile = path.join(dir, "state.json");
    if (!existsSync(jsonFile)) return;
    let legacy: LegacyState;
    try {
      legacy = JSON.parse(readFileSync(jsonFile, "utf8")) as LegacyState;
    } catch {
      return; // unreadable legacy file — start clean, leave it in place
    }
    this.transaction(() => {
      if (legacy.tokens) this.setTokens(legacy.tokens);
      if (legacy.playlistSnapshotId) this.setSnapshotId(legacy.playlistSnapshotId);
      let pos = 0;
      for (const [name, data] of Object.entries(legacy.players ?? {})) {
        this.db
          .prepare("INSERT OR IGNORE INTO players (name, position) VALUES (?, ?)")
          .run(name, pos++);
        for (const trackId of data.heard ?? []) {
          this.db
            .prepare("INSERT OR IGNORE INTO heard (player, track_id) VALUES (?, ?)")
            .run(name, trackId);
        }
      }
      for (const s of legacy.spins ?? []) {
        this.db
          .prepare("INSERT INTO spins (player, track_id, at) VALUES (?, ?, ?)")
          .run(s.player, s.trackId, s.at);
      }
    });
    renameSync(jsonFile, `${jsonFile}.imported`);
  }

  private seedPlayersFromEnv(): void {
    const count = this.db
      .prepare("SELECT COUNT(*) AS n FROM players")
      .get() as { n: number };
    if (count.n > 0) return;
    const raw = (process.env.PLAYERS ?? "Player1,Player2,Player3,Player4").trim();
    const names = raw
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    names.forEach((name, i) => {
      this.db
        .prepare("INSERT OR IGNORE INTO players (name, position) VALUES (?, ?)")
        .run(name, i);
    });
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- meta: tokens & playlist snapshot ----

  getTokens(): Tokens | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'tokens'")
      .get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as Tokens) : null;
  }

  setTokens(tokens: Tokens | null): void {
    if (tokens === null) {
      this.db.prepare("DELETE FROM meta WHERE key = 'tokens'").run();
      return;
    }
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('tokens', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(tokens));
  }

  getSnapshotId(): string | null {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'playlistSnapshotId'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSnapshotId(id: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('playlistSnapshotId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(id);
  }

  // ---- players ----

  listPlayers(): PlayerRow[] {
    return (
      this.db
        .prepare(
          `SELECT p.name AS name, COUNT(h.track_id) AS heardCount
           FROM players p LEFT JOIN heard h ON h.player = p.name
           GROUP BY p.name ORDER BY p.position`,
        )
        .all() as PlayerRow[]
    );
  }

  hasPlayer(name: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM players WHERE name = ?").get(name);
  }

  addPlayer(name: string): void {
    const max = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM players")
      .get() as { m: number };
    this.db
      .prepare("INSERT INTO players (name, position) VALUES (?, ?)")
      .run(name, max.m + 1);
  }

  renamePlayer(from: string, to: string): void {
    this.transaction(() => {
      this.db.prepare("UPDATE players SET name = ? WHERE name = ?").run(to, from);
      this.db.prepare("UPDATE heard SET player = ? WHERE player = ?").run(to, from);
      this.db.prepare("UPDATE spins SET player = ? WHERE player = ?").run(to, from);
    });
  }

  removePlayer(name: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM players WHERE name = ?").run(name);
      this.db.prepare("DELETE FROM heard WHERE player = ?").run(name);
      // spins rows stay — they're the historical log
    });
  }

  // ---- heard / spins ----

  getHeard(player: string): string[] {
    const rows = this.db
      .prepare("SELECT track_id FROM heard WHERE player = ?")
      .all(player) as { track_id: string }[];
    return rows.map((r) => r.track_id);
  }

  recordSpin(
    player: string,
    track: { id: string; name: string; artist: string },
  ): void {
    const at = new Date().toISOString();
    this.transaction(() => {
      this.db
        .prepare("INSERT OR IGNORE INTO heard (player, track_id, at) VALUES (?, ?, ?)")
        .run(player, track.id, at);
      this.db
        .prepare(
          "INSERT INTO spins (player, track_id, track_name, artist, at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(player, track.id, track.name, track.artist, at);
    });
  }

  /** Undo the most recent not-yet-undone spin. Returns it, or null. */
  undoLastSpin(): { player: string; trackId: string; at: string } | null {
    return this.transaction(() => {
      const last = this.db
        .prepare(
          "SELECT id, player, track_id AS trackId, at FROM spins WHERE undone = 0 ORDER BY id DESC LIMIT 1",
        )
        .get() as { id: number; player: string; trackId: string; at: string } | undefined;
      if (!last) return null;
      this.db.prepare("UPDATE spins SET undone = 1 WHERE id = ?").run(last.id);
      this.db
        .prepare("DELETE FROM heard WHERE player = ? AND track_id = ?")
        .run(last.player, last.trackId);
      return { player: last.player, trackId: last.trackId, at: last.at };
    });
  }

  /** Clear heard history. The spins log is preserved (it's the admin trail). */
  resetPlayer(name: string): void {
    this.db.prepare("DELETE FROM heard WHERE player = ?").run(name);
  }

  resetAll(): void {
    this.db.exec("DELETE FROM heard");
  }

  /** Drop heard rows for tracks no longer in the playlist. */
  pruneHeard(validTrackIds: ReadonlySet<string>): void {
    const rows = this.db
      .prepare("SELECT DISTINCT track_id FROM heard")
      .all() as { track_id: string }[];
    const stale = rows.map((r) => r.track_id).filter((id) => !validTrackIds.has(id));
    if (!stale.length) return;
    this.transaction(() => {
      const del = this.db.prepare("DELETE FROM heard WHERE track_id = ?");
      for (const id of stale) del.run(id);
    });
  }

  spinLog(player?: string): SpinRow[] {
    const sql = `SELECT id, player, track_id AS trackId, track_name AS trackName,
                        artist, at, undone
                 FROM spins ${player ? "WHERE player = ?" : ""}
                 ORDER BY id DESC LIMIT 500`;
    const stmt = this.db.prepare(sql);
    const rows = (player ? stmt.all(player) : stmt.all()) as (Omit<SpinRow, "undone"> & {
      undone: number;
    })[];
    return rows.map((r) => ({ ...r, undone: !!r.undone }));
  }

  close(): void {
    this.db.close();
  }
}

let singleton: Db | null = null;

export function getDb(): Db {
  if (!singleton) {
    const dir = process.env.STATE_DIR ?? path.resolve(process.cwd(), "data");
    singleton = new Db(dir);
  }
  return singleton;
}
