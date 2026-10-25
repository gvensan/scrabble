import { DurableObject } from "cloudflare:workers";
import { passTurn } from "@scrabble/game-engine";
import {
  CLOSE_ROOM_GONE,
  CLOSE_SEAT_REJECTED,
  clientMessageSchema,
  createRoomSchema,
  joinRoomSchema,
  SOCKET_PROTOCOL,
  SOCKET_TOKEN_PREFIX,
  type RoomStatus,
} from "@scrabble/game-engine/protocol";
import {
  addMember,
  applyAction,
  createLobby,
  leaveRoom,
  markDisconnected,
  publicRoom,
  recordRematch,
  roomStatus,
  withoutPending,
  type RoomData,
} from "./room-model.js";
import { validateWithWordSoHard } from "./dictionary.js";
import {
  activityFromLive,
  adminGame,
  adminRoom,
  roomLive,
  type AdminLiveSnapshot,
  GAME_HISTORY_MS,
  ROOM_HISTORY_MS,
  roomReport,
  utcDay,
  winners,
  type ActivityRow,
  type GameRow,
  type Metric,
  type RoomReport,
} from "./admin.js";
import type {
  AdminRoomDetail,
  AdminLeader,
  AdminOverview,
  AdminPlayer,
} from "@scrabble/game-engine/protocol";
interface Env {
  ROOM_DIRECTORY: DurableObjectNamespace<RoomDirectory>;
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_SALT?: string;
  /** Bearer token for /api/admin/*; admin is disabled when unset. */
  ADMIN_TOKEN?: string;
  /** Rooms one network may create per hour (default 10). */
  ROOM_CREATE_LIMIT?: string;
}
const JOIN_LIMIT = 60,
  PEEK_LIMIT = 300,
  JOIN_WINDOW_MS = 10 * 60_000,
  CREATE_WINDOW_MS = 60 * 60_000,
  ADMIN_FAILURE_LIMIT = 10;
function createLimit(env: Env) {
  const limit = Number(env.ROOM_CREATE_LIMIT);
  return Number.isInteger(limit) && limit > 0 ? limit : 10;
}
function directory(env: Env) {
  return env.ROOM_DIRECTORY.get(env.ROOM_DIRECTORY.idFromName("global"));
}
/** Compares digests so the check takes the same time for any guess. */
async function adminAuthorized(req: Request, env: Env) {
  const header = req.headers.get("Authorization") ?? "",
    supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.ADMIN_TOKEN || !supplied) return false;
  const x = new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(supplied)),
    ),
    y = new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(env.ADMIN_TOKEN)),
    );
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
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
const socketHeaders = { "Sec-WebSocket-Protocol": SOCKET_PROTOCOL };
/**
 * Browsers hide HTTP status codes from WebSocket clients, so a refused
 * connection is accepted and closed with a code the client can act on.
 */
