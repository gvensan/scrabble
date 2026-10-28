import type { IceServer, VoicePeer } from "@scrabble/game-engine/protocol";
import type { RoomData } from "./room-model.js";

/**
 * What the Room keeps on each socket. `voice` is set while that tab is in
 * the voice chat; it lives only on the socket, so nothing about voice is
 * ever written to room storage.
 */
export interface SocketTag {
  playerId: string;
  left?: boolean;
  voice?: { session: string; muted: boolean };
}

/** Free public STUN servers; enough for most home and mobile networks. */
export const STUN_SERVERS: IceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

/** Whether this player may use voice chat in this room right now. */
export function voiceAllowed(room: RoomData, playerId: string): boolean {
  return (
    room.settings.voice === true &&
    room.members.some((member) => member.id === playerId && !member.left)
  );
}

/** Everyone currently in the voice chat, one entry per seated player. */
export function voiceRoster(
  room: RoomData,
  tags: readonly (SocketTag | null)[],
): VoicePeer[] {
  const peers = new Map<string, VoicePeer>();
  for (const tag of tags) {
    if (!tag?.voice || tag.left || !voiceAllowed(room, tag.playerId)) continue;
    peers.set(tag.playerId, {
      playerId: tag.playerId,
      session: tag.voice.session,
      muted: tag.voice.muted,
    });
  }
  return [...peers.values()];
}

let turnCache: { servers: IceServer[]; until: number } | null = null;

/**
 * STUN, plus Cloudflare TURN relays when TURN_KEY_ID and TURN_KEY_API_TOKEN
 * are configured. Relays let players on strict networks connect; without
 * them those players simply cannot hear each other. Credentials last a day
 * and are cached until an hour before they expire.
 */
export async function iceServers(
  env: { TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string },
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<IceServer[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_SERVERS;
  if (turnCache && turnCache.until > now) return turnCache.servers;
  const ttl = 86_400;
  try {
    const response = await fetcher(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl }),
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!response.ok) throw new Error(`TURN ${response.status}`);
    const body = await response.json<{ iceServers?: unknown }>(),
      servers = parseIceServers(body.iceServers);
    if (!servers.length) throw new Error("TURN returned no servers.");
    turnCache = { servers, until: now + (ttl - 3_600) * 1000 };
    return servers;
  } catch {
    // Voice still works for most players over STUN alone.
    return STUN_SERVERS;
  }
}

/** Test hook: forget cached TURN credentials. */
export function resetIceCache() {
  turnCache = null;
}

function parseIceServers(value: unknown): IceServer[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const servers: IceServer[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>,
      raw = Array.isArray(entry.urls) ? entry.urls : [entry.urls],
      // Browsers refuse port 53, so those URLs only slow gathering down.
      urls = raw.filter(
        (url): url is string =>
          typeof url === "string" && !/:53(\?|$)/.test(url),
      );
    if (!urls.length) continue;
    servers.push({
      urls,
      ...(typeof entry.username === "string"
        ? { username: entry.username }
        : {}),
      ...(typeof entry.credential === "string"
        ? { credential: entry.credential }
        : {}),
    });
  }
  return servers;
}
