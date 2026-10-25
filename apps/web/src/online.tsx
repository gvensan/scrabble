import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzePlay,
  getOpeningCells,
  shuffle,
  type BoardCell,
  type Letter,
} from "@squabble/game-engine";
import {
  CLOSE_ROOM_GONE,
  CLOSE_SEAT_REJECTED,
  SOCKET_PROTOCOL,
  SOCKET_TOKEN_PREFIX,
  type PublicRoom,
  type RoomStatus,
  type ServerMessage,
} from "@squabble/game-engine/protocol";
import {
  MAX_CELL,
  MIN_CELL,
  useBoardKeys,
  usePinchZoom,
} from "./board-input.js";
import { api, wsBase } from "./config.js";
import { recallLast } from "./draft.js";
import { fittedCellSize } from "./layout.js";
import { LastPlay, RulesDialog, ScorePreview } from "./panels.js";
import { formatClock, type GameSounds } from "./sound.js";

interface Tile {
  id: string;
  letter: string | null;
  value: number;
}
type Cell = BoardCell;
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
        typeof player.rackCount === "number" &&
        typeof player.host === "boolean" &&
        typeof player.left === "boolean",
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
    Number.isInteger(value.turnNumber) &&
    Number(value.turnNumber) >= 0 &&
    (value.turnDeadline === null || typeof value.turnDeadline === "number") &&
    typeof value.revision === "number" &&
    typeof value.expiresAt === "number" &&
    (value.endReason === null || typeof value.endReason === "string") &&
    (value.rematchCode === null || typeof value.rematchCode === "string") &&
    typeof value.locked === "boolean" &&
    (value.lastMove === null || isLastMove(value.lastMove))
  );
}
function isLastMove(value: unknown) {
  return (
    isRecord(value) &&
    (value.playerId === null || typeof value.playerId === "string") &&
    ["play", "pass", "exchange", "auto-pass"].includes(String(value.kind)) &&
    Array.isArray(value.words) &&
    value.words.every(
      (item) =>
        isRecord(item) &&
        typeof item.word === "string" &&
        typeof item.score === "number",
    ) &&
    typeof value.score === "number" &&
    typeof value.tiles === "number"
  );
}
/** Automatic reconnects (about two and a half minutes of backoff) before
 * waiting for the player or the network to come back. */
