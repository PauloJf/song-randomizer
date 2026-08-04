import { SpotifyError, spotifyFetch } from "./spotify.js";
import { getDb } from "./db.js";

export type Track = {
  id: string;
  name: string;
  artist: string;
  album: string;
  albumArt: string | null;
  durationMs: number;
};

type SpotifyImage = { url: string; width: number | null; height: number | null };
type SpotifyArtist = { name: string };
type SpotifyAlbum = { name: string; images: SpotifyImage[] };
type SpotifyTrack = {
  id: string | null;
  name: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
  duration_ms: number;
};
type PlaylistItem = { track: SpotifyTrack | null };
type PlaylistPage = { items: PlaylistItem[]; next: string | null };
type PlaylistHead = { snapshot_id: string; name: string; tracks: { total: number } };

let cache: { snapshotId: string; tracks: Track[] } | null = null;

function playlistId(): string {
  const id = process.env.PLAYLIST_ID;
  if (!id) throw new Error("PLAYLIST_ID is not set");
  return id;
}

function pickArt(images: SpotifyImage[]): string | null {
  if (!images?.length) return null;
  // Prefer a mid-size image (~300px) for wheel tiles; fall back to biggest.
  const sorted = [...images].sort(
    (a, b) => (b.width ?? 0) - (a.width ?? 0),
  );
  const mid = sorted.find((i) => (i.width ?? 0) >= 200 && (i.width ?? 0) <= 400);
  return (mid ?? sorted[0]).url;
}

function mapTrack(t: SpotifyTrack): Track | null {
  if (!t?.id) return null;
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    album: t.album.name,
    albumArt: pickArt(t.album.images),
    durationMs: t.duration_ms,
  };
}

async function fetchHead(): Promise<PlaylistHead> {
  const r = await spotifyFetch(
    `/playlists/${playlistId()}?fields=snapshot_id,name,tracks.total`,
  );
  if (!r.ok) {
    throw new SpotifyError(r.status, await r.text(), "playlist head fetch failed");
  }
  return (await r.json()) as PlaylistHead;
}

async function fetchAllTracks(): Promise<Track[]> {
  const tracks: Track[] = [];
  const fields =
    "items(track(id,name,artists(name),album(name,images),duration_ms)),next";
  let url = `/playlists/${playlistId()}/tracks?limit=50&fields=${encodeURIComponent(fields)}`;
  // Spotify caps at 50 per page; loop `next` until null.
  while (url) {
    const r = await spotifyFetch(url);
    if (!r.ok) {
      throw new SpotifyError(r.status, await r.text(), "playlist page fetch failed");
    }
    const page = (await r.json()) as PlaylistPage;
    for (const item of page.items) {
      const mapped = item.track && mapTrack(item.track);
      if (mapped) tracks.push(mapped);
    }
    url = page.next ?? "";
  }
  return tracks;
}

/**
 * Return the current playlist, using an in-memory cache keyed by Spotify's
 * `snapshot_id`. On snapshot change, prunes each player's `heard` history to
 * only the track ids that still exist in the playlist.
 */
export async function getPlaylist(): Promise<{
  snapshotId: string;
  tracks: Track[];
}> {
  const head = await fetchHead();
  if (cache && cache.snapshotId === head.snapshot_id) {
    return cache;
  }
  const tracks = await fetchAllTracks();
  cache = { snapshotId: head.snapshot_id, tracks };
  const db = getDb();
  if (db.getSnapshotId() !== head.snapshot_id) {
    db.pruneHeard(new Set(tracks.map((t) => t.id)));
    db.setSnapshotId(head.snapshot_id);
  }
  return cache;
}

export function clearPlaylistCache(): void {
  cache = null;
}