function refuseSocket(code: number, reason: string) {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].close(code, reason);
  return new Response(null, {
    status: 101,
    webSocket: pair[0],
    headers: socketHeaders,
  });
}
function socketToken(req: Request) {
  return (
    (req.headers.get("Sec-WebSocket-Protocol") ?? "")
      .split(",")
      .map((value) => value.trim())
      .find((value) => value.startsWith(SOCKET_TOKEN_PREFIX))
      ?.slice(SOCKET_TOKEN_PREFIX.length) ?? null
  );
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
        "access-control-allow-headers": "content-type,authorization",
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        vary: "Origin",
      }
    : {};
}
async function roomStub(env: Env, code: string) {
  const r = await directory(env).fetch(
    `https://d/resolve/${encodeURIComponent(code)}`,
  );
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
      if (url.pathname.startsWith("/api/admin/")) {
        if (!env.ADMIN_TOKEN)
          return json(
            {
              error:
                "Admin access is not configured. Set ADMIN_TOKEN for the Worker.",
            },
            503,
            cors(req, env),
          );
        const roomPath = /^\/api\/admin\/rooms\/([A-Za-z0-9]{6})$/.exec(
            url.pathname,
          ),
          action =
            url.pathname === "/api/admin/overview" && req.method === "GET"
              ? "overview"
              : url.pathname === "/api/admin/rate-limits/reset" &&
                  req.method === "POST"
                ? "reset-limits"
                : roomPath && req.method === "GET"
                  ? "room"
                  : roomPath && req.method === "DELETE"
                    ? "delete-room"
                    : null;
        if (!action) return json({ error: "Not found." }, 404, cors(req, env));
        const r = await directory(env).fetch("https://d/admin", {
          method: "POST",
          body: JSON.stringify({
            action,
            roomCode: roomPath?.[1]?.toUpperCase(),
            clientKey: await clientKey(req, env),
            authorized: await adminAuthorized(req, env),
          }),
        });
        return json(await r.json(), r.status, cors(req, env));
      }
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
      const peek = /^\/api\/rooms\/([A-Za-z0-9]{6})$/.exec(url.pathname);
      if (peek && req.method === "GET") {
        const admission = await directory(env).fetch("https://d/admit", {
          method: "POST",
          body: JSON.stringify({
            clientKey: await clientKey(req, env),
            kind: "peek",
          }),
        });
        if (!admission.ok)
          return json(
            { error: "Too many checks. Try again shortly." },
            429,
            cors(req, env),
          );
        const stub = await roomStub(env, peek[1] ?? ""),
          r = stub ? await stub.fetch("https://r/status") : null;
        return r?.ok
          ? json(await r.json(), 200, cors(req, env))
          : json(
              { joinable: false, reason: "missing" } satisfies RoomStatus,
              404,
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
          : refuseSocket(CLOSE_ROOM_GONE, "This room has expired or closed.");
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
    // Admin history: one row per room, one per finished game, daily counters.
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS room_activity(room_id TEXT PRIMARY KEY,code TEXT,phase TEXT,revision INTEGER,settings_json TEXT,players_json TEXT,locked INTEGER,turn_number INTEGER,bag_remaining INTEGER,created_at INTEGER,started_at INTEGER,ended_at INTEGER,closed_at INTEGER,close_reason TEXT,end_reason TEXT,updated_at INTEGER,best_word TEXT,best_score INTEGER,best_by TEXT,plays INTEGER)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS games(room_id TEXT PRIMARY KEY,code TEXT,started_at INTEGER,ended_at INTEGER,board_size INTEGER,timer_seconds INTEGER,players_json TEXT,winners_json TEXT,winning_score INTEGER,end_reason TEXT,turns INTEGER,plays INTEGER,best_word TEXT,best_score INTEGER,best_by TEXT)",
    );
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS games_ended ON games(ended_at)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS daily_metrics(day TEXT,metric TEXT,count INTEGER,PRIMARY KEY(day,metric))",
    );
    // Rooms an admin deleted; late reports from them are dropped.
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS deleted_rooms(room_id TEXT PRIMARY KEY,deleted_at INTEGER)",
    );
  }
  /** Finds a room by code: the newest dashboard row, else the code mapping. */
  private findRoom(code: string) {
    const row = [
      ...this.ctx.storage.sql.exec<ActivityRow>(
        "SELECT * FROM room_activity WHERE code=? ORDER BY created_at DESC LIMIT 1",
        code,
      ),
    ][0];
    if (row) return { row, id: this.env.ROOMS.idFromString(row.room_id) };
    const mapped = [
      ...this.ctx.storage.sql.exec<{ room_id: string }>(
        "SELECT room_id FROM rooms WHERE code=?",
        code,
      ),
    ][0];
    return mapped
      ? { row: null, id: this.env.ROOMS.idFromName(mapped.room_id) }
      : null;
  }
  private bump(metric: Metric, by = 1, now = Date.now()) {
    if (by > 0)
      this.ctx.storage.sql.exec(
        "INSERT INTO daily_metrics VALUES(?,?,?) ON CONFLICT(day,metric) DO UPDATE SET count=count+excluded.count",
        utcDay(now),
        metric,
        by,
      );
  }
  private activity(roomId: string) {
    return [
      ...this.ctx.storage.sql.exec<ActivityRow>(
        "SELECT * FROM room_activity WHERE room_id=?",
        roomId,
      ),
    ][0];
  }
  private recordGame(row: ActivityRow, endedAt: number, endReason: string) {
    const players = JSON.parse(row.players_json) as AdminPlayer[],
      settings = JSON.parse(row.settings_json) as RoomData["settings"],
      won = winners(players);
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO games VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      row.room_id,
      row.code,
      row.started_at ?? row.created_at,
      endedAt,
      settings.boardSize,
      settings.timerSeconds,
      row.players_json,
      JSON.stringify(won),
      Math.max(...players.map((player) => player.score)),
      endReason,
      row.turn_number,
      row.plays,
      row.best_word,
      row.best_score,
      row.best_by,
    );
  }
  private applyReport(report: RoomReport, now = Date.now()) {
    if (
      [
        ...this.ctx.storage.sql.exec(
          "SELECT 1 FROM deleted_rooms WHERE room_id=?",
          report.roomId,
        ),
      ].length
    )
      return;
    const row = this.activity(report.roomId);
    if (report.kind === "closed") {
      if (row?.closed_at !== null) return;
      if (row.started_at !== null && row.ended_at === null) {
        this.recordGame(row, now, "abandoned");
        this.bump("games_finished", 1, now);
      }
      this.ctx.storage.sql.exec(
        "UPDATE room_activity SET closed_at=?,close_reason=?,ended_at=COALESCE(ended_at,CASE WHEN started_at IS NULL THEN NULL ELSE ? END),updated_at=? WHERE room_id=?",
        now,
        report.reason,
        now,
        now,
        report.roomId,
      );
      return;
    }
    // Reports can arrive out of order; never let an older one win.
    if (row && (row.closed_at !== null || report.revision < row.revision))
      return;
    const newPlay =
      report.lastPlay !== null && report.turnNumber > (row?.turn_number ?? 0);
    const better =
      report.lastPlay !== null &&
      report.lastPlay.score > (row?.best_score ?? -1);
    const next: ActivityRow = {
      room_id: report.roomId,
      code: report.roomCode,
      phase: report.phase,
      revision: report.revision,
      settings_json: JSON.stringify(report.settings),
      players_json: JSON.stringify(report.players),
      locked: report.locked ? 1 : 0,
      turn_number: report.turnNumber,
      bag_remaining: report.bagRemaining,
      created_at: report.createdAt,
      started_at: row?.started_at ?? (report.phase === "lobby" ? null : now),
      ended_at: row?.ended_at ?? (report.phase === "results" ? now : null),
      closed_at: null,
      close_reason: null,
      end_reason: report.endReason,
      updated_at: now,
      best_word: better
        ? (report.lastPlay?.word ?? null)
        : (row?.best_word ?? null),
      best_score: better
        ? (report.lastPlay?.score ?? null)
        : (row?.best_score ?? null),
      best_by: better
        ? (report.lastPlay?.nickname ?? null)
        : (row?.best_by ?? null),
      plays: (row?.plays ?? 0) + (newPlay ? 1 : 0),
    };
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO room_activity(room_id,code,phase,revision,settings_json,players_json,locked,turn_number,bag_remaining,created_at,started_at,ended_at,closed_at,close_reason,end_reason,updated_at,best_word,best_score,best_by,plays) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      next.room_id,
      next.code,
      next.phase,
      next.revision,
      next.settings_json,
      next.players_json,
      next.locked,
      next.turn_number,
      next.bag_remaining,
      next.created_at,
      next.started_at,
      next.ended_at,
      next.closed_at,
      next.close_reason,
      next.end_reason,
      next.updated_at,
      next.best_word,
      next.best_score,
      next.best_by,
      next.plays,
    );
    const previousPlayers = row
      ? (JSON.parse(row.players_json) as AdminPlayer[]).length
      : 1;
    this.bump("players_joined", report.players.length - previousPlayers, now);
    if (newPlay) this.bump("plays", 1, now);
    if (!row?.started_at && next.started_at !== null)
      this.bump("games_started", 1, now);
    if (!row?.ended_at && next.ended_at !== null) {
      this.recordGame(next, next.ended_at, report.endReason ?? "finished");
      this.bump("games_finished", 1, now);
    }
  }
  private prune(now = Date.now()) {
    this.ctx.storage.sql.exec(
      "DELETE FROM room_activity WHERE closed_at IS NOT NULL AND closed_at<?",
      now - ROOM_HISTORY_MS,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM games WHERE ended_at<?",
      now - GAME_HISTORY_MS,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM deleted_rooms WHERE deleted_at<?",
      now - 24 * 60 * 60_000,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM daily_metrics WHERE day<?",
      utcDay(now - GAME_HISTORY_MS),
    );
  }
  private overview(now = Date.now()): AdminOverview {
    this.prune(now);
    const rooms = [
        ...this.ctx.storage.sql.exec<ActivityRow>(
          "SELECT * FROM room_activity WHERE closed_at IS NULL OR closed_at>? ORDER BY updated_at DESC LIMIT 300",
          now - 24 * 60 * 60_000,
        ),
      ].map(adminRoom),
      games = [
        ...this.ctx.storage.sql.exec<GameRow>(
          "SELECT * FROM games ORDER BY ended_at DESC",
        ),
      ].map(adminGame),
      today = utcDay(now),
      days = new Map<string, Record<string, number>>();
    for (let i = 13; i >= 0; i -= 1)
      days.set(utcDay(now - i * 24 * 60 * 60_000), {});
    for (const row of this.ctx.storage.sql.exec<{
      day: string;
      metric: string;
      count: number;
    }>(
      "SELECT day,metric,count FROM daily_metrics WHERE day>=?",
      [...days.keys()][0] ?? today,
    )) {
      const day = days.get(row.day);
      if (day) day[row.metric] = row.count;
    }
    const leaders = new Map<string, AdminLeader>();
    let highest: AdminOverview["totals"]["highestScore"] = null,
      bestPlay: AdminOverview["totals"]["bestPlay"] = null;
    for (const game of games) {
      if (
        game.bestPlay &&
        (bestPlay === null || game.bestPlay.score > bestPlay.score)
      )
        bestPlay = { ...game.bestPlay, roomCode: game.roomCode };
      for (const player of game.players) {
        const key = player.nickname.toLocaleLowerCase(),
          leader = leaders.get(key) ?? {
            nickname: player.nickname,
            games: 0,
            wins: 0,
            bestScore: player.score,
            totalScore: 0,
          };
        leader.games += 1;
        leader.totalScore += player.score;
        leader.bestScore = Math.max(leader.bestScore, player.score);
        if (game.winners.includes(player.nickname)) leader.wins += 1;
        leaders.set(key, leader);
        if (highest === null || player.score > highest.score)
          highest = {
            nickname: player.nickname,
            score: player.score,
            roomCode: game.roomCode,
          };
      }
    }
    const live = rooms.filter((room) => room.status !== "closed"),
      finished = games.filter((game) => game.endReason !== "abandoned"),
      average = (values: number[]) =>
        values.length
          ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
          : null,
      limits = { create: createLimit(this.env), join: JOIN_LIMIT };
    return {
      generatedAt: now,
      limits: { roomsPerHour: limits.create, joinsPer10Min: limits.join },
      totals: {
        lobbies: live.filter((room) => room.status === "lobby").length,
        activeGames: live.filter((room) => room.status === "active").length,
        playersOnline: live.reduce(
          (sum, room) =>
            sum + room.players.filter((player) => player.connected).length,
          0,
        ),
        roomsToday: days.get(today)?.rooms_created ?? 0,
        gamesToday: games.filter((game) => utcDay(game.endedAt) === today)
          .length,
        gamesRecorded: games.length,
        averageDurationMs: average(
          finished.map((game) => game.endedAt - game.startedAt),
        ),
        averageWinningScore: average(finished.map((game) => game.winningScore)),
        highestScore: highest,
        bestPlay,
      },
      rooms,
      games: games.slice(0, 500),
      daily: [...days].map(([day, metrics]) => ({ day, metrics })),
      leaders: [...leaders.values()]
        .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore)
        .slice(0, 20),
      rateLimited: [
        ...this.ctx.storage.sql.exec<{
          kind: string;
          count: number;
          window_start: number;
        }>(
          "SELECT kind,count,window_start FROM rate_limits WHERE (kind='create' AND count>=? AND window_start>?) OR (kind='join' AND count>=? AND window_start>?)",
          limits.create,
          now - CREATE_WINDOW_MS,
          limits.join,
          now - JOIN_WINDOW_MS,
        ),
      ].map((row) => ({
        kind: row.kind,
        count: row.count,
        resetsAt:
          row.window_start +
          (row.kind === "create" ? CREATE_WINDOW_MS : JOIN_WINDOW_MS),
      })),
    };
  }
  /** Counts one attempt (unless consume is false); returns ms until allowed, 0 if allowed now. */
  private checkRate(
    key: string,
    kind: "create" | "join" | "peek" | "admin-fail",
    limit: number,
    windowMs: number,
    consume = true,
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
      if (consume)
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO rate_limits VALUES(?,?,?,1)",
          key,
          kind,
          now,
        );
      return 0;
    }
    if (row.count >= limit) return row.window_start + windowMs - now;
    if (consume)
      this.ctx.storage.sql.exec(
        "UPDATE rate_limits SET count=count+1 WHERE client_key=? AND kind=?",
        key,
        kind,
      );
    return 0;
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
      const limit = createLimit(this.env),
        wait = this.checkRate(
          input.clientKey,
          "create",
          limit,
          CREATE_WINDOW_MS,
        );
      if (wait > 0) {
        this.bump("rate_limited");
        const minutes = Math.max(1, Math.ceil(wait / 60_000));
        return json(
          {
            error: `This network has created ${limit} rooms in the last hour, the most allowed. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
          },
          429,
          { "retry-after": String(Math.ceil(wait / 1000)) },
        );
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
          this.bump("rooms_created");
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
      const input = await req.json<{
        clientKey: string;
        kind?: "join" | "peek";
      }>();
      // Status checks poll while a room is locked, so they get their own,
      // larger allowance instead of using up join attempts.
      const peek = input.kind === "peek";
      if (
        this.checkRate(
          input.clientKey,
          peek ? "peek" : "join",
          peek ? PEEK_LIMIT : JOIN_LIMIT,
          JOIN_WINDOW_MS,
        ) > 0
      ) {
        this.bump("rate_limited");
        return json({ error: "Rate limit exceeded." }, 429);
      }
      return json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/report") {
      this.applyReport(await req.json<RoomReport>());
      return json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/event") {
      this.bump((await req.json<{ metric: Metric }>()).metric);
      return json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/admin") {
      const input = await req.json<{
        action: "overview" | "reset-limits" | "room" | "delete-room";
        roomCode?: string;
        clientKey: string;
        authorized: boolean;
      }>();
      // Wrong tokens are counted per network; after ten the network waits.
      const wait = this.checkRate(
        input.clientKey,
        "admin-fail",
        ADMIN_FAILURE_LIMIT,
        JOIN_WINDOW_MS,
        !input.authorized,
      );
      if (wait > 0)
        return json(
          { error: "Too many failed admin attempts. Try again later." },
          429,
        );
      if (!input.authorized)
        return json({ error: "That admin token is not valid." }, 401);
      if (input.action === "reset-limits") {
        const cleared = [
          ...this.ctx.storage.sql.exec<{ n: number }>(
            "SELECT COUNT(*) AS n FROM rate_limits WHERE kind IN ('create','join')",
          ),
        ][0]?.n;
        this.ctx.storage.sql.exec(
          "DELETE FROM rate_limits WHERE kind IN ('create','join')",
        );
        return json({ cleared: cleared ?? 0 });
      }
      if (input.action === "room" || input.action === "delete-room") {
        const target = this.findRoom(input.roomCode ?? "");
        if (!target) return json({ error: "Room not found." }, 404);
        const stub = this.env.ROOMS.get(target.id);
        if (input.action === "room") {
          const live = await stub.fetch("https://r/admin/view");
          if (!target.row && !live.ok)
            return json({ error: "Room not found." }, 404);
          const detail: AdminRoomDetail = {
            room: target.row
              ? adminRoom(target.row)
              : adminRoom(
                  activityFromLive(
                    await live.clone().json<AdminLiveSnapshot>(),
                  ),
                ),
            live: live.ok ? (await live.json<AdminLiveSnapshot>()).live : null,
          };
          return json(detail);
        }
        // Deleting closes every socket and wipes the room's storage. The room
        // leaves no history behind; the code mapping stays as a tombstone so
        // the code cannot be handed to a different game.
        await stub.fetch("https://r/admin/delete", { method: "POST" });
        const key = target.id.toString();
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO deleted_rooms VALUES(?,?)",
          key,
          Date.now(),
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM room_activity WHERE room_id=?",
          key,
        );
        return json({ deleted: input.roomCode });
      }
      return json(this.overview());
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
    this.prune();
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
    this.tell("report", roomReport(this.ctx.id.toString(), r));
  }
  private remove(reason: "emptied" | "expired" | "abandoned") {
    this.ctx.storage.sql.exec("DELETE FROM state");
    this.tell("report", {
      kind: "closed",
      roomId: this.ctx.id.toString(),
      reason,
    } satisfies RoomReport);
  }
  /** Admin bookkeeping is best effort and never delays or fails a move. */
  private tell(path: "report" | "event", body: unknown) {
    this.ctx.waitUntil(
      directory(this.env)
        .fetch(`https://d/${path}`, {
          method: "POST",
          body: JSON.stringify(body),
        })
        .then(
          () => undefined,
          () => undefined,
        ),
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
    // A socket that was just closed (a replaced tab, a dropped connection)
    // stays in getWebSockets() until its close completes; sending to it
    // throws, which must not fail the request that triggered the broadcast.
    try {
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
    } catch {
      // The socket is closing; its webSocketClose handler tidies up.
    }
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
    if (url.pathname === "/status") {
      const r = this.load();
      if (!r) return json({ error: "Not found." }, 404);
      return json(roomStatus(r));
    }
    if (url.pathname === "/admin/view") {
      const r = this.load();
      if (!r) return json({ error: "Not found." }, 404);
      const snapshot: AdminLiveSnapshot = {
        report: roomReport(this.ctx.id.toString(), r),
        live: roomLive(r, this.ctx.getWebSockets().length),
      };
      return json(snapshot);
    }
    if (url.pathname === "/admin/delete" && req.method === "POST") {
      for (const ws of this.ctx.getWebSockets())
        ws.close(CLOSE_ROOM_GONE, "An admin closed this room.");
      await this.ctx.storage.deleteAlarm();
      this.ctx.storage.sql.exec("DELETE FROM state");
      return json({ ok: true });
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
      if (!r)
        return refuseSocket(
          CLOSE_ROOM_GONE,
          "This room has expired or closed.",
        );
      const secret = socketToken(req),
        secretHash = secret ? await hash(secret) : null,
        member = secretHash
          ? r.members.find((m) => m.tokenHash === secretHash)
          : undefined;
      if (!member)
        return refuseSocket(
          CLOSE_SEAT_REJECTED,
          "This browser no longer holds a seat in the room.",
        );
      if (member.left)
        return refuseSocket(CLOSE_SEAT_REJECTED, "You left this game.");
      for (const old of this.ctx.getWebSockets()) {
        const a = old.deserializeAttachment() as { playerId: string } | null;
        if (a?.playerId === member.id) {
          // Detach it first so later broadcasts skip it.
          old.serializeAttachment(null);
          try {
            old.close(4001, "Newer tab connected.");
          } catch {
            // Already closed.
          }
        }
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
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: socketHeaders,
      });
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
      if (msg.type === "room.rematch") {
        r = recordRematch(r, a.playerId, msg.roomCode);
        this.save(r);
        this.broadcast(r);
        return;
      }
      if (msg.type === "room.leave") {
        if (msg.revision !== r.revision)
          throw new Error("State changed; sync and retry.");
        ws.serializeAttachment({ playerId: a.playerId, left: true });
        const next = leaveRoom(r, a.playerId, Date.now());
        if (next === null) {
          this.remove("emptied");
        } else {
          this.save(next);
          await this.schedule(next);
          this.broadcast(next);
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
            startedAt: Date.now(),
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
          this.tell("event", { metric: "dictionary_errors" });
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
      if (
        e instanceof Error &&
        e.message.endsWith("is not accepted by the dictionary.")
      )
        this.tell("event", { metric: "words_rejected" });
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
    const n = markDisconnected(r, a.playerId, Date.now());
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
      this.remove(r.expiresAt <= now ? "expired" : "abandoned");
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
        let game = passTurn(r.game, "auto-pass"),
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
          game = passTurn(game, "auto-pass");
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
