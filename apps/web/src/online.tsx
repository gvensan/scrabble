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
  seatsFor,
  summarizeRoom,
  type BoardCell,
  type Letter,
} from "@scrabble/game-engine";
import {
  CLOSE_ROOM_GONE,
  CLOSE_SEAT_REJECTED,
  SOCKET_PROTOCOL,
  SOCKET_TOKEN_PREFIX,
  type PublicRoom,
  type RoomStatus,
  type ServerMessage,
} from "@scrabble/game-engine/protocol";
import { isVoiceMessage, useVoice } from "./voice.js";
import {
  ChallengeNotice,
  ChallengeReview,
  type ChallengeView,
} from "./challenge.js";
import { NoticeStack, roomNotices, useNotices } from "./notices.js";
import { RoomSettingsDialog, settingsText } from "./room-settings.js";
import {
  SoundControls,
  speakingText,
  VoiceBadge,
  VoicePanel,
} from "./voice-ui.js";
import {
  MAX_CELL,
  MIN_CELL,
  TIGHT_CELL,
  useBoardKeys,
  usePinchZoom,
} from "./board-input.js";
import { api, wsBase } from "./config.js";
import { recallLast } from "./draft.js";
import { fittedCellSize } from "./layout.js";
import {
  BoardLegend,
  ExchangeDialog,
  HistoryDialog,
  LastPlay,
  type HistoryMove,
  RulesDialog,
  ScorelessEndDialog,
  ScorelessWarning,
  ScorePreview,
} from "./panels.js";
import { canReplay, ReplayDialog } from "./replay.js";
import { formatClock, type GameSounds } from "./sound.js";
import {
  rememberGame,
  ResultsPage,
  summaryLink,
  winnerTitle,
} from "./summary.js";

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
/**
 * Shown when the server's reply does not match this page's room format: the
 * tab still runs a previous release. Reloading fixes it.
 */
const OUTDATED =
  "This page is out of date: the game has been updated. Reload the page to get the latest version.";