const MAX_RETRIES = 8;
/** Close codes after which retrying cannot succeed. */
const FINAL_CLOSES = new Set([
  1000,
  4000,
  4001,
  CLOSE_ROOM_GONE,
  CLOSE_SEAT_REJECTED,
]);
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
export interface RoomSettings {
  boardSize: number;
  capacity: 2 | 3 | 4;
  timerSeconds: 0 | 120 | 300;
}
interface Props {
  nickname: string;
  /** When set, a room with these settings is created on mount. */
  create?: RoomSettings;
  onExit: () => void;
  theme: "garden" | "candy" | "midnight";
  onThemeChange: (theme: "garden" | "candy" | "midnight") => void;
  sounds: GameSounds;
}
const premiumName = {
  TW: "triple word",
  DW: "double word",
  TL: "triple letter",
  DL: "double letter",
} as const;
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
  create,
  onExit,
  theme,
  onThemeChange,
  sounds,
}: Props) {
  const invite = new URLSearchParams(location.search).get("room") ?? "";
  const [mode, setMode] = useState<"creating" | "join" | "room">(
      create && !invite ? "creating" : "join",
    ),
    [code, setCode] = useState(invite),
    [name, setName] = useState(nickname),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [cellSize, setCellSize] = useState(() => fittedCellSize(15)),
    [now, setNow] = useState(Date.now()),
    [room, setRoom] = useState<PublicRoom | null>(null),
    [seat, setSeat] = useState<Seat | null>(null),
    [status, setStatus] = useState(""),
    [showRules, setShowRules] = useState(false),
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
    [draftError, setDraftError] = useState<string | null>(null),
    [closed, setClosed] = useState<string | null>(null),
    [linkDown, setLinkDown] = useState<"retrying" | "gave-up" | null>(null),
    // Set when an invite link points at a room that cannot be joined now.
    [gate, setGate] = useState<Extract<RoomStatus, { joinable: false }> | null>(
      null,
    ),
    [checkingGate, setCheckingGate] = useState(false);
  const socket = useRef<WebSocket | null>(null),
    reconnectTimer = useRef<number | null>(null),
    retries = useRef(0),
    target = useRef<{ roomCode: string; token: string } | null>(null),
    // Effects run twice in development; the room must be created only once.
    createRequested = useRef(false),
    stopped = useRef(false),
    lastAction = useRef<string | null>(null),
    soundedTurnRevision = useRef(-1),
    warnedDeadline = useRef<number | null>(null),
    endedDeadline = useRef<number | null>(null),
    revision = useRef(-1),
    boardViewport = useRef<HTMLDivElement>(null),
    me = room?.players.find((player) => player.id === seat?.playerId),
    myTurn =
      room?.phase === "active" &&
      seat !== null &&
      room.currentPlayerId === seat.playerId,
    currentName =
      room?.players.find((player) => player.id === room.currentPlayerId)
        ?.nickname ?? "Another player",
    draftMap = useMemo(
      () => new Map(draft.map((item) => [`${item.row}:${item.col}`, item])),
      [draft],
    ),
    starts = useMemo(
      () =>
        new Set(
          getOpeningCells(room?.settings.boardSize ?? 15).map(
            (item) => `${item.row}:${item.col}`,
          ),
        ),
      [room?.settings.boardSize],
    ),
    preview = useMemo(() => {
      if (!room || draft.length === 0) return null;
      const placed = draft.flatMap((item) => {
        const tile = seat?.rack.find((entry) => entry.id === item.tileId);
        return tile
          ? [
              {
                row: item.row,
                col: item.col,
                tile: {
                  letter: tile.letter as Letter | null,
                  value: tile.value,
                  ...(item.blankAs ? { blankAs: item.blankAs as Letter } : {}),
                },
              },
            ]
          : [];
      });
      return analyzePlay(room.board as Cell[][], placed);
    }, [draft, room, seat?.rack]),
    keys = useBoardKeys(room?.settings.boardSize ?? 15);
  usePinchZoom(boardViewport, cellSize, setCellSize, room?.phase === "active");
  const fitBoard = useCallback(() => {
    if (room)
      setCellSize(
        fittedCellSize(room.settings.boardSize, boardViewport.current),
      );
  }, [room?.settings.boardSize]);
  useLayoutEffect(() => {
    if (!room || !boardViewport.current) return;
    const viewport = boardViewport.current;
    fitBoard();
    const observer = new ResizeObserver(fitBoard);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitBoard, room]);
  useEffect(() => {
    // Retry straight away when the network or the tab comes back.
    const wake = () => {
      if (navigator.onLine && document.visibilityState === "visible")
        reconnectNow();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  });
  useEffect(() => {
    stopped.current = false;
    if (invite) {
      const saved = sessionStorage.getItem(`squabble.room.${invite}`);
      if (saved) {
        setMode("room");
        setStatus("Reconnecting…");
        connect(invite, saved);
      } else void checkRoom(invite);
    } else if (create && !createRequested.current) {
      createRequested.current = true;
      void enter("create", create);
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
  // Once the turn moves on, unplayed tiles go back to the rack.
  useEffect(() => {
    if (myTurn) return;
    setDraft([]);
    setSelected(null);
    setExchangeMode(false);
    setExchangeIds([]);
    setDraftError(null);
  }, [myTurn]);
  // A locked or full room can open up again; check every few seconds.
  const gateReason = gate?.reason;
  useEffect(() => {
    if (gateReason !== "locked" && gateReason !== "full") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkRoom(code);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [gateReason, code]);
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
  function reconnectNow() {
    if (!target.current || socket.current || stopped.current || closed) return;
    if (reconnectTimer.current !== null)
      window.clearTimeout(reconnectTimer.current);
    retries.current = 0;
    setLinkDown("retrying");
    setStatus("Reconnecting…");
    connect(target.current.roomCode, target.current.token);
  }
  function connect(roomCode: string, token: string) {
    target.current = { roomCode, token };
    const ws = new WebSocket(
      `${wsBase}/ws?room=${encodeURIComponent(roomCode)}`,
      [SOCKET_PROTOCOL, `${SOCKET_TOKEN_PREFIX}${token}`],
    );
    socket.current = ws;
    ws.onopen = () => {
      if (socket.current !== ws) return;
      retries.current = 0;
      setClosed(null);
      setLinkDown(null);
      setStatus("");
    };
    ws.onclose = (event) => {
      if (socket.current !== ws) return;
      socket.current = null;
      if (FINAL_CLOSES.has(event.code)) {
        if (event.code !== 4001) {
          sessionStorage.removeItem(`squabble.room.${roomCode}`);
          setRoom(null);
        }
        if (event.code !== 1000) sounds.play("warning");
        const reason =
          event.reason ||
          (event.code === 4001
            ? "This room is open in another tab."
            : "This room has expired or closed.");
        setClosed(reason);
        setStatus(reason);
        return;
      }
      sounds.play("warning");
      if (stopped.current) return;
      if (retries.current >= MAX_RETRIES) {
        setLinkDown("gave-up");
        setStatus("Can't reach the room right now.");
        return;
      }
      const delay = Math.min(30_000, 1_000 * 2 ** retries.current);
      retries.current += 1;
      setLinkDown("retrying");
      setStatus(
        `Connection lost. Reconnecting in ${Math.round(delay / 1000)}s…`,
      );
      reconnectTimer.current = window.setTimeout(
        () => connect(roomCode, token),
        delay + Math.floor(Math.random() * 500),
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
  /** Shows why a room cannot be joined instead of the nickname form. */
  async function checkRoom(roomCode: string) {
    setCheckingGate(true);
    try {
      const response = await fetch(
          `${api}/api/rooms/${encodeURIComponent(roomCode)}`,
        ),
        body = (await response.json()) as RoomStatus | { error: string };
      if ("joinable" in body) setGate(body.joinable ? null : body);
    } catch {
      // The join form still works and reports its own errors.
    } finally {
      setCheckingGate(false);
    }
  }
  async function enter(
    kind: "create" | "join",
    settings?: RoomSettings,
    roomCode = code,
    beforeConnect?: (roomCode: string) => void,
  ) {
    setStatus(kind === "create" ? "Creating your room…" : "Joining…");
    setBusy(true);
    let response: Response;
    let result: {
      roomCode?: string;
      token?: string;
      playerId?: string;
      error?: string;
      snapshot?: PublicRoom;
    };
    try {
      response = await fetch(
        kind === "create"
          ? `${api}/api/rooms`
          : `${api}/api/rooms/${encodeURIComponent(roomCode)}/join`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            kind === "create"
              ? { nickname: name, settings }
              : { nickname: name },
          ),
        },
      );
      result = (await response.json()) as typeof result;
    } catch {
      setStatus(
        "Could not reach the game server. Check your connection and try again.",
      );
      return;
    } finally {
      setBusy(false);
    }
    if (!response.ok || !result.roomCode || !result.token || !result.playerId) {
      setStatus(result.error ?? "Unable to enter room.");
      // The room may have been locked, filled or started meanwhile.
      if (kind === "join") void checkRoom(roomCode);
      return;
    }
    sessionStorage.setItem(`squabble.room.${result.roomCode}`, result.token);
    setCode(result.roomCode);
    if (result.snapshot && !isPublicRoom(result.snapshot)) {
      setStatus("The server returned an invalid room state.");
      return;
    }
    beforeConnect?.(result.roomCode);
    revision.current = -1;
    retries.current = 0;
    stopped.current = false;
    setClosed(null);
    setDraft([]);
    setRoom(result.snapshot ?? null);
    setSeat({ playerId: result.playerId, rack: [] });
    setMode("room");
    history.replaceState(null, "", `?room=${result.roomCode}`);
    connect(result.roomCode, result.token);
  }
  /** Detaches from the current room without marking the seat as left. */
  function detach() {
    if (reconnectTimer.current !== null)
      window.clearTimeout(reconnectTimer.current);
    const previous = socket.current;
    socket.current = null;
    sessionStorage.removeItem(`squabble.room.${code}`);
    return previous;
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
    const finished = room;
    void enter("create", finished.settings, code, (newCode) => {
      // Tell everyone still on the results screen where the rematch is.
      const previous = detach();
      if (previous?.readyState === WebSocket.OPEN)
        previous.send(
          JSON.stringify({
            protocolVersion: 1,
            type: "room.rematch",
            actionId: crypto.randomUUID(),
            revision: finished.revision,
            roomCode: newCode,
          }),
        );
      previous?.close(1000, "Started a rematch.");
    });
  }
  function joinRematch(target: string) {
    setCode(target);
    void enter("join", undefined, target, () => detach()?.close(1000));
  }
  const inviteUrl = () =>
    `${location.origin}${location.pathname}?room=${room?.roomCode ?? code}`;
  function copyInvite() {
    navigator.clipboard.writeText(inviteUrl()).then(
      () => {
        setCopied(true);
        setStatus("Invite link copied. Paste it into any chat or email.");
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setStatus("Copy failed. Select the link and copy it instead."),
    );
  }
  async function shareInvite() {
    const url = inviteUrl();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: "Join my Squabble game",
          text: `Join my Squabble game. Room code ${room?.roomCode ?? code}.`,
          url,
        });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("Invite link copied.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setStatus("Sharing failed. Copy the link above instead.");
    }
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
  function activateCell(row: number, col: number) {
    keys.setCursor({ row, col });
    if (!myTurn) return;
    if (selected) {
      place(selected, row, col);
      return;
    }
    if (draftMap.has(`${row}:${col}`)) {
      setDraft(draft.filter((item) => item.row !== row || item.col !== col));
      setDraftError(null);
      setStatus("Tile returned to your rack.");
    }
  }
  function place(tileId: string, row: number, col: number) {
    if (!room || !myTurn || draftMap.has(`${row}:${col}`)) return;
    const board = room.board as Cell[][];
    if (board[row]?.[col]?.tile) return;
    const tile = seat.rack.find((item) => item.id === tileId);
    if (!tile || draft.some((item) => item.tileId === tileId)) return;
    if (tile.letter === null) {
      setBlankTarget({ tileId, row, col });
      return;
    }
    setDraft([...draft, { tileId, row, col }]);
    setDraftError(null);
    setStatus("");
    setSelected(null);
  }
  const themePicker = (
    <fieldset className="span-phone">
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
  );
  if (mode !== "room")
    return (
      <main className="shell setup">
        <header className="top">
          <button onClick={onExit}>← Back</button>
          <div className="brand small">
            <span>S</span>Squabble
          </div>
        </header>
        <section className="card online-entry">
          {mode === "join" && gate ? (
            <>
              <p className="eyebrow">Room {code}</p>
              <h1>
                {gate.reason === "locked"
                  ? "This room is locked"
                  : gate.reason === "full"
                    ? "This room is full"
                    : gate.reason === "started"
                      ? "This game has started"
                      : "Room not found"}
              </h1>
              <p className="lede" role="status">
                {gate.reason === "locked"
                  ? `${gate.host ?? "The host"} has stopped new players joining. Ask them to unlock the room; this page opens the join form as soon as they do.`
                  : gate.reason === "full"
                    ? "Every seat is taken. If someone leaves before the game starts, this page opens the join form."
                    : gate.reason === "started"
                      ? `${gate.host ?? "The host"} has already started this game, and nobody can join a game in progress. Ask for a new invite after it ends.`
                      : "This invite link has expired or the room was closed. Ask your friend for a new link."}
              </p>
              <div className="actions">
                <button className="secondary" onClick={onExit}>
                  Back
                </button>
                {gate.reason === "locked" || gate.reason === "full" ? (
                  <button
                    className="primary"
                    disabled={checkingGate}
                    onClick={() => void checkRoom(code)}
                  >
                    {checkingGate ? "Checking…" : "Check again"}
                  </button>
                ) : (
                  <button
                    className="primary"
                    onClick={() => {
                      setGate(null);
                      setCode("");
                      setStatus("");
                    }}
                  >
                    Enter another code
                  </button>
                )}
              </div>
            </>
          ) : mode === "creating" ? (
            <>
              <p className="eyebrow">Invite friends</p>
              <h1>{busy ? "Creating your room…" : "Room not created"}</h1>
              <p role="status">{status}</p>
              {!busy && (
                <div className="actions">
                  <button className="secondary" onClick={onExit}>
                    Back
                  </button>
                  <button
                    className="primary"
                    onClick={() => void enter("create", create)}
                  >
                    Try again
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="eyebrow">Join a game</p>
              <h1>Join a room</h1>
              <label className="field">
                Nickname
                <input
                  value={name}
                  maxLength={20}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                Room code
                <input
                  value={code}
                  autoCapitalize="characters"
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                />
              </label>
              {themePicker}
              <div className="actions">
                <button className="secondary" onClick={onExit}>
                  Back
                </button>
                <button
                  className="primary"
                  disabled={busy || !name.trim() || !code.trim()}
                  onClick={() => void enter("join")}
                >
                  Join room
                </button>
              </div>
              <p role="status">{status}</p>
            </>
          )}
        </section>
      </main>
    );
  if (!room)
    return (
      <main className="shell results">
        <section className="card">
          <p className="eyebrow">Online room</p>
          <h1>
            {closed
              ? "Room unavailable"
              : linkDown === "gave-up"
                ? "Connection lost"
                : "Reconnecting…"}
          </h1>
          <p role="status">{status}</p>
          {!closed && linkDown && (
            <button className="primary wide" onClick={reconnectNow}>
              {linkDown === "gave-up" ? "Try again" : "Reconnect now"}
            </button>
          )}
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
              ? "Room time limit reached, so these scores are provisional."
              : room.endReason === "players-left"
                ? "Everyone else left, so the game ended early with the scores as they stood."
                : room.endReason === "six-scoreless-turns"
                  ? "Finished after six scoreless turns."
                  : "Finished when a player emptied their rack."}
          </p>
          <div className="standings">
            {ranking.map((player, index) => (
              <div key={player.id}>
                <span>{index + 1}</span>
                <b>
                  {player.nickname}
                  {player.left ? " · Left" : ""}
                </b>
                <strong>{player.score}</strong>
                <small>points</small>
              </div>
            ))}
          </div>
          {room.rematchCode ? (
            <>
              <p className="notice">
                A rematch room ({room.rematchCode}) is ready.
              </p>
              <button
                className="primary wide"
                onClick={() => joinRematch(room.rematchCode ?? "")}
              >
                Join the rematch
              </button>
            </>
          ) : (
            <button className="primary wide" onClick={rematch}>
              Create a rematch room
            </button>
          )}
          <p role="status">{status}</p>
          <button className="secondary wide" onClick={exitRoom}>
            Exit room
          </button>
        </section>
      </main>
    );
  }
  if (room.phase === "lobby") {
    const host = room.players.find((player) => player.host);
    const open = room.settings.capacity - room.players.length;
    const startBlocker =
      room.players.length < 2
        ? "Waiting for at least one more player to join. Share the invite link above."
        : null;
    return (
      <main className="shell setup">
        <section className="card">
          <p className="eyebrow">Room {room.roomCode}</p>
          <h1>Gather your players</h1>
          <section className="invite" aria-label="Invite link">
            <div className="invite-row">
              <input
                readOnly
                value={inviteUrl()}
                aria-label="Invite link"
                onFocus={(event) => event.target.select()}
              />
              <button className="primary" onClick={copyInvite}>
                {copied ? "Copied ✓" : "Copy link"}
              </button>
              {typeof navigator.share === "function" && (
                <button
                  className="secondary"
                  onClick={() => void shareInvite()}
                >
                  Share…
                </button>
              )}
            </div>
            <small>
              {room.locked ? (
                <>
                  The room is locked, so this link will not let anyone new in.
                  The host can unlock it.
                </>
              ) : open > 0 ? (
                <>
                  Send this link by text, chat or email. Friends can also join
                  with code <b>{room.roomCode}</b>. {open} of{" "}
                  {room.settings.capacity} seats open; the room closes 30
                  minutes after it was created if the game has not started.
                </>
              ) : (
                <>Every seat is taken. The host can start the game.</>
              )}
            </small>
          </section>
          <div className="roster">
            {room.players.map((player) => (
              <div className="player" key={player.id}>
                <span>{player.nickname[0]}</span>
                <b>
                  {player.nickname}
                  {player.host ? " · Host" : ""}
                </b>
                <small>{player.connected ? "Here" : "Offline"}</small>
              </div>
            ))}
          </div>
          <div className="lobby-actions">
            {me?.host ? (
              <div className="hinted">
                <button
                  className="primary"
                  disabled={startBlocker !== null}
                  onClick={() => send("room.start")}
                >
                  Start game
                </button>
                <small>
                  {startBlocker ??
                    `Starts now with ${room.players.length} players and deals seven tiles each. Nobody can join after the game starts.`}
                </small>
              </div>
            ) : (
              <div className="hinted">
                <p className="waiting-note">
                  {startBlocker ??
                    `Waiting for ${host?.nickname ?? "the host"} to start.`}
                </p>
                <small>
                  Only the host, {host?.nickname ?? "who created the room"}, can
                  start. The board appears here as soon as they do.
                </small>
              </div>
            )}
            {me?.host && (
              <div className="hinted">
                <button
                  className="secondary"
                  aria-pressed={room.locked}
                  onClick={() => send("room.lock", { locked: !room.locked })}
                >
                  {room.locked ? "Unlock room" : "Lock room"}
                </button>
                <small>
                  {room.locked
                    ? "New players can join with the link again."
                    : "Stops new players joining. Everyone already here stays."}
                </small>
              </div>
            )}
            <div className="hinted">
              <button className="secondary" onClick={exitRoom}>
                Leave room
              </button>
              <small>
                {me?.host
                  ? "Gives up your seat. Another player becomes the host."
                  : "Gives up your seat. You can rejoin with the link while there is space."}
              </small>
            </div>
          </div>
          <p role="status">{status}</p>
        </section>
      </main>
    );
  }
  return (
    <main className="online-game">
      <h1 className="sr-only">Squabble online game board</h1>
      <header>
        <b>Room {room.roomCode}</b>
        <div className="scores">
          {room.players.map((player) => (
            <span key={player.id} className={player.left ? "left" : undefined}>
              {player.nickname} <strong>{player.score}</strong>
            </span>
          ))}
        </div>
        <button
          className="help-button"
          aria-label="Rules and dictionary"
          title="Rules and dictionary"
          onClick={() => setShowRules(true)}
        >
          ?
        </button>
        <button onClick={exitRoom}>Exit</button>
      </header>
      <div className="online-board-scroll" ref={boardViewport}>
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
                  setStatus("Move reset. All tiles returned to your rack.");
                }}
              >
                Reset move
              </button>
            </div>
          </div>
        )}
        <div
          className="board"
          role="group"
          aria-label={`${room.settings.boardSize} by ${room.settings.boardSize} board. Use arrow keys to move between squares.`}
          onKeyDown={keys.onKeyDown}
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
                    : null),
                letter = cell.tile
                  ? (cell.tile.blankAs ?? cell.tile.letter)
                  : (pending?.blankAs ?? tile?.letter ?? null);
              return (
                <button
                  key={`${r}:${c}`}
                  className={`cell ${cell.premium?.toLowerCase() ?? ""} ${starts.has(`${r}:${c}`) ? "start" : ""} ${pending ? "pending" : ""} ${pending && draftError ? "invalid" : ""}`}
                  aria-invalid={pending && draftError ? true : undefined}
                  aria-disabled={cell.tile !== null || !myTurn || undefined}
                  data-row={r}
                  data-col={c}
                  tabIndex={keys.tabIndexFor(r, c)}
                  aria-label={`Row ${r + 1}, column ${c + 1}: ${
                    tile
                      ? `${draftError && pending ? "invalid provisional tile " : pending ? "your provisional tile " : ""}${letter ?? "blank"}, ${tile.value} points`
                      : starts.has(`${r}:${c}`)
                        ? "start square"
                        : cell.premium
                          ? premiumName[cell.premium]
                          : "empty"
                  }`}
                  onClick={() => activateCell(r, c)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) =>
                    place(event.dataTransfer.getData("text/tile-id"), r, c)
                  }
                >
                  {tile ? (
                    <>
                      <b>{letter}</b>
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
      <aside className="online-side">
        <div
          className={`turn-card ${myTurn ? "mine" : ""} ${room.turnDeadline && room.turnDeadline - now <= 20_000 ? "urgent" : ""}`}
          role="timer"
          aria-label="Turn and timer"
        >
          <div>
            <b aria-live="polite">
              {myTurn ? "Your turn" : `${currentName} is playing`}
            </b>
            <small>
              {myTurn
                ? room.turnDeadline === null
                  ? "Place tiles on the board, then Play."
                  : "Play before the clock runs out."
                : "Your letters unlock on your turn."}
            </small>
          </div>
          <strong>
            {room.turnDeadline === null
              ? "∞"
              : formatClock((room.turnDeadline - now) / 1000)}
          </strong>
          <button
            onClick={sounds.toggleMuted}
            aria-pressed={sounds.muted}
            aria-label={sounds.muted ? "Turn sounds on" : "Mute game sounds"}
            title={sounds.muted ? "Turn sounds on" : "Mute game sounds"}
          >
            {sounds.muted ? "🔇" : "🔊"}
          </button>
        </div>
        <LastPlay
          name={
            room.players.find((player) => player.id === room.lastMove?.playerId)
              ?.nickname ?? null
          }
          move={room.lastMove}
        />
        {status && (
          <p className="status" role="status">
            {status}
            {!closed && linkDown && (
              <button className="link-button" onClick={reconnectNow}>
                {linkDown === "gave-up" ? "Try again" : "Reconnect now"}
              </button>
            )}
          </p>
        )}
        <div
          className={`rack ${myTurn ? "" : "waiting"}`}
          aria-label={
            myTurn ? "Your letters" : "Your letters, locked until your turn"
          }
        >
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
                disabled={used || !myTurn}
                draggable={myTurn && !used && !exchangeMode}
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
        <ScorePreview analysis={preview} />
        {exchangeMode ? (
          <div className="actions">
            <button
              className="secondary"
              onClick={() => {
                setExchangeMode(false);
                setExchangeIds([]);
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={!exchangeIds.length || !myTurn}
              onClick={() => {
                setConfirmExchange(true);
                sounds.play("warning");
              }}
            >
              Exchange {exchangeIds.length}
            </button>
          </div>
        ) : (
          <div className="actions">
            <button
              className="secondary"
              disabled={!draft.length || !myTurn}
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
              disabled={!draft.length || !myTurn}
              onClick={() => {
                send("game.play", { placements: draft });
              }}
            >
              Play
            </button>
          </div>
        )}
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
            disabled={!myTurn || exchangeMode}
            onClick={() => {
              setExchangeMode(true);
              setExchangeIds([]);
              setSelected(null);
              setDraft([]);
            }}
          >
            Exchange
          </button>
          <button
            onClick={() => {
              setConfirmPass(true);
              sounds.play("warning");
            }}
            disabled={!myTurn}
          >
            Pass
          </button>
        </div>
        <div className="side-tools">
          <div className="minor" aria-label="Board zoom controls">
            <button
              aria-label="Zoom out"
              onClick={() => setCellSize(Math.max(MIN_CELL, cellSize - 4))}
            >
              −
            </button>
            <button onClick={fitBoard}>Fit</button>
            <button
              aria-label="Zoom in"
              onClick={() => setCellSize(Math.min(MAX_CELL, cellSize + 4))}
            >
              +
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
                aria-label={`${value} theme`}
              >
                {value.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <section className="match-status" aria-label="Scores and turn">
          <header>
            <span>Scoreboard</span>
            <b>
              Turn {room.turnNumber} · {room.bagRemaining} in bag
            </b>
          </header>
          <div
            className="score-list"
            tabIndex={0}
            role="region"
            aria-label="Players and scores"
          >
            {room.players.map((player) => (
              <div
                className={
                  player.id === room.currentPlayerId ? "active" : undefined
                }
                key={player.id}
              >
                <span aria-hidden="true">
                  {player.nickname.charAt(0).toUpperCase()}
                </span>
                <b>
                  {player.nickname}
                  {player.id === seat?.playerId
                    ? " · You"
                    : player.left
                      ? " · Left"
                      : player.connected
                        ? ""
                        : " · Offline"}
                </b>
                <strong>{player.score}</strong>
                <small>pts</small>
              </div>
            ))}
          </div>
        </section>
        <small className="side-hint">Words are checked with WordSoHard.</small>
      </aside>
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}
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
