import { useEffect, useMemo, useRef, useState } from "react";
import { getOpeningCells, shuffle } from "@squabble/game-engine";
import type { PublicRoom, ServerMessage } from "@squabble/game-engine/protocol";
import { recallLast } from "./draft.js";
import { fittedCellSize } from "./layout.js";
import { formatClock, type GameSounds } from "./sound.js";

interface Tile {
  id: string;
  letter: string | null;
  value: number;
}
interface Cell {
  premium: "TW" | "DW" | "TL" | "DL" | null;
  tile: { letter: string | null; blankAs?: string; value: number } | null;
}
interface Seat {
  playerId: string;
  rack: Tile[];
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
function isPublicRoom(value: unknown): value is PublicRoom {
  if (!isRecord(value) || !isRecord(value.settings)) return false;
  const settings = value.settings;
  return (
    typeof value.roomCode === "string" &&
    ["lobby", "active", "results"].includes(String(value.phase)) &&
    Number.isInteger(settings.boardSize) &&
    Number(settings.boardSize) >= 7 &&
    Number(settings.boardSize) <= 40 &&
    [2, 3, 4].includes(Number(settings.capacity)) &&
    [0, 120, 300].includes(Number(settings.timerSeconds)) &&
    Array.isArray(value.players) &&
    value.players.every(
      (player) =>
        isRecord(player) &&
        typeof player.id === "string" &&
        typeof player.nickname === "string" &&
        typeof player.score === "number" &&
        typeof player.connected === "boolean" &&
        typeof player.ready === "boolean" &&
        typeof player.rackCount === "number" &&
        typeof player.host === "boolean",
    ) &&
    Array.isArray(value.board) &&
    value.board.every(
      (row) =>
        Array.isArray(row) &&
        row.every(
          (cell) =>
            isRecord(cell) &&
            (cell.premium === null ||
              ["TW", "DW", "TL", "DL"].some(
                (premium) => cell.premium === premium,
              )) &&
            (cell.tile === null ||
              (isRecord(cell.tile) &&
                (cell.tile.letter === null ||
                  typeof cell.tile.letter === "string") &&
                (cell.tile.blankAs === undefined ||
                  typeof cell.tile.blankAs === "string") &&
                typeof cell.tile.value === "number")),
        ),
    ) &&
    typeof value.bagRemaining === "number" &&
    (value.currentPlayerId === null ||
      typeof value.currentPlayerId === "string") &&
    (value.turnDeadline === null || typeof value.turnDeadline === "number") &&
    typeof value.revision === "number" &&
    typeof value.expiresAt === "number" &&
    (value.endReason === null || typeof value.endReason === "string")
  );
}
function isSeat(value: unknown): value is Seat {
  return (
    isRecord(value) &&
    typeof value.playerId === "string" &&
    Array.isArray(value.rack) &&
    value.rack.every(
      (tile) =>
        isRecord(tile) &&
        typeof tile.id === "string" &&
        (tile.letter === null || typeof tile.letter === "string") &&
        typeof tile.value === "number",
    )
  );
}
function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "room.snapshot")
    return (
      value.protocolVersion === 1 &&
      typeof value.serverTime === "number" &&
      isPublicRoom(value.room)
    );
  if (value.type === "seat.private")
    return (
      value.protocolVersion === 1 &&
      typeof value.revision === "number" &&
      isSeat(value.seat)
    );
  if (value.type === "game.pending") return typeof value.actionId === "string";
  return value.type === "error" && typeof value.message === "string";
}
interface Props {
  nickname: string;
  onExit: () => void;
  theme: "garden" | "candy" | "midnight";
  onThemeChange: (theme: "garden" | "candy" | "midnight") => void;
  sounds: GameSounds;
}
const viteEnv = import.meta.env as Record<string, unknown>;
const configuredApi = viteEnv.VITE_API_BASE_URL;
const configuredWs = viteEnv.VITE_WS_BASE_URL;
const api =
  typeof configuredApi === "string" ? configuredApi : "http://localhost:8787";