function isPublicRoom(value: unknown): value is PublicRoom {
  if (!isRecord(value) || !isRecord(value.settings)) return false;
  const settings = value.settings;
  return (
    typeof value.roomCode === "string" &&
    ["lobby", "active", "results"].includes(String(value.phase)) &&
    Number.isInteger(settings.boardSize) &&
    Number(settings.boardSize) >= 7 &&
    Number(settings.boardSize) <= 40 &&
    [2, 3, 4, 8].includes(Number(settings.capacity)) &&
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
    typeof value.locked === "boolean" &&
    (value.lastMove === null || isLastMove(value.lastMove)) &&
    (value.history === undefined ||
      (Array.isArray(value.history) && value.history.every(isLastMove))) &&
    (value.startedAt === undefined ||
      value.startedAt === null ||
      typeof value.startedAt === "number") &&
    (value.challenge === undefined ||
      value.challenge === null ||
      isChallenge(value.challenge))
  );
}
function isPlacedTile(tile: unknown) {
  return (
    isRecord(tile) &&
    typeof tile.row === "number" &&
    typeof tile.col === "number" &&
    (tile.letter === null || typeof tile.letter === "string") &&
    (tile.blankAs === undefined || typeof tile.blankAs === "string") &&
    typeof tile.value === "number"
  );
}
function isChallenge(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.playerId === "string" &&
    (value.stage === "decide" || value.stage === "review") &&
    typeof value.deadline === "number" &&
    Array.isArray(value.rejected) &&
    value.rejected.every((word) => typeof word === "string") &&
    Array.isArray(value.words) &&
    value.words.every(
      (item) =>
        isRecord(item) &&
        typeof item.word === "string" &&
        typeof item.score === "number",
    ) &&
    typeof value.score === "number" &&
    Array.isArray(value.placed) &&
    value.placed.every(isPlacedTile) &&
    typeof value.challengesLeft === "number"
  );
}
function isLastMove(value: unknown) {
  return (
    isRecord(value) &&
    (value.playerId === null || typeof value.playerId === "string") &&
    ["play", "pass", "exchange", "auto-pass", "rejected"].includes(
      String(value.kind),
    ) &&
    Array.isArray(value.words) &&
    value.words.every(
      (item) =>
        isRecord(item) &&
        typeof item.word === "string" &&
        typeof item.score === "number",
    ) &&
    typeof value.score === "number" &&
    typeof value.tiles === "number" &&
    (value.at === undefined || typeof value.at === "number") &&
    (value.took === undefined || typeof value.took === "number") &&
    (value.challenge === undefined ||
      (isRecord(value.challenge) &&
        ["accepted", "approved", "rejected", "expired"].includes(
          String(value.challenge.outcome),
        ) &&
        typeof value.challenge.challenged === "boolean")) &&
    (value.placed === undefined ||
      (Array.isArray(value.placed) && value.placed.every(isPlacedTile)))
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
  if (value.type === "game.draft")
    return (
      typeof value.playerId === "string" &&
      Array.isArray(value.cells) &&
      value.cells.length <= 7 &&
      value.cells.every(
        (cell) =>
          isRecord(cell) &&
          typeof cell.row === "number" &&
          typeof cell.col === "number" &&
          (cell.letter === null || typeof cell.letter === "string") &&
          (cell.blankAs === undefined || typeof cell.blankAs === "string") &&
          typeof cell.value === "number",
      )
    );
  return value.type === "error" && typeof value.message === "string";
}
export interface RoomSettings {
  boardSize: number;
  /** 8 is "4+": as many as the board allows, up to eight. */
  capacity: 2 | 3 | 4 | 8;
  timerSeconds: 0 | 120 | 300;
  voice?: boolean | undefined;
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
/** When a finished room's game ended, as near as the snapshot tells. */
const endedAt = (room: PublicRoom) => room.history?.at(-1)?.at ?? Date.now();
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
    [showHistory, setShowHistory] = useState(false),
    [showReplay, setShowReplay] = useState(false),
    [editingSettings, setEditingSettings] = useState(false),
    [confirmEnd, setConfirmEnd] = useState(false),
    // Set when I watched the game end on six scoreless turns.
    [scorelessEnd, setScorelessEnd] = useState(false),
    // Tiles the current player is trying, relayed live by the server.
    [ghost, setGhost] = useState<{
      playerId: string;
      cells: readonly {
        row: number;
        col: number;
        letter: string | null;
        blankAs?: string | undefined;
        value: number;
      }[];
    } | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [confirmPass, setConfirmPass] = useState(false),
    [exchanging, setExchanging] = useState(false),
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
    challenge = room?.phase === "active" ? (room.challenge ?? null) : null,
    // A rejected word pauses the game, so nobody can move until it's settled.
    myTurn =
      room?.phase === "active" &&
      seat !== null &&
      challenge === null &&
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
  const { voice, session: voiceSession } = useVoice({
      enabled: room?.settings.voice === true && me !== undefined && !me.left,
      roomCode: room?.roomCode ?? null,
      selfId: seat?.playerId ?? null,
      send: (message) => {
        if (socket.current?.readyState !== WebSocket.OPEN) return false;
        socket.current.send(JSON.stringify(message));
        return true;
      },
    }),
    nowSpeaking = speakingText(
      voice,
      room?.players ?? [],
      seat?.playerId ?? null,
    );
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
      const saved = sessionStorage.getItem(`scrabble.room.${invite}`);
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
  // Mirror the tiles I am trying to the other players, throttled so dragging
  // tiles around stays cheap. The server reads the letters from my rack.
  const draftKey = JSON.stringify(
    myTurn
      ? draft.map(({ row, col, tileId, blankAs }) => ({
          row,
          col,
          tileId,
          ...(blankAs === undefined ? {} : { blankAs }),
        }))
      : [],
  );
  useEffect(() => {
    if (!myTurn) return;
    const timer = window.setTimeout(() => {
      if (socket.current?.readyState !== WebSocket.OPEN) return;
      socket.current.send(
        `{"protocolVersion":1,"type":"game.draft","cells":${draftKey}}`,
      );
    }, 150);
    return () => window.clearTimeout(timer);
  }, [draftKey, myTurn]);
  // Every player gets the same notifications, worked out from each change.
  const { notices, push: pushNotices, dismiss: dismissNotice } = useNotices(),
    previousRoom = useRef<PublicRoom | null>(null);
  useEffect(() => {
    if (!room) return;
    const before = previousRoom.current;
    previousRoom.current = room;
    pushNotices(roomNotices(before, room, seat?.playerId ?? null));
    if (
      before?.phase === "active" &&
      room.phase === "results" &&
      room.endReason === "six-scoreless-turns"
    )
      setScorelessEnd(true);
    // Listed on this device so the game can be opened again later.
    if (room.phase === "results" && before?.phase !== "results")
      rememberGame(summarizeRoom(room, endedAt(room)));
    if (
      room.challenge &&
      room.challenge.playerId === seat?.playerId &&
      before?.challenge === null
    )
      sounds.play("error");
  }, [room]);
  // Once the turn moves on, unplayed tiles go back to the rack.
  useEffect(() => {
    if (myTurn) return;
    setDraft([]);
    setSelected(null);
    setExchanging(false);
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
  const clockDeadline = room?.challenge?.deadline ?? room?.turnDeadline;
  useEffect(() => {
    if (!clockDeadline) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [clockDeadline]);
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
      // The server keeps voice state per socket; tell the new one.
      voiceSession.current?.resync();
    };
    ws.onclose = (event) => {
      if (socket.current !== ws) return;
      socket.current = null;
      if (FINAL_CLOSES.has(event.code)) {
        // Another tab or a closed room: this tab must not keep the mic.
        voiceSession.current?.leave(event.code !== 4001);
        if (event.code !== 4001) {
          sessionStorage.removeItem(`scrabble.room.${roomCode}`);
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
        if (isVoiceMessage(message)) {
          voiceSession.current?.handle(message);
          return;
        }
        // A message this page cannot read: the tab runs a previous release.
        if (!isServerMessage(message)) {
          setStatus(OUTDATED);
          return;
        }
        if (message.type === "room.snapshot") {
          if (
            revision.current >= 0 &&
            message.room.revision > revision.current
          ) {
            setDraft([]);
            setDraftError(null);
            setGhost(null);
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
        if (message.type === "game.draft") setGhost(message);
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
    sessionStorage.setItem(`scrabble.room.${result.roomCode}`, result.token);
    setCode(result.roomCode);
    if (result.snapshot && !isPublicRoom(result.snapshot)) {
      // An open tab still running the previous release; a reload fixes it.
      setStatus(OUTDATED);
      return;
    }
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
  function exitRoom() {
    if (room && socket.current?.readyState === WebSocket.OPEN)
      send("room.leave");
    sessionStorage.removeItem(`scrabble.room.${code}`);
    stopped.current = true;
    socket.current?.close();
    socket.current = null;
    history.replaceState(null, "", location.pathname);
    onExit();
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
          title: "Join my Scrabble game",
          text: `Join my Scrabble game. Room code ${room?.roomCode ?? code}.`,
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
            <span>S</span>Scrabble
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
                  {status === OUTDATED ? (
                    <button
                      className="primary"
                      onClick={() => location.reload()}
                    >
                      Reload page
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => void enter("create", create)}
                    >
                      Try again
                    </button>
                  )}
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
  const board = room.board as Cell[][],
    moves: HistoryMove[] = (room.history ?? []).map((move) => ({
      ...move,
      player: room.players.findIndex((player) => player.id === move.playerId),
      name:
        room.players.find((player) => player.id === move.playerId)?.nickname ??
        "Player",
    }));
  const hostPlayer = room.players.find((player) => player.host),
    challengeMine = challenge?.playerId === seat?.playerId,
    challengeView: ChallengeView | null = challenge
      ? {
          stage: challenge.stage,
          rejected: challenge.rejected,
          playerName: challengeMine
            ? "You"
            : (room.players.find((player) => player.id === challenge.playerId)
                ?.nickname ?? "A player"),
          ruler: me?.host
            ? "you (as host)"
            : `${hostPlayer?.nickname ?? "the host"} (host)`,
          deadline: challenge.deadline,
          challengesLeft: challenge.challengesLeft,
        }
      : null;
  // Only the current player's squares, and only while I am watching.
  const ghostCells = new Map(
    ghost && !myTurn && ghost.playerId === room.currentPlayerId
      ? ghost.cells.map((item) => [`${item.row}:${item.col}`, item])
      : [],
  );
  if (room.phase === "results") {
    const summary = summarizeRoom(room, endedAt(room)),
      endNote =
        room.endReason === "room-time-limit"
          ? "Room time limit reached, so these scores are provisional."
          : room.endReason === "players-left"
            ? "Everyone else left, so the game ended early with the scores as they stood."
            : room.endReason === "ended-early"
              ? "The host ended the game early. Each player lost the value of the tiles they still held."
              : room.endReason === "six-scoreless-turns"
                ? "Finished after six scoreless turns."
                : "Finished when a player emptied their rack.";
    return (
      <>
        <ResultsPage
          eyebrow={`Online game ${room.roomCode} complete`}
          title={winnerTitle(summary)}
          note={<p>{endNote}</p>}
          summary={summary}
          self={me?.nickname}
          before={
            <VoicePanel
              voice={voice}
              session={voiceSession.current}
              players={room.players}
              selfId={seat?.playerId ?? null}
            />
          }
        >
          {canReplay(moves) && (
            <button
              className="secondary wide"
              onClick={() => setShowReplay(true)}
            >
              Replay the game
            </button>
          )}
          <button
            className="secondary wide"
            onClick={() => {
              navigator.clipboard.writeText(summaryLink(room.roomCode)).then(
                () =>
                  setStatus(
                    "Summary link copied. It keeps working for 180 days, after the room closes.",
                  ),
                () => setStatus(`Summary link: ${summaryLink(room.roomCode)}`),
              );
            }}
          >
            Copy link to this summary
          </button>
          <p role="status">{status}</p>
          <button className="secondary wide" onClick={exitRoom}>
            Exit room
          </button>
        </ResultsPage>
        <NoticeStack notices={notices} onDismiss={dismissNotice} />
        {showReplay && (
          <ReplayDialog
            boardSize={room.settings.boardSize}
            premiums={board.map((row) => row.map((cell) => cell.premium))}
            players={room.players.map((player) => ({
              name: player.nickname,
              finalScore: player.score,
            }))}
            moves={moves}
            startedAt={room.startedAt}
            endNote={endNote}
            onClose={() => setShowReplay(false)}
          />
        )}
        {scorelessEnd && (
          <ScorelessEndDialog
            turns={moves.slice(-6).map((move) => ({
              name:
                room.players[move.player]?.id === seat?.playerId
                  ? "You"
                  : move.name,
              move,
            }))}
            players={room.players.map((player, index) => ({
              name: player.nickname,
              moveTotal: moves
                .filter((move) => move.player === index)
                .reduce((sum, move) => sum + move.score, 0),
              final: player.score,
            }))}
            onOk={() => setScorelessEnd(false)}
          />
        )}
      </>
    );
  }
  if (room.phase === "lobby") {
    const host = room.players.find((player) => player.host);
    const seats = seatsFor(room.settings.capacity, room.settings.boardSize),
      open = seats - room.players.length;
    const startBlocker =
      room.players.length < 2
        ? "Waiting for at least one more player to join. Share the invite link above."
        : null;
    return (
      <main className="shell setup">
        <section className="card">
          <p className="eyebrow">Room {room.roomCode}</p>
          <h1>Gather your players</h1>
          <p className="room-settings-line">
            <span>{settingsText(room.settings)}</span>
            {me?.host && (
              <button
                className="link-button"
                onClick={() => setEditingSettings(true)}
              >
                Change settings
              </button>
            )}
          </p>
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
                  with code <b>{room.roomCode}</b>. {open} of {seats} seats
                  open; the room closes 30 minutes after it was created if the
                  game has not started.
                </>
              ) : (
                <>Every seat is taken. The host can start the game.</>
              )}
            </small>
          </section>
          <div className="roster">
            {room.players.map((player) => (
              <div
                className={`player ${voice?.speaking.has(player.id) ? "speaking" : ""}`}
                key={player.id}
              >
                <span>{player.nickname[0]}</span>
                <b>
                  {player.nickname}
                  {player.host ? " · Host" : ""}
                  <VoiceBadge voice={voice} playerId={player.id} />
                </b>
                <small>{player.connected ? "Here" : "Offline"}</small>
              </div>
            ))}
          </div>
          <VoicePanel
            voice={voice}
            session={voiceSession.current}
            players={room.players}
            selfId={seat?.playerId ?? null}
          />
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
                  aria-pressed={room.settings.voice === true}
                  onClick={() =>
                    send("room.voice", {
                      enabled: room.settings.voice !== true,
                    })
                  }
                >
                  {room.settings.voice ? "Turn voice off" : "Turn voice on"}
                </button>
                <small>
                  {room.settings.voice
                    ? "Ends the call for everyone. You can turn it back on later."
                    : "Lets players talk live. Each one chooses to join."}
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
        {/* After the card: .setup sizes the card only as its first child. */}
        <NoticeStack notices={notices} onDismiss={dismissNotice} />
        {editingSettings && me?.host && (
          <RoomSettingsDialog
            settings={room.settings}
            players={room.players.length}
            onClose={() => setEditingSettings(false)}
            onSave={(next) => {
              const { boardSize, capacity, timerSeconds } = next;
              if (
                boardSize !== room.settings.boardSize ||
                capacity !== room.settings.capacity ||
                timerSeconds !== room.settings.timerSeconds
              )
                send("room.settings", {
                  settings: { boardSize, capacity, timerSeconds },
                });
              if ((next.voice === true) !== (room.settings.voice === true))
                send("room.voice", { enabled: next.voice === true });
              setEditingSettings(false);
            }}
          />
        )}
      </main>
    );
  }
  return (
    <main className="online-game">
      <h1 className="sr-only">Scrabble online game board</h1>
      <header>
        <b>Room {room.roomCode}</b>
        <div
          className={`scores${room.players.length > 4 ? " crowded" : ""}`}
          tabIndex={room.players.length > 4 ? 0 : undefined}
          aria-label="Scores"
        >
          {room.players.map((player) => (
            <span
              key={player.id}
              className={`${player.left ? "left" : ""} ${voice?.speaking.has(player.id) ? "speaking" : ""} ${room.phase === "active" && player.id === room.currentPlayerId ? "current" : ""}`}
            >
              {player.nickname} <strong>{player.score}</strong>
              <VoiceBadge voice={voice} playerId={player.id} />
            </span>
          ))}
        </div>
        {voice?.blocked ? (
          <button
            className="voice-unblock"
            onClick={() => voiceSession.current?.unblock()}
          >
            Tap to hear voices
          </button>
        ) : (
          voice && (
            <span className="voice-now" aria-hidden={!nowSpeaking}>
              {nowSpeaking ?? ""}
            </span>
          )
        )}
        <button
          className="help-button"
          aria-label="Rules of play"
          title="Rules of play"
          onClick={() => setShowRules(true)}
        >
          ?
        </button>
        {me?.host && (
          <button
            className="end-game-button"
            onClick={() => setConfirmEnd(true)}
          >
            End game
          </button>
        )}
        <button onClick={exitRoom}>Exit</button>
      </header>
      <NoticeStack notices={notices} onDismiss={dismissNotice} />
      <div className="online-board-scroll" ref={boardViewport}>
        {/* The host's ruling popup already shows all of this. */}
        {challengeView && !(challenge?.stage === "review" && me?.host) && (
          <ChallengeNotice
            view={challengeView}
            mine={challengeMine}
            now={now}
            variant="board"
            onAccept={() => send("game.accept")}
            onChallenge={() => send("game.challenge")}
          />
        )}
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
          className={`board${cellSize < TIGHT_CELL ? " tight" : ""}`}
          role="group"
          aria-label={`${room.settings.boardSize} by ${room.settings.boardSize} board. Use arrow keys to move between squares.`}
          onKeyDown={keys.onKeyDown}
          style={{
            gridTemplateColumns: `repeat(${room.settings.boardSize},${cellSize}px)`,
            gridAutoRows: `${cellSize}px`,
            ["--cell" as string]: `${cellSize}px`,
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
                  : (pending?.blankAs ?? tile?.letter ?? null),
                trying = tile ? undefined : ghostCells.get(`${r}:${c}`);
              return (
                <button
                  key={`${r}:${c}`}
                  className={`cell ${cell.premium?.toLowerCase() ?? ""} ${starts.has(`${r}:${c}`) ? "start" : ""} ${pending ? "pending" : ""} ${pending && draftError ? "invalid" : ""} ${trying ? "ghost" : ""}`}
                  aria-invalid={pending && draftError ? true : undefined}
                  aria-disabled={cell.tile !== null || !myTurn || undefined}
                  data-row={r}
                  data-col={c}
                  tabIndex={keys.tabIndexFor(r, c)}
                  aria-label={`Row ${r + 1}, column ${c + 1}: ${
                    tile
                      ? `${draftError && pending ? "invalid provisional tile " : pending ? "your provisional tile " : ""}${letter ?? "blank"}, ${tile.value} points${cell.premium ? `, on ${premiumName[cell.premium]}` : ""}`
                      : trying
                        ? `${currentName} is trying ${trying.blankAs ?? trying.letter ?? "a blank"} here`
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
                      {cell.premium && (
                        <i className="tile-bonus" aria-hidden="true">
                          {cell.premium}
                        </i>
                      )}
                    </>
                  ) : trying ? (
                    <>
                      <b>{trying.blankAs ?? trying.letter ?? ""}</b>
                      <small>{trying.value}</small>
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
        <BoardLegend />
      </div>
      <aside className="online-side">
        <div
          className={`turn-card ${myTurn ? "mine" : ""} ${room.turnDeadline && room.turnDeadline - now <= 20_000 ? "urgent" : ""}`}
          role="timer"
          aria-label="Turn and timer"
        >
          <div>
            <b aria-live="polite">
              {challenge
                ? "Paused for a rejected word"
                : myTurn
                  ? "Your turn"
                  : `${currentName} is playing`}
            </b>
            <small>
              {challenge
                ? challenge.stage === "decide"
                  ? `${challengeView?.playerName ?? "The player"} can accept or challenge.`
                  : `Waiting for ${challengeView?.ruler ?? "the host"} to rule.`
                : myTurn
                  ? room.turnDeadline === null
                    ? "Place tiles on the board, then Play."
                    : "Play before the clock runs out."
                  : ghostCells.size
                    ? `${currentName} is placing ${ghostCells.size} tile${ghostCells.size === 1 ? "" : "s"}…`
                    : "Your letters unlock on your turn."}
            </small>
          </div>
          <strong
            title={
              room.turnDeadline === null
                ? "No time limit: the host turned the turn timer off"
                : "Time left in this turn"
            }
          >
            {room.turnDeadline === null
              ? "∞"
              : formatClock((room.turnDeadline - now) / 1000)}
          </strong>
          <SoundControls
            voice={voice}
            session={voiceSession.current}
            sounds={sounds}
            players={room.players}
            selfId={seat?.playerId ?? null}
            onHostVoice={
              me?.host
                ? (enabled) => send("room.voice", { enabled })
                : undefined
            }
          />
        </div>
        {!challenge && <ScorelessWarning count={room.scorelessTurns ?? 0} />}
        <LastPlay
          name={
            room.players.find((player) => player.id === room.lastMove?.playerId)
              ?.nickname ?? null
          }
          move={room.lastMove}
          onHistory={() => setShowHistory(true)}
        />
        {challengeView ? (
          // The same notice as on the board, buttons included.
          <ChallengeNotice
            view={challengeView}
            mine={challengeMine}
            now={now}
            variant="side"
            onAccept={() => send("game.accept")}
            onChallenge={() => send("game.challenge")}
          />
        ) : (
          status && (
            <p className="status" role="status">
              {status}
              {!closed && linkDown && (
                <button className="link-button" onClick={reconnectNow}>
                  {linkDown === "gave-up" ? "Try again" : "Reconnect now"}
                </button>
              )}
            </p>
          )
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
                className={selected === tile.id ? "active" : ""}
                disabled={used || !myTurn}
                draggable={myTurn && !used}
                onDragStart={(event) =>
                  event.dataTransfer.setData("text/tile-id", tile.id)
                }
                onClick={() =>
                  setSelected(selected === tile.id ? null : tile.id)
                }
              >
                <b>{tile.letter ?? "□"}</b>
                <small>{tile.value}</small>
              </button>
            );
          })}
        </div>
        <ScorePreview analysis={preview} />
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
            disabled={!myTurn}
            onClick={() => {
              setExchanging(true);
              sounds.play("warning");
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
                className={`${player.id === room.currentPlayerId ? "active" : ""} ${voice?.speaking.has(player.id) ? "speaking" : ""}`}
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
                  <VoiceBadge voice={voice} playerId={player.id} />
                </b>
                <strong>{player.score}</strong>
                <small>pts</small>
              </div>
            ))}
          </div>
        </section>
        <small className="side-hint">Words are checked with WordSoHard.</small>
      </aside>
      {showRules && (
        <RulesDialog mode="online" onClose={() => setShowRules(false)} />
      )}
      {challenge &&
        challengeView &&
        challenge.stage === "review" &&
        me?.host && (
          <ChallengeReview
            view={challengeView}
            words={challenge.words}
            score={challenge.score}
            board={board}
            placed={challenge.placed}
            now={now}
            onApprove={() => send("game.rule", { approve: true })}
            onReject={() => send("game.rule", { approve: false })}
          />
        )}
      {showHistory && (
        <HistoryDialog
          moves={moves}
          startedAt={room.startedAt}
          onClose={() => setShowHistory(false)}
        />
      )}
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
      {exchanging && seat && (
        <ExchangeDialog
          rack={seat.rack}
          bagCount={room.bagRemaining}
          onCancel={() => setExchanging(false)}
          onConfirm={(tileIds) => {
            send("game.exchange", { tileIds });
            setExchanging(false);
            setDraft([]);
            setSelected(null);
          }}
        />
      )}
      {confirmEnd && (
        <div
          className="overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm ending the game"
        >
          <div>
            <h2>End the game now?</h2>
            <p>
              Use this when everyone agrees to stop. Each player loses the value
              of the tiles they still hold, and the highest score wins.
            </p>
            <div className="actions">
              <button
                className="secondary"
                autoFocus
                onClick={() => setConfirmEnd(false)}
              >
                Keep playing
              </button>
              <button
                className="danger"
                onClick={() => {
                  send("game.end");
                  setConfirmEnd(false);
                }}
              >
                End game
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
            <p>You score 0 and play moves to the next player.</p>
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
