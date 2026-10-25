import { DurableObject } from "cloudflare:workers";
import { passTurn } from "@squabble/game-engine";
import {
  clientMessageSchema,
  createRoomSchema,
  joinRoomSchema,
} from "@squabble/game-engine/protocol";
import {
  addMember,
  applyAction,
  createLobby,
  publicRoom,
  type RoomData,
} from "./room-model.js";
import { validateWithWordSoHard } from "./dictionary.js";
interface Env {
  ROOM_DIRECTORY: DurableObjectNamespace<RoomDirectory>;
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_SALT?: string;
}
const enc = new TextEncoder(),
  rng = {
    nextInt(max: number) {
      const a = new Uint32Array(1);
      const ceiling = Math.floor(0x1_0000_0000 / max) * max;
      do crypto.getRandomValues(a);
      while ((a[0] ?? 0) >= ceiling);
      return (a[0] ?? 0) % max;
    },
  };
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json");
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
};
async function hash(token: string) {
  const b = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return btoa(String.fromCharCode(...new Uint8Array(b)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function token() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function withoutPending(room: RoomData): RoomData {
  const copy = { ...room };
  delete copy.pending;
  return copy;
}
async function clientKey(req: Request, env: Env) {
  return hash(
    `${env.RATE_LIMIT_SALT ?? "local-development"}:${req.headers.get("CF-Connecting-IP") ?? "local"}`,
  );
}
function originOk(req: Request, env: Env) {
  const o = req.headers.get("Origin");
  return (
    o === null ||
    (env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",").includes(o)
  );
}
function cors(req: Request, env: Env) {
  const o = req.headers.get("Origin");
  return o && originOk(req, env)
    ? {
        "access-control-allow-origin": o,
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        vary: "Origin",
      }
    : {};
}
async function roomStub(env: Env, code: string) {
  const d = env.ROOM_DIRECTORY.get(env.ROOM_DIRECTORY.idFromName("global")),
    r = await d.fetch(`https://d/resolve/${encodeURIComponent(code)}`);
  if (!r.ok) return null;
  const v = await r.json<{ roomId: string }>();
  return env.ROOMS.get(env.ROOMS.idFromName(v.roomId));
}
export default {
  async fetch(req: Request, env: Env) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors(req, env) });
    if (!originOk(req, env)) return json({ error: "Origin denied." }, 403);
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health")
        return json({ ok: true, protocolVersion: 1 }, 200, cors(req, env));
      if (url.pathname === "/api/rooms" && req.method === "POST") {
        const input = createRoomSchema.parse(await req.json()),
          secret = token(),
          d = env.ROOM_DIRECTORY.get(env.ROOM_DIRECTORY.idFromName("global")),
          r = await d.fetch("https://d/allocate", {
            method: "POST",
            body: JSON.stringify({
              ...input,
              tokenHash: await hash(secret),
              clientKey: await clientKey(req, env),
            }),
          }),
          v = await r.json<Record<string, unknown>>();
        return json(
          r.ok ? { ...v, token: secret } : v,
          r.status,
          cors(req, env),
        );
      }
      const join = /^\/api\/rooms\/([^/]+)\/join$/.exec(url.pathname);
      if (join && req.method === "POST") {
        const directory = env.ROOM_DIRECTORY.get(
          env.ROOM_DIRECTORY.idFromName("global"),
        );
        const admission = await directory.fetch("https://d/admit", {
          method: "POST",
          body: JSON.stringify({ clientKey: await clientKey(req, env) }),
        });
        if (!admission.ok)
          return json(
            { error: "Too many join attempts. Try again shortly." },
            429,
            cors(req, env),
          );
        const input = joinRoomSchema.parse(await req.json()),
          stub = await roomStub(env, join[1] ?? "");
        if (!stub)
          return json({ error: "Room not found." }, 404, cors(req, env));
        const secret = token(),
          r = await stub.fetch("https://r/join", {
            method: "POST",
            body: JSON.stringify({ ...input, tokenHash: await hash(secret) }),
          }),
          v = await r.json<Record<string, unknown>>();
        return json(
          r.ok
            ? {
                ...v,
                roomCode: (join[1] ?? "").toUpperCase(),
                token: secret,
              }
            : v,
          r.status,
          cors(req, env),
        );
      }
      if (
        url.pathname === "/ws" &&
        req.headers.get("Upgrade") === "websocket"
      ) {
        const stub = await roomStub(env, url.searchParams.get("room") ?? "");
        return stub
          ? await stub.fetch(req)
          : new Response("Room not found", { status: 404 });
      }
      return json({ error: "Not found." }, 404, cors(req, env));
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Bad request." },
        400,
        cors(req, env),
      );
    }
  },
} satisfies ExportedHandler<Env>;

