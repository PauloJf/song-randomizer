export type Track = {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  durationMs: number;
};

export type PlayerSummary = {
  name: string;
  heard: number;
  remaining: number | null;
};

export type SpinResult = {
  track: Track;
  wheelOrder: string[];
  winnerIndex: number;
};

export type AuthStatus = { connected: boolean };

export type ApiError = { error: string; reason?: string; detail?: string };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let body: ApiError | null = null;
    try {
      body = (await r.json()) as ApiError;
    } catch {
      /* non-JSON error body */
    }
    const msg = body?.error ?? `HTTP ${r.status}`;
    const err = new Error(msg) as Error & { status: number; body?: ApiError };
    err.status = r.status;
    err.body = body ?? undefined;
    throw err;
  }
  return (await r.json()) as T;
}

export const api = {
  authStatus: () => json<AuthStatus>("/api/auth/status"),
  players: () =>
    json<{ total: number | null; players: PlayerSummary[] }>("/api/players"),
  playlist: () =>
    json<{ snapshotId: string; tracks: Track[] }>("/api/playlist"),
  spin: (player: string) =>
    json<SpinResult>("/api/spin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player }),
    }),
  undo: () =>
    json<{ undone: { player: string; trackId: string; at: string } }>(
      "/api/spin/undo",
      { method: "POST" },
    ),
  reset: (player?: string) =>
    json<{ reset: string }>("/api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(player ? { player } : {}),
    }),
  play: (trackId: string) =>
    json<{ ok: true }>("/api/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId }),
    }),
};

export type AdminPlayer = { name: string; heardCount: number };
export type AdminSpin = {
  id: number;
  player: string;
  trackId: string;
  trackName: string | null;
  artist: string | null;
  at: string;
  undone: boolean;
};

function post<T>(url: string, body?: unknown): Promise<T> {
  return json<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export const appAuth = {
  status: () => json<{ locked: boolean; authed: boolean }>("/api/app/status"),
  login: (password: string) =>
    json<{ authed: true }>("/api/app/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
};

export const adminApi = {
  status: () => json<{ enabled: boolean; admin: boolean }>("/api/admin/status"),
  login: (password: string) => post<{ admin: true }>("/api/admin/login", { password }),
  logout: () => post<{ admin: false }>("/api/admin/logout"),
  players: () => json<{ players: AdminPlayer[] }>("/api/admin/players"),
  addPlayer: (name: string) =>
    post<{ players: AdminPlayer[] }>("/api/admin/players", { name }),
  renamePlayer: (from: string, to: string) =>
    post<{ players: AdminPlayer[] }>("/api/admin/players/rename", { from, to }),
  removePlayer: (name: string) =>
    json<{ players: AdminPlayer[] }>(
      `/api/admin/players/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  reset: (player?: string) =>
    post<{ reset: string; players: AdminPlayer[] }>(
      "/api/admin/reset",
      player ? { player } : {},
    ),
  spins: (player?: string) =>
    json<{ spins: AdminSpin[] }>(
      `/api/admin/spins${player ? `?player=${encodeURIComponent(player)}` : ""}`,
    ),
};