const wsBase =
  typeof configuredWs === "string" ? configuredWs : api.replace(/^http/, "ws");
const secureRandom = {
  nextInt(max: number) {
    const value = new Uint32Array(1);
    const ceiling = Math.floor(0x1_0000_0000 / max) * max;
    do crypto.getRandomValues(value);
    while ((value[0] ?? 0) >= ceiling);
    return (value[0] ?? 0) % max;
  },
};
export function OnlineGame({
  nickname,
  onExit,
  theme,
  onThemeChange,
  sounds,
}: Props) {
  const invite = new URLSearchParams(location.search).get("room") ?? "";
  const [mode, setMode] = useState<"choose" | "create" | "join" | "room">(
      invite ? "join" : "choose",
    ),
    [code, setCode] = useState(invite),
    [name, setName] = useState(nickname),
    [capacity, setCapacity] = useState<2 | 3 | 4>(2),
    [boardSize, setBoardSize] = useState(15),
    [timerSeconds, setTimerSeconds] = useState<0 | 120 | 300>(0),
    [cellSize, setCellSize] = useState(() => fittedCellSize(15)),
    [now, setNow] = useState(Date.now()),
    [room, setRoom] = useState<PublicRoom | null>(null),
    [seat, setSeat] = useState<Seat | null>(null),
    [status, setStatus] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [exchangeMode, setExchangeMode] = useState(false),
    [exchangeIds, setExchangeIds] = useState<string[]>([]),
    [confirmPass, setConfirmPass] = useState(false),
    [confirmExchange, setConfirmExchange] = useState(false),
    [blankTarget, setBlankTarget] = useState<{
      tileId: string;
      row: number;
      col: number;
    } | null>(null),
    [draft, setDraft] = useState<
      { tileId: string; row: number; col: number; blankAs?: string }[]
    >([]),
    [draftError, setDraftError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null),
    reconnectTimer = useRef<number | null>(null),
    stopped = useRef(false),
    lastAction = useRef<string | null>(null),
    soundedTurnRevision = useRef(-1),
    warnedDeadline = useRef<number | null>(null),
    endedDeadline = useRef<number | null>(null),
    revision = useRef(-1),
    me = room?.players.find((player) => player.id === seat?.playerId),
    draftMap = useMemo(
      () => new Map(draft.map((item) => [`${item.row}:${item.col}`, item])),
      [draft],
    ),
    starts = useMemo(
      () =>
        new Set(
          getOpeningCells(room?.settings.boardSize ?? boardSize).map(
            (item) => `${item.row}:${item.col}`,
          ),
        ),
      [boardSize, room?.settings.boardSize],
    );
  useEffect(() => {
    if (room) setCellSize(fittedCellSize(room.settings.boardSize));
  }, [room?.settings.boardSize]);
  useEffect(() => {
    stopped.current = false;
    if (invite) {
      const saved = sessionStorage.getItem(`squabble.room.${invite}`);
      if (saved) {
        setMode("room");
        setStatus("Reconnecting…");
        connect(invite, saved);
      }
    }
    return () => {
      stopped.current = true;
      if (reconnectTimer.current !== null)
        window.clearTimeout(reconnectTimer.current);
      const active = socket.current;
      socket.current = null;
      active?.close();
    };
  }, []);
  useEffect(() => {
    if (!room?.turnDeadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [room?.turnDeadline]);
  useEffect(() => {
    if (
      room?.phase === "active" &&
      room.currentPlayerId === seat?.playerId &&
      soundedTurnRevision.current !== room.revision
    ) {
      soundedTurnRevision.current = room.revision;
      sounds.play(room.turnDeadline === null ? "turn" : "timer-start");
    }
  }, [room?.currentPlayerId, room?.phase, room?.revision, seat?.playerId]);
  useEffect(() => {
    const deadline = room?.turnDeadline;
    if (
      deadline === null ||
      deadline === undefined ||
      room?.currentPlayerId !== seat?.playerId
    )
      return;
    const remaining = Math.ceil((deadline - now) / 1000);
    if (
      remaining <= 10 &&
      remaining > 0 &&
      warnedDeadline.current !== deadline
    ) {
      warnedDeadline.current = deadline;
      sounds.play("warning");
    }
    if (remaining <= 0 && endedDeadline.current !== deadline) {
      endedDeadline.current = deadline;
      sounds.play("time-up");
    }
  }, [now, room?.currentPlayerId, room?.turnDeadline, seat?.playerId]);
  function connect(roomCode: string, token: string) {
    const ws = new WebSocket(
      `${wsBase}/ws?room=${encodeURIComponent(roomCode)}&token=${encodeURIComponent(token)}`,
    );
    socket.current = ws;
    ws.onopen = () => {
      if (socket.current === ws) setStatus("");
    };
    ws.onclose = (event) => {
      if (socket.current !== ws) return;
      socket.current = null;
      if (event.code === 4000) setRoom(null);
      setStatus(
        event.reason ||
          (event.code === 4000
            ? "This room has expired."
            : "Disconnected — reconnecting…"),
      );
      if (event.code !== 1000) sounds.play("warning");
      if (
        !stopped.current &&
        event.code !== 1000 &&
        event.code !== 4000 &&
        event.code !== 4001
      )
        reconnectTimer.current = window.setTimeout(
          () => connect(roomCode, token),
          1_000,
        );
    };
    ws.onmessage = (event) => {
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (!isServerMessage(message)) throw new Error("Invalid message.");
        if (message.type === "room.snapshot") {
          if (
            revision.current >= 0 &&
            message.room.revision > revision.current
          ) {
            setDraft([]);
            setDraftError(null);
            lastAction.current = null;
          }
          revision.current = message.room.revision;
          setRoom(message.room);
          setStatus("");
        }
        if (message.type === "seat.private") setSeat(message.seat);
        if (message.type === "error") {
          setStatus(message.message);
          sounds.play("error");
          if (lastAction.current === "game.play")
            setDraftError(message.message);
          lastAction.current = null;
        }
        if (message.type === "game.pending") setStatus("Checking every word…");
      } catch {
        setStatus("Received an invalid server message.");
      }
    };
  }
  async function enter(
    kind: "create" | "join",
    settings = { boardSize, capacity, timerSeconds },
  ) {
    setStatus("Connecting…");
    const response = await fetch(
      kind === "create"
        ? `${api}/api/rooms`
        : `${api}/api/rooms/${encodeURIComponent(code)}/join`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "create"
            ? {
                nickname: name,
                settings,
              }
            : { nickname: name },
        ),
      },
    );
    const result = (await response.json()) as {
      roomCode?: string;
      token?: string;
      playerId?: string;
      error?: string;
      snapshot?: PublicRoom;
    };
    if (!response.ok || !result.roomCode || !result.token || !result.playerId) {
      setStatus(result.error ?? "Unable to enter room.");
      return;
    }
    sessionStorage.setItem(`squabble.room.${result.roomCode}`, result.token);
    setCode(result.roomCode);
    if (result.snapshot && !isPublicRoom(result.snapshot)) {
      setStatus("The server returned an invalid room state.");
      return;
    }
    setRoom(result.snapshot ?? null);
    setSeat({ playerId: result.playerId, rack: [] });
    setMode("room");
    history.replaceState(null, "", `?room=${result.roomCode}`);
    connect(result.roomCode, result.token);
  }
  function exitRoom() {
    if (room && socket.current?.readyState === WebSocket.OPEN)
      send("room.leave");
    sessionStorage.removeItem(`squabble.room.${code}`);
    stopped.current = true;
    socket.current?.close();
    socket.current = null;
    history.replaceState(null, "", location.pathname);
    onExit();
  }
  function rematch() {
    if (!room) return;
    if (socket.current?.readyState === WebSocket.OPEN) send("room.leave");
    sessionStorage.removeItem(`squabble.room.${code}`);
    socket.current?.close();
    socket.current = null;
    stopped.current = false;
    setCapacity(room.settings.capacity);
    setBoardSize(room.settings.boardSize);
    setTimerSeconds(room.settings.timerSeconds);
    void enter("create", room.settings);
  }
  function send(type: string, payload: Record<string, unknown> = {}) {
    if (!room || socket.current?.readyState !== WebSocket.OPEN) {
      setStatus("Not connected.");
      return;
    }
    lastAction.current = type;
    if (type === "game.play") setDraftError(null);
    socket.current.send(
      JSON.stringify({
        protocolVersion: 1,
        type,
        actionId: crypto.randomUUID(),
        revision: room.revision,
        ...payload,
      }),
    );
  }
  function place(tileId: string, row: number, col: number) {
    if (!room || draftMap.has(`${row}:${col}`)) return;
    const board = room.board as Cell[][];
    if (board[row]?.[col]?.tile) return;
    const tile = seat?.rack.find((item) => item.id === tileId);
    if (!tile) return;
    if (tile.letter === null) {
      setBlankTarget({ tileId, row, col });
      return;
    }
    setDraft([...draft, { tileId, row, col }]);
    setDraftError(null);
    setStatus("");
    setSelected(null);
  }
  if (mode !== "room")
    return (
      <main className="shell setup">
        <header className="top">
          <button onClick={onExit}>← Local game</button>
          <div className="brand small">
            <span>S</span>Squabble Live
          </div>
        </header>
        <section className="card online-entry">
          <p className="eyebrow">True multiplayer</p>
          <h1>
            {mode === "choose"
              ? "Play together, anywhere"
              : mode === "create"
                ? "Create a private room"
                : "Join a room"}
          </h1>
          {mode === "choose" ? (
            <div className="online-choices">
              <button className="primary" onClick={() => setMode("create")}>
                Create online room
              </button>
              <button className="secondary" onClick={() => setMode("join")}>
                Join with code
              </button>
            </div>
          ) : (
            <>
              <label className="field">
                Nickname
                <input
                  value={name}
                  maxLength={20}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {mode === "join" ? (
                <label className="field">
                  Room code
                  <input
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.toUpperCase())
                    }
                  />
                </label>
              ) : (
                <>
                  <fieldset>
                    <legend>Board size</legend>
                    <div className="choices">
                      {[15, 21, 32].map((value) => (
                        <button
                          className={boardSize === value ? "active" : ""}
                          key={value}
                          onClick={() => setBoardSize(value)}
                        >
                          <b>
                            {value} × {value}
                          </b>
                          <small>
                            {value === 15
                              ? "Quick"
                              : value === 21
                                ? "Roomy"
                                : "Epic"}
                          </small>
                        </button>
                      ))}
                    </div>
                    <label className="field compact">
                      Custom (7–40)
                      <input
                        type="number"
                        min={7}
                        max={40}
                        value={boardSize}
                        onChange={(event) =>
                          setBoardSize(
                            Math.min(
                              40,
                              Math.max(7, Number(event.target.value)),
                            ),
                          )
                        }
                      />
                    </label>
                    <p className="setting-note">
                      Bigger boards use larger tile bags and usually take
                      longer.
                    </p>
                  </fieldset>
                  <fieldset>
                    <legend>Seats</legend>
                    <div className="segments">
                      {([2, 3, 4] as const).map((value) => (
                        <button
                          className={capacity === value ? "active" : ""}
                          key={value}
                          onClick={() => setCapacity(value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Turn timer</legend>
                    <div className="segments">
                      {(
                        [
                          [0, "Off"],
                          [120, "2 min"],
                          [300, "5 min"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          className={timerSeconds === value ? "active" : ""}
                          key={value}
                          onClick={() => setTimerSeconds(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              <button className="primary wide" onClick={() => void enter(mode)}>
                {mode === "create" ? "Create room" : "Join room"}
              </button>
              <button
                className="secondary wide"
                onClick={() => setMode("choose")}
              >
                Back
              </button>
            </>
          )}
          <fieldset>
            <legend>Board theme</legend>
            <div className="segments themes">
              {(["garden", "candy", "midnight"] as const).map((value) => (
                <button
                  key={value}
                  className={theme === value ? "active" : ""}
                  onClick={() => onThemeChange(value)}
                >
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>
          <p role="status">{status}</p>
        </section>
      </main>
    );
  if (!room)
    return (
      <main className="shell results">
        <section className="card">
          <p className="eyebrow">Online room</p>
          <h1>Reconnecting…</h1>
          <p role="status">{status}</p>
          <button className="secondary wide" onClick={exitRoom}>
            Exit
          </button>
        </section>
      </main>
    );
  const board = room.board as Cell[][];
  if (room.phase === "results") {
    const ranking = [...room.players].sort((a, b) => b.score - a.score);
    return (
      <main className="shell results">
        <section className="card">
          <p className="eyebrow">Online game complete</p>
          <h1>{ranking[0]?.nickname} wins!</h1>
          <p>
            {room.endReason === "room-time-limit"
              ? "Room time limit reached — scores are provisional."
              : room.endReason === "six-scoreless-turns"
                ? "Finished after six scoreless turns."
                : "Finished when a player emptied their rack."}
          </p>
          <div className="standings">
            {ranking.map((player, index) => (
              <div key={player.id}>
                <span>{index + 1}</span>
                <b>{player.nickname}</b>
                <strong>{player.score}</strong>
                <small>points</small>
              </div>
            ))}
          </div>
          <button className="primary wide" onClick={rematch}>
            Create a rematch room
          </button>
          <button className="secondary wide" onClick={exitRoom}>
            Exit room
          </button>
        </section>
      </main>
    );
  }
  if (room.phase === "lobby")
    return (
      <main className="shell setup">
        <section className="card">
          <p className="eyebrow">Room {room.roomCode}</p>
          <h1>Gather your players</h1>
          <p>
            Share <strong>{location.href}</strong>
          </p>
          <button
            className="secondary wide"
            onClick={() => {
              void navigator.clipboard.writeText(location.href);
              setStatus("Invite link copied.");
            }}
          >
            Copy invite link
          </button>
          <div className="roster">
            {room.players.map((player) => (
              <div className="player" key={player.id}>
                <span>{player.nickname[0]}</span>
                <b>
                  {player.nickname}
                  {player.host ? " · Host" : ""}
                </b>
                <small>
                  {player.connected
                    ? player.ready
                      ? "Ready"
                      : "Connected"
                    : "Offline"}
                </small>
              </div>
            ))}
          </div>
          <button
            className="secondary wide"
            onClick={() => send("room.ready", { ready: !me?.ready })}
          >
            {me?.ready ? "I'm not ready" : "I'm ready"}
          </button>
          {me?.host && (
            <>
              <button
                className="primary wide"
                disabled={
                  room.players.length < 2 ||
                  !room.players.every((player) => player.ready)
                }
                onClick={() => send("room.start")}
              >
                Start game
              </button>
              <button
                className="danger wide"
                onClick={() => send("room.close")}
              >
                Close lobby
              </button>
            </>
          )}
          <button className="secondary wide" onClick={exitRoom}>
            Leave room
          </button>
          <p role="status">{status}</p>
        </section>
      </main>
    );
  return (
    <main className="online-game">
      <h1 className="sr-only">Squabble online game board</h1>
      <header>
        <b>Room {room.roomCode}</b>
        <div className="scores">
          {room.players.map((player) => (
            <span key={player.id}>
              {player.nickname} <strong>{player.score}</strong>
            </span>
          ))}
        </div>
        <button onClick={exitRoom}>Exit</button>
      </header>
      <div className="online-board-scroll">
        {draftError && draft.length > 0 && (
          <div className="board-error" role="alert">
            <button
              className="board-error-dismiss"
              aria-label="Dismiss move error"
              onClick={() => setDraftError(null)}
            >
              ×
            </button>
            <div className="board-error-copy">
              <b>That move cannot be played</b>
              <span>{draftError}</span>
              <small>Your provisional tiles are still on the board.</small>
            </div>
            <div className="board-error-actions">
              <button
                hidden={
                  !/dictionary|unavailable|busy|timed out/i.test(draftError)
                }
                onClick={() => send("game.play", { placements: draft })}
              >
                Try again
              </button>
              <button
                onClick={() => {
                  setDraft((placements) => recallLast(placements));
                  setDraftError(null);
                  setStatus("Last tile returned to your rack.");
                }}
              >
                Undo last
              </button>
              <button
                onClick={() => {
                  setDraft([]);
                  setSelected(null);
                  setDraftError(null);
                  setStatus("Move reset — all tiles returned to your rack.");
                }}
              >
                Reset move
              </button>
            </div>
          </div>
        )}
        <div
          className="board"
          style={{
            gridTemplateColumns: `repeat(${room.settings.boardSize},${cellSize}px)`,
            gridAutoRows: `${cellSize}px`,
          }}
        >
          {board.flatMap((row, r) =>
            row.map((cell, c) => {
              const pending = draftMap.get(`${r}:${c}`),
                tile =
                  cell.tile ??
                  (pending
                    ? (seat?.rack.find((item) => item.id === pending.tileId) ??
                      null)
                    : null);
              return (
                <button
                  key={`${r}:${c}`}
                  className={`cell ${cell.premium?.toLowerCase() ?? ""} ${starts.has(`${r}:${c}`) ? "start" : ""} ${pending ? "pending" : ""} ${pending && draftError ? "invalid" : ""}`}
                  aria-invalid={pending && draftError ? true : undefined}
                  aria-label={
                    tile
                      ? `${draftError && pending ? "Invalid provisional tile, " : ""}${"blankAs" in tile && tile.blankAs ? tile.blankAs : (tile.letter ?? "blank")}, ${tile.value} points`
                      : starts.has(`${r}:${c}`)
                        ? "Start"
                        : (cell.premium ?? "Empty cell")
                  }
                  onClick={() => selected && place(selected, r, c)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) =>
                    place(event.dataTransfer.getData("text/tile-id"), r, c)
                  }
                  disabled={cell.tile !== null}
                >
                  {tile ? (
                    <>
                      <b>
                        {"blankAs" in tile && tile.blankAs
                          ? tile.blankAs
                          : tile.letter}
                      </b>
                      <small>{tile.value}</small>
                    </>
                  ) : starts.has(`${r}:${c}`) ? (
                    <span className="start-star" aria-hidden="true">
                      ★
                    </span>
                  ) : (
                    cell.premium
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>
      <aside>
        <div
          className={`timer-card ${room.turnDeadline && room.turnDeadline - now <= 20_000 ? "urgent" : ""}`}
          role="timer"
          aria-label="Turn timer"
        >
          <div>
            <span>Turn timer</span>
            <button
              onClick={sounds.toggleMuted}
              aria-pressed={sounds.muted}
              title={sounds.muted ? "Turn sounds on" : "Mute game sounds"}
            >
              {sounds.muted ? "Sound off" : "Sound on"}
            </button>
          </div>
          <strong>
            {room.turnDeadline === null
              ? "No limit"
              : formatClock((room.turnDeadline - now) / 1000)}
          </strong>
          <small>
            {room.turnDeadline === null
              ? "No automatic pass"
              : room.currentPlayerId === seat?.playerId
                ? "Your time remaining"
                : `${room.players.find((player) => player.id === room.currentPlayerId)?.nickname ?? "Player"}'s time remaining`}
          </small>
        </div>
        <p className="status">
          {status ||
            (room.currentPlayerId === seat?.playerId
              ? "Your turn"
              : "Waiting for another player")}
        </p>
        <div className="rack">
          {seat?.rack.map((tile) => {
            const used = draft.some((item) => item.tileId === tile.id);
            return (
              <button
                key={tile.id}
                className={
                  selected === tile.id || exchangeIds.includes(tile.id)
                    ? "active"
                    : ""
                }
                disabled={used}
                draggable={!used && !exchangeMode}
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/tile-id", tile.id)
                }
                onClick={() => {
                  if (exchangeMode)
                    setExchangeIds(
                      exchangeIds.includes(tile.id)
                        ? exchangeIds.filter((id) => id !== tile.id)
                        : [...exchangeIds, tile.id],
                    );
                  else setSelected(selected === tile.id ? null : tile.id);
                }}
              >
                <b>{tile.letter ?? "□"}</b>
                <small>{tile.value}</small>
              </button>
            );
          })}
        </div>
        <div className="minor" aria-label="Board zoom controls">
          <button onClick={() => setCellSize(Math.max(30, cellSize - 4))}>
            − Zoom
          </button>
          <button
            onClick={() => setCellSize(fittedCellSize(room.settings.boardSize))}
          >
            Fit
          </button>
          <button onClick={() => setCellSize(Math.min(58, cellSize + 4))}>
            + Zoom
          </button>
        </div>
        <div
          className="segments themes compact-themes"
          aria-label="Board theme"
        >
          {(["garden", "candy", "midnight"] as const).map((value) => (
            <button
              key={value}
              className={theme === value ? "active" : ""}
              onClick={() => onThemeChange(value)}
              title={`${value} theme`}
            >
              {value.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={!draft.length}
            onClick={() => {
              setDraft((placements) => recallLast(placements));
              setDraftError(null);
              setStatus("Last tile returned to your rack.");
            }}
            aria-label="Recall last placed tile"
          >
            Recall
          </button>
          <button
            className="primary"
            disabled={!draft.length || room.currentPlayerId !== seat?.playerId}
            onClick={() => {
              send("game.play", { placements: draft });
            }}
          >
            Play
          </button>
        </div>
        <div className="minor">
          <button
            onClick={() =>
              setSeat(
                seat
                  ? { ...seat, rack: shuffle(seat.rack, secureRandom) }
                  : seat,
              )
            }
          >
            Shuffle
          </button>
          <button
            onClick={() => {
              setExchangeMode(!exchangeMode);
              setExchangeIds([]);
              setSelected(null);
            }}
          >
            {exchangeMode ? "Cancel exchange" : "Exchange"}
          </button>
          <button
            onClick={() => {
              setConfirmPass(true);
              sounds.play("warning");
            }}
            disabled={room.currentPlayerId !== seat?.playerId}
          >
            Pass
          </button>
        </div>
        {exchangeMode && (
          <button
            className="primary wide"
            disabled={
              !exchangeIds.length || room.currentPlayerId !== seat?.playerId
            }
            onClick={() => {
              setConfirmExchange(true);
              sounds.play("warning");
            }}
          >
            Exchange {exchangeIds.length} selected
          </button>
        )}
        <p className="validator">
          <b>Word data by WordSoHard</b>
          <br />
          Every formed word is checked by the server.
        </p>
      </aside>
      {blankTarget && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Choose blank letter"
        >
          <div>
            <h2>Choose the blank letter</h2>
            <div className="letters">
              {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => (
                <button
                  key={letter}
                  onClick={() => {
                    setDraft([...draft, { ...blankTarget, blankAs: letter }]);
                    setDraftError(null);
                    setStatus("");
                    setBlankTarget(null);
                    setSelected(null);
                  }}
                >
                  {letter}
                </button>
              ))}
            </div>
            <button className="secondary" onClick={() => setBlankTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmExchange && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm exchange"
        >
          <div>
            <h2>Exchange {exchangeIds.length} selected tiles?</h2>
            <p>This uses your turn and counts as a scoreless move.</p>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => setConfirmExchange(false)}
              >
                Keep tiles
              </button>
              <button
                className="danger"
                onClick={() => {
                  send("game.exchange", { tileIds: exchangeIds });
                  setConfirmExchange(false);
                  setExchangeMode(false);
                  setExchangeIds([]);
                }}
              >
                Exchange tiles
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmPass && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm pass"
        >
          <div>
            <h2>Pass this turn?</h2>
            <p>This counts as a scoreless turn.</p>
            <div className="actions">
              <button
                className="secondary"
                onClick={() => setConfirmPass(false)}
              >
                Keep playing
              </button>
              <button
                className="danger"
                onClick={() => {
                  send("game.pass");
                  setConfirmPass(false);
                }}
              >
                Pass turn
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
