import { loadState, mutateState, type Tokens } from "./state.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";
const REFRESH_MARGIN_MS = 60_000; // refresh if <60s from expiry

function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("SPOTIFY_CLIENT_ID is not set");
  return id;
}

export function redirectUri(): string {
  const base = process.env.BASE_URL ?? "http://127.0.0.1:3000";
  return `${base.replace(/\/$/, "")}/api/auth/callback`;
}

export async function exchangeCode(code: string, verifier: string): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId(),
    code_verifier: verifier,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`token exchange failed: HTTP ${r.status} ${text}`);
  }
  const j = (await r.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000,
  };
}

async function refresh(existing: Tokens): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: existing.refresh_token,
    client_id: clientId(),
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`token refresh failed: HTTP ${r.status} ${text}`);
  }
  const j = (await r.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    access_token: j.access_token,
    // Spotify sometimes omits a new refresh_token; keep the existing one in that case.
    refresh_token: j.refresh_token ?? existing.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000,
  };
}

export async function getAccessToken(): Promise<string | null> {
  const s = await loadState();
  if (!s.tokens) return null;
  if (s.tokens.expires_at - Date.now() > REFRESH_MARGIN_MS) {
    return s.tokens.access_token;
  }
  const refreshed = await refresh(s.tokens);
  await mutateState((st) => {
    st.tokens = refreshed;
  });
  return refreshed.access_token;
}

export async function isConnected(): Promise<boolean> {
  const s = await loadState();
  return !!s.tokens;
}

export class SpotifyError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

export async function spotifyFetch(
  pathOrUrl: string,
  init: RequestInit = {},
  { retryOn401 = true }: { retryOn401?: boolean } = {},
): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new SpotifyError(401, null, "not connected");
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const r = await fetch(url, { ...init, headers });
  if (r.status === 401 && retryOn401) {
    // Force-refresh by pushing expiry into the past, then retry once.
    await mutateState((st) => {
      if (st.tokens) st.tokens.expires_at = 0;
    });
    return spotifyFetch(pathOrUrl, init, { retryOn401: false });
  }
  return r;
}