export class RoomDirectory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY,room_id TEXT UNIQUE,expires_at INTEGER)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS rate_limits(client_key TEXT,kind TEXT,window_start INTEGER,count INTEGER,PRIMARY KEY(client_key,kind))",
    );
  }
  private checkRate(
    key: string,
    kind: "create" | "join",
    limit: number,
    windowMs: number,
  ) {
    const now = Date.now();
    const row = [
      ...this.ctx.storage.sql.exec<{ window_start: number; count: number }>(
        "SELECT window_start,count FROM rate_limits WHERE client_key=? AND kind=?",
        key,
        kind,
      ),
    ][0];
    if (!row || now - row.window_start >= windowMs) {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO rate_limits VALUES(?,?,?,1)",
        key,
        kind,
        now,
      );
      return;
    }
    if (row.count >= limit) throw new Error("Rate limit exceeded.");
    this.ctx.storage.sql.exec(
      "UPDATE rate_limits SET count=count+1 WHERE client_key=? AND kind=?",
      key,
      kind,
    );
  }
  override async fetch(req: Request) {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/allocate") {
      const input = await req.json<{
        nickname: string;
        tokenHash: string;
        settings: RoomData["settings"];
        clientKey: string;
      }>();
      try {
        this.checkRate(input.clientKey, "create", 10, 60 * 60_000);
      } catch {
        return json({ error: "Too many rooms created. Try again later." }, 429);
      }
      for (let tries = 0; tries < 12; tries++) {
        const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        let code = "";
        for (let i = 0; i < 6; i++)
          code += chars[rng.nextInt(chars.length)] ?? "";
        const roomId = crypto.randomUUID(),
          // Retain the mapping as a tombstone after the room's four-hour life
          // so a recently shared code cannot point at a different game.
          expiry = Date.now() + 28 * 60 * 60_000;
        let claimed = false;
        try {
          this.ctx.storage.sql.exec(
            "INSERT INTO rooms VALUES(?,?,?)",
            code,
            roomId,
            expiry,
          );
          claimed = true;
          const stub = this.env.ROOMS.get(this.env.ROOMS.idFromName(roomId)),
            r = await stub.fetch("https://r/init", {
              method: "POST",
              body: JSON.stringify({ ...input, roomCode: code }),
            });
          if (!r.ok) throw new Error("Initialization failed.");
          await this.ctx.storage.setAlarm(expiry);
          return json(
            { ...(await r.json<Record<string, unknown>>()), roomCode: code },
            201,
          );
        } catch (e) {
          if (claimed)
            this.ctx.storage.sql.exec("DELETE FROM rooms WHERE code=?", code);
          if (tries === 11) throw e;
        }
      }
    }
    if (req.method === "POST" && url.pathname === "/admit") {
      const input = await req.json<{ clientKey: string }>();
      try {
        this.checkRate(input.clientKey, "join", 60, 10 * 60_000);
        return json({ ok: true });
      } catch {
        return json({ error: "Rate limit exceeded." }, 429);
      }
    }
    const m = /^\/resolve\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const row = [
        ...this.ctx.storage.sql.exec<{ room_id: string; expires_at: number }>(
          "SELECT room_id,expires_at FROM rooms WHERE code=?",
          (m[1] ?? "").toUpperCase(),
        ),
      ][0];
      return !row || row.expires_at < Date.now()
        ? json({ error: "Not found." }, 404)
        : json({ roomId: row.room_id });
    }
    return json({ error: "Not found." }, 404);
  }
  override async alarm() {
    this.ctx.storage.sql.exec(
      "DELETE FROM rooms WHERE expires_at<=?",
      Date.now(),
    );
    const next = [
      ...this.ctx.storage.sql.exec<{ expires_at: number }>(
        "SELECT expires_at FROM rooms ORDER BY expires_at LIMIT 1",
      ),
    ][0];
    if (next) await this.ctx.storage.setAlarm(next.expires_at);
  }
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,json TEXT)",
    );
  }
  private load() {
    const row = [
      ...this.ctx.storage.sql.exec<{ json: string }>(
        "SELECT json FROM state WHERE id=1",
      ),
    ][0];
    return row ? (JSON.parse(row.json) as RoomData) : null;
  }
  private save(r: RoomData) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO state VALUES(1,?)",
      JSON.stringify(r),
    );
  }
  private async schedule(r: RoomData) {
    const currentId =
      r.phase === "active" && r.game
        ? r.members[r.game.currentPlayerIndex]?.id
        : undefined;
    const graceId = r.phase === "lobby" ? r.hostId : currentId;
    const currentGrace =
      graceId && !r.members.find((member) => member.id === graceId)?.connected
        ? r.disconnectDeadlines[graceId]
        : undefined;
    const candidates = [
      r.expiresAt,
      r.turnDeadline,
      r.emptyExpiresAt,
      currentGrace,
    ].filter((value): value is number => value !== null && value !== undefined);
    if (candidates.length)
      await this.ctx.storage.setAlarm(
        Math.max(Date.now(), Math.min(...candidates)),
      );
  }
  private send(ws: WebSocket, r: RoomData, id: string) {
    const i = r.members.findIndex((m) => m.id === id),
      p = i < 0 ? undefined : r.game?.players[i];
    ws.send(
      JSON.stringify({
        type: "room.snapshot",
        protocolVersion: 1,
        serverTime: Date.now(),
        room: publicRoom(r),
      }),
    );
    ws.send(
      JSON.stringify({
        type: "seat.private",
        protocolVersion: 1,
        revision: r.revision,
        seat: { playerId: id, rack: p?.rack ?? [] },
      }),
    );
  }
  private broadcast(r: RoomData) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { playerId: string } | null;
      if (a) this.send(ws, r, a.playerId);
    }
  }
  override async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === "/init" && req.method === "POST") {
      if (this.load()) return json({ error: "Exists." }, 409);
      const x = await req.json<{
          roomCode: string;
          nickname: string;
          tokenHash: string;
          settings: RoomData["settings"];
        }>(),
        r = createLobby(
          x.roomCode,
          x.nickname,
          x.tokenHash,
          x.settings,
          Date.now(),
        );
      this.save(r);
      await this.schedule(r);
      return json({ playerId: r.hostId, snapshot: publicRoom(r) }, 201);
    }
    if (url.pathname === "/join" && req.method === "POST") {
      const r = this.load();
      if (!r) return json({ error: "Not found." }, 404);
      try {
        const x = await req.json<{ nickname: string; tokenHash: string }>(),
          j = addMember(r, x.nickname, x.tokenHash);
        this.save(j.room);
        this.broadcast(j.room);
        return json(
          { playerId: j.playerId, snapshot: publicRoom(j.room) },
          201,
        );
      } catch (e) {
        return json(
          { error: e instanceof Error ? e.message : "Join failed." },
          409,
        );
      }
    }
    if (req.headers.get("Upgrade") === "websocket") {
      let r = this.load();
      if (!r) return new Response("Not found", { status: 404 });
      const secret = url.searchParams.get("token"),
        secretHash = secret ? await hash(secret) : null,
        member = secretHash
          ? r.members.find((m) => m.tokenHash === secretHash)
          : undefined;
      if (!member) return new Response("Unauthorized", { status: 401 });
      for (const old of this.ctx.getWebSockets()) {
        const a = old.deserializeAttachment() as { playerId: string } | null;
        if (a?.playerId === member.id) old.close(4001, "Newer tab connected.");
      }
      const pair = new WebSocketPair(),
        client = pair[0],
        server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId: member.id });
      const disconnectDeadlines = Object.fromEntries(
        Object.entries(r.disconnectDeadlines).filter(
          ([playerId]) => playerId !== member.id,
        ),
      );
      r = {
        ...r,
        members: r.members.map((m) =>
          m.id === member.id ? { ...m, connected: true } : m,
        ),
        disconnectDeadlines,
        turnDeadline:
          r.emptyExpiresAt !== null && r.remainingTurnMs !== null
            ? Date.now() + r.remainingTurnMs
            : r.turnDeadline,
        emptyExpiresAt: null,
        remainingTurnMs: null,
      };
      this.save(r);
      await this.schedule(r);
      this.broadcast(r);
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "Not found." }, 404);
  }
  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    try {
      if (typeof data !== "string" || data.length > 16384)
        throw new Error("Invalid message.");
      const msg = clientMessageSchema.parse(JSON.parse(data)),
        a = ws.deserializeAttachment() as { playerId: string } | null;
      let r = this.load();
      if (!a || !r) throw new Error("Session unavailable.");
      if (msg.type === "sync.request") {
        this.send(ws, r, a.playerId);
        return;
      }
      if (msg.type === "room.close") {
        if (r.phase !== "lobby" || r.hostId !== a.playerId)
          throw new Error("Only the host can close the lobby.");
        if (msg.revision !== r.revision)
          throw new Error("State changed; sync and retry.");
        this.ctx.storage.sql.exec("DELETE FROM state");
        for (const peer of this.ctx.getWebSockets()) {
          const attachment = peer.deserializeAttachment() as {
            playerId: string;
            left?: boolean;
          } | null;
          if (attachment)
            peer.serializeAttachment({ ...attachment, left: true });
          peer.close(4000, "Lobby closed by host.");
        }
        return;
      }
      if (msg.type === "room.leave") {
        if (msg.revision !== r.revision)
          throw new Error("State changed; sync and retry.");
        ws.serializeAttachment({ playerId: a.playerId, left: true });
        if (r.phase === "lobby") {
          const members = r.members.filter(
            (member) => member.id !== a.playerId,
          );
          if (!members.length) {
            this.ctx.storage.sql.exec("DELETE FROM state");
          } else {
            r = {
              ...r,
              members,
              hostId:
                r.hostId === a.playerId
                  ? (members[0]?.id ?? r.hostId)
                  : r.hostId,
              revision: r.revision + 1,
            };
            this.save(r);
            await this.schedule(r);
            this.broadcast(r);
          }
        } else {
          const now = Date.now();
          r = {
            ...r,
            members: r.members.map((member) =>
              member.id === a.playerId
                ? { ...member, connected: false }
                : member,
            ),
            disconnectDeadlines: {
              ...r.disconnectDeadlines,
              [a.playerId]: now,
            },
          };
          this.save(r);
          await this.schedule(r);
          this.broadcast(r);
        }
        ws.close(1000, "Left room.");
        return;
      }
      let validity = new Map<string, boolean>();
      if (msg.type === "game.play") {
        let candidates: readonly string[] = [];
        applyAction(r, a.playerId, msg, rng, (words) => {
          candidates = words;
          return new Map(words.map((word) => [word, true]));
        });
        const reserved: RoomData = {
          ...r,
          pending: {
            actionId: msg.actionId,
            actorId: a.playerId,
            revision: r.revision,
          },
        };
        this.save(reserved);
        await this.schedule(reserved);
        ws.send(
          JSON.stringify({ type: "game.pending", actionId: msg.actionId }),
        );
        try {
          validity = new Map(
            (await validateWithWordSoHard(candidates)).validity,
          );
        } catch (error) {
          const latest = this.load();
          if (latest?.pending?.actionId === msg.actionId) {
            this.save(withoutPending(latest));
          }
          throw error;
        }
        const latest = this.load();
        if (
          !latest ||
          latest.pending?.actionId !== msg.actionId ||
          latest.pending.revision !== r.revision
        )
          throw new Error("The turn changed while the word was checked.");
        r = withoutPending(latest);
        // Persist the released reservation before applying validation results;
        // an invalid word must not leave the room permanently locked.
        this.save(r);
      }
      const n = applyAction(
        r,
        a.playerId,
        msg,
        rng,
        (words) =>
          new Map(words.map((word) => [word, validity.get(word) === true])),
      );
      this.save(n);
      await this.schedule(n);
      this.broadcast(n);
    } catch (e) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: e instanceof Error ? e.message : "Action failed.",
        }),
      );
    }
  }
  override async webSocketClose(ws: WebSocket) {
    const a = ws.deserializeAttachment() as {
        playerId: string;
        left?: boolean;
      } | null,
      r = this.load();
    if (!a?.playerId || a.left || !r?.members.some((m) => m.id === a.playerId))
      return;
    const replacementExists = this.ctx
      .getWebSockets()
      .some(
        (other) =>
          other !== ws &&
          (other.deserializeAttachment() as { playerId: string } | null)
            ?.playerId === a.playerId,
      );
    if (replacementExists) return;
    const now = Date.now();
    const members = r.members.map((m) =>
      m.id === a.playerId ? { ...m, connected: false } : m,
    );
    const allOffline = members.every((member) => !member.connected);
    const n = {
      ...r,
      members,
      disconnectDeadlines: {
        ...r.disconnectDeadlines,
        [a.playerId]: now + 3 * 60_000,
      },
      ...(allOffline
        ? {
            remainingTurnMs:
              r.turnDeadline === null
                ? null
                : Math.max(0, r.turnDeadline - now),
            turnDeadline: null,
            emptyExpiresAt: now + 15 * 60_000,
          }
        : {}),
    };
    this.save(n);
    await this.schedule(n);
    this.broadcast(n);
  }
  override async alarm() {
    let r = this.load();
    if (!r) return;
    const now = Date.now();
    if (r.expiresAt <= now && r.phase === "active") {
      r = {
        ...withoutPending(r),
        phase: "results",
        resultReason: "room-time-limit",
        expiresAt: now + 10 * 60_000,
        turnDeadline: null,
      };
      this.save(r);
      this.broadcast(r);
      await this.schedule(r);
      return;
    }
    if (
      r.expiresAt <= now ||
      (r.emptyExpiresAt !== null && r.emptyExpiresAt <= now)
    ) {
      this.ctx.storage.sql.exec("DELETE FROM state");
      for (const ws of this.ctx.getWebSockets()) ws.close(4000, "Expired");
      return;
    }
    if (
      r.phase === "active" &&
      r.game &&
      !r.members.every((member) => !member.connected)
    ) {
      const currentId = r.members[r.game.currentPlayerIndex]?.id;
      const graceExpired = currentId
        ? (r.disconnectDeadlines[currentId] ?? Infinity) <= now
        : false;
      if ((r.turnDeadline ?? Infinity) <= now || graceExpired) {
        let game = passTurn(r.game),
          guard = 0;
        while (game.phase === "active" && guard++ < r.members.length) {
          const index = game.currentPlayerIndex,
            nextId = r.members[index]?.id;
          if (
            !nextId ||
            r.members[index]?.connected ||
            (r.disconnectDeadlines[nextId] ?? Infinity) > now
          )
            break;
          game = passTurn(game);
        }
        r = {
          ...withoutPending(r),
          game,
          phase: game.phase,
          revision: r.revision + 1,
          turnDeadline:
            game.phase === "active" && r.settings.timerSeconds !== 0
              ? now + r.settings.timerSeconds * 1000
              : null,
          expiresAt: game.phase === "results" ? now + 10 * 60_000 : r.expiresAt,
        };
        this.save(r);
        this.broadcast(r);
      }
    }
    if (
      r.phase === "lobby" &&
      (r.disconnectDeadlines[r.hostId] ?? Infinity) <= now
    ) {
      const nextHost = r.members.find((member) => member.connected);
      if (nextHost) {
        r = { ...r, hostId: nextHost.id, revision: r.revision + 1 };
        this.save(r);
        this.broadcast(r);
      }
    }
    await this.schedule(r);
  }
}
