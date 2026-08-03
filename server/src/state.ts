import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
};

export type PlayerName = string;

export type State = {
  tokens: Tokens | null;
  playlistSnapshotId: string | null;
  players: Record<PlayerName, { heard: string[] }>;
  spins: { player: PlayerName; trackId: string; at: string }[];
};

const STATE_DIR = process.env.STATE_DIR ?? path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(STATE_DIR, "state.json");

function seedPlayers(): Record<PlayerName, { heard: string[] }> {
  const raw = (process.env.PLAYERS ?? "Player1,Player2,Player3,Player4").trim();
  const names = raw
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return Object.fromEntries(names.map((n) => [n, { heard: [] }]));
}

function emptyState(): State {
  return {
    tokens: null,
    playlistSnapshotId: null,
    players: seedPlayers(),
    spins: [],
  };
}

let cache: State | null = null;

export async function loadState(): Promise<State> {
  if (cache) return cache;
  await fs.mkdir(STATE_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as State;
    // Reconcile players: env is source of truth for the set of players,
    // but preserve heard-history for any name still present.
    const seeded = seedPlayers();
    for (const name of Object.keys(seeded)) {
      if (parsed.players?.[name]) seeded[name] = parsed.players[name];
    }
    parsed.players = seeded;
    cache = parsed;
    return cache;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      cache = emptyState();
      await saveState(cache);
      return cache;
    }
    throw err;
  }
}

export async function saveState(next: State): Promise<void> {
  cache = next;
  await fs.mkdir(STATE_DIR, { recursive: true });
  const tmp = path.join(STATE_DIR, `state.${randomBytes(6).toString("hex")}.tmp`);
  const body = JSON.stringify(next, null, 2);
  await fs.writeFile(tmp, body, { encoding: "utf8" });
  await fs.rename(tmp, STATE_FILE);
}

export async function mutateState<T>(fn: (s: State) => T | Promise<T>): Promise<T> {
  const s = await loadState();
  const result = await fn(s);
  await saveState(s);
  return result;
}

export function stateFilePath(): string {
  return STATE_FILE;
}
