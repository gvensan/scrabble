import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  analyzePlay,
  BOARD_SIZE,
  boardTiles,
  maxPlayersFor,
  createGame,
  endGame,
  exchangeTiles,
  getOpeningCells,
  passTurn,
  playMove,
  shuffle,
  stampMoves,
  summarizeGame,
  withChallenge,
  type GameSummary,
  type GameSettings,
  type GameState,
  type Letter,
  type Placement,
  type RandomSource,
} from "@scrabble/game-engine";
import "./styles.css";
import {
  MAX_CELL,
  MIN_CELL,
  useBoardKeys,
  usePinchZoom,
} from "./board-input.js";
import { AdminPage } from "./admin.js";
import { checkWords, DictionaryError } from "./dictionary.js";
import { recallLast } from "./draft.js";
import { fittedCellSize } from "./layout.js";
import { OnlineGame, type RoomSettings } from "./online.js";
import {
  ChallengeNotice,
  ChallengeReview,
  type ChallengeView,
  MAX_CHALLENGES,
} from "./challenge.js";
import {
  BoardLegend,
  ExchangeDialog,
  HistoryDialog,
  LastPlay,
  describeMove,
  RulesDialog,
  ScorelessEndDialog,
  ScorelessWarning,
  ScorePreview,
  type HistoryMove,
} from "./panels.js";
import { canReplay, ReplayDialog } from "./replay.js";
import { formatClock, useGameSounds } from "./sound.js";
import {
  PastGames,
  rememberGame,
  ResultsPage,
  SummaryPage,
  winnerTitle,
} from "./summary.js";

type Screen = "welcome" | "settings" | "lobby" | "game";
type Theme = "garden" | "candy" | "midnight";
const random: RandomSource = {
  nextInt(max) {
    const data = new Uint32Array(1);
    crypto.getRandomValues(data);
    return (data[0] ?? 0) % max;
  },
};
const premiumName = {
  TW: "Triple word",
  DW: "Double word",
  TL: "Triple letter",
  DL: "Double letter",
} as const;

/** The leaderboard and moments of a finished same-device game. */
function deviceSummary(game: GameState): GameSummary {
  return summarizeGame({
    code: null,
    mode: "device",
    boardSize: game.settings.boardSize,
    timerSeconds: game.settings.timerSeconds,
    startedAt: game.startedAt ?? null,
    endedAt: game.history?.at(-1)?.at ?? Date.now(),
    endReason: game.endReason,
    players: game.players.map((player) => ({
      name: player.name,
      score: player.score,
    })),
    moves: (game.history ?? []).map((move) => ({
      ...move,
      player: move.playerIndex,
    })),
    tiles: boardTiles(game.board),
  });
}

function App() {
  const sounds = useGameSounds();
  // null: local screens; otherwise the online flow, joining or creating.
  const [online, setOnline] = useState<
    { kind: "join" } | { kind: "create"; settings: RoomSettings } | null
  >(() =>
    new URLSearchParams(location.search).has("room") ? { kind: "join" } : null,
  );
  // A finished game being looked at again: by ?game=CODE or from the list.
  const [viewing, setViewing] = useState<{
    code: string | null;
    summary?: GameSummary | undefined;
  } | null>(() => {
    const code = new URLSearchParams(location.search).get("game");
    return code && /^[A-Za-z0-9]{6}$/.test(code)
      ? { code: code.toUpperCase() }
      : null;
  });
  const [where, setWhere] = useState<"online" | "device">("online");
  const [screen, setScreen] = useState<Screen>("welcome"),
    [nickname, setNickname] = useState(
      () => sessionStorage.getItem("scrabble.nickname") ?? "",
    );
  const [settings, setSettings] = useState<GameSettings>({
      boardSize: 15,
      timerSeconds: 0,
    }),
    // 8 is "4+", online only: as many as the board allows, up to eight.
    [capacity, setCapacity] = useState<2 | 3 | 4 | 8>(2),
    [voice, setVoice] = useState(false),
    [checking, setChecking] = useState(false),
    [names, setNames] = useState(["", "Player 2"]),
    [ready, setReady] = useState([true, true]);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("scrabble.theme") as Theme | null) ?? "garden",
  );
  const [game, setGame] = useState<GameState | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<Placement[]>([]),
    [draftError, setDraftError] = useState<string | null>(null),
    // A play the dictionary refused, paused until the table settles it.
    [pending, setPending] = useState<{
      placements: readonly Placement[];
      rejected: readonly string[];
      stage: "decide" | "review";
    } | null>(null),
    // Challenges each player has used, and words the table approved.
    [challengesUsed, setChallengesUsed] = useState<readonly number[]>([]),
    [approvedWords, setApprovedWords] = useState<ReadonlySet<string>>(
      () => new Set(),
    ),
    // Set when the game has just ended on six scoreless turns.
    [scorelessEnd, setScorelessEnd] = useState(false),
    [message, setMessage] = useState("Choose a tile, then a board cell."),
    [concealed, setConcealed] = useState(true),
    [cellSize, setCellSize] = useState(() => fittedCellSize(15));
  const [exchanging, setExchanging] = useState(false),
    [confirmPass, setConfirmPass] = useState(false),
    [showRules, setShowRules] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [showReplay, setShowReplay] = useState(false),
    [confirmEnd, setConfirmEnd] = useState(false),
    [blankTarget, setBlankTarget] = useState<{
      row: number;
      col: number;
      tileId: string;
    } | null>(null),
    [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const boardViewport = useRef<HTMLDivElement>(null),
    latestGame = useRef<GameState | null>(null);
  latestGame.current = game;
  const current = game?.players[game.currentPlayerIndex],
    challengeView: ChallengeView | null =
      pending && game
        ? {
            stage: pending.stage,
            rejected: pending.rejected,
            playerName: current?.name ?? "This player",
            ruler: "everyone at the table",
            deadline: null,
            challengesLeft: Math.max(
              0,
              MAX_CHALLENGES - (challengesUsed[game.currentPlayerIndex] ?? 0),
            ),
          }
        : null,
    draftCells = useMemo(
      () => new Map(draft.map((item) => [`${item.row}:${item.col}`, item])),
      [draft],
    ),
    starts = useMemo(
      () =>
        new Set(
          getOpeningCells(game?.settings.boardSize ?? 15).map(
            (item) => `${item.row}:${item.col}`,
          ),
        ),
      [game?.settings.boardSize],
    ),
    preview = useMemo(() => {
      if (!game || draft.length === 0) return null;
      const rack = game.players[game.currentPlayerIndex]?.rack ?? [];
      return analyzePlay(
        game.board,
        draft.flatMap((item) => {
          const tile = rack.find((entry) => entry.id === item.tileId);
          return tile
            ? [
                {
                  row: item.row,
                  col: item.col,
                  tile: item.blankAs
                    ? { ...tile, blankAs: item.blankAs }
                    : tile,
                },
              ]
            : [];
        }),
      );
    }, [draft, game]),
    // What a challenged play would score if the table approves it.
    reviewPlay = useMemo(() => {
      if (!game || !pending) return null;
      const result = playMove(
        game,
        pending.placements,
        (words) => new Map(words.map((word) => [word, true])),
      );
      return result.ok
        ? {
            words: result.words,
            score: result.score,
            placed: result.state.lastMove?.placed ?? [],
          }
        : null;
    }, [game, pending]),
    keys = useBoardKeys(game?.settings.boardSize ?? 15);
  usePinchZoom(boardViewport, cellSize, setCellSize, game?.phase === "active");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("scrabble.theme", theme);
  }, [theme]);
  const fitBoard = useCallback(() => {
    if (game)
      setCellSize(
        fittedCellSize(game.settings.boardSize, boardViewport.current),
      );
  }, [game?.settings.boardSize]);
  useLayoutEffect(() => {
    if (!game || !boardViewport.current) return;
    const viewport = boardViewport.current;
    fitBoard();
    const observer = new ResizeObserver(fitBoard);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitBoard, game]);
  useEffect(() => {
    if (game?.phase === "active" && !concealed)
      sounds.play(game.settings.timerSeconds === 0 ? "turn" : "timer-start");
  }, [concealed, game?.phase, game?.turnNumber]);
  useEffect(() => {
    if (
      game?.phase !== "active" ||
      game.settings.timerSeconds === 0 ||
      concealed ||
      // A rejected word pauses the clock until the table settles it.
      pending !== null
    ) {
      const timerSeconds = game?.settings.timerSeconds;
      setSecondsLeft(
        timerSeconds === undefined || timerSeconds === 0 ? null : timerSeconds,
      );
      return;
    }
    const turnNumber = game.turnNumber;
    const deadline = Date.now() + game.settings.timerSeconds * 1000;
    let warned = false;
    let ended = false;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 10 && remaining > 0 && !warned) {
        warned = true;
        sounds.play("warning");
      }
      if (remaining === 0) {
        if (!ended) {
          ended = true;
          sounds.play("time-up");
        }
        setGame((state) =>
          state?.phase === "active" && state.turnNumber === turnNumber
            ? stampMoves(state, passTurn(state, "auto-pass"), Date.now())
            : state,
        );
        setDraft([]);
        setDraftError(null);
        setSelected(null);
        setConcealed(true);
        setMessage("Time expired, so the turn was passed.");
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [
    concealed,
    game?.phase,
    game?.settings.timerSeconds,
    game?.turnNumber,
    pending,
  ]);
  const lastPhase = useRef(game?.phase);
  useEffect(() => {
    if (
      lastPhase.current === "active" &&
      game?.phase === "results" &&
      game.endReason === "six-scoreless-turns"
    )
      setScorelessEnd(true);
    if (lastPhase.current === "active" && game?.phase === "results")
      rememberGame(deviceSummary(game));
    lastPhase.current = game?.phase;
  }, [game?.phase]);
  const continueWelcome = () => {
    const name = nickname.trim().slice(0, 20);
    if (!name) return;
    sessionStorage.setItem("scrabble.nickname", name);
    setNickname(name);
    setNames([name, "Player 2"]);
    setScreen("settings");
  };
  const changeCapacity = (value: 2 | 3 | 4 | 8) => {
    setCapacity(value);
    // Same-device games seat at most four; "4+" is for online rooms.
    const seats = Math.min(value, 4);
    setNames(
      Array.from({ length: seats }, (_, i) =>
        i === 0 ? nickname : (names[i] ?? `Player ${i + 1}`),
      ),
    );
    setReady(Array.from({ length: seats }, () => true));
  };
  const start = () => {
    const players = names.map((name, i) => name.trim() || `Player ${i + 1}`);
    setGame({
      ...createGame(settings, players, random),
      startedAt: Date.now(),
      turnStartedAt: Date.now(),
    });
    setConcealed(true);
    setPending(null);
    setChallengesUsed([]);
    setApprovedWords(new Set());
    setScreen("game");
  };
  const next = (state: GameState, text: string) => {
    setGame((before) =>
      before ? stampMoves(before, state, Date.now()) : state,
    );
    setDraft([]);
    setDraftError(null);
    setSelected(null);
    setExchanging(false);
    setConfirmPass(false);
    setConcealed(state.phase === "active");
    setMessage(text);
  };
  const placeTile = (tileId: string, row: number, col: number) => {
    if (
      !game ||
      pending ||
      game.board[row]?.[col]?.tile ||
      draftCells.has(`${row}:${col}`)
    )
      return;
    const tile = current?.rack.find((item) => item.id === tileId);
    if (!tile || draft.some((item) => item.tileId === tileId)) return;
    if (tile.letter === null) {
      setBlankTarget({ row, col, tileId: tile.id });
      return;
    }
    setDraft([...draft, { tileId: tile.id, row, col }]);
    setDraftError(null);
    setSelected(null);
    setMessage("Draft updated. Add tiles or play the word.");
  };
  const place = (row: number, col: number) => {
    keys.setCursor({ row, col });
    if (selected) {
      placeTile(selected, row, col);
      return;
    }
    if (draftCells.has(`${row}:${col}`)) {
      setDraft(draft.filter((item) => item.row !== row || item.col !== col));
      setDraftError(null);
      setMessage("Tile returned to your rack.");
    }
  };
  const assignBlank = (blankAs: Letter) => {
    if (!blankTarget) return;
    setDraft([...draft, { ...blankTarget, blankAs }]);
    setDraftError(null);
    setBlankTarget(null);
    setSelected(null);
  };
  const reject = (error: string) => {
    setMessage(error);
    setDraftError(error);
    sounds.play("error");
  };
  const submit = async () => {
    if (!game || checking) return;
    const analysis = preview ?? analyzePlay(game.board, []);
    if (!analysis.ok) return reject(analysis.error);
    let validity: ReadonlyMap<string, boolean>;
    setChecking(true);
    setMessage("Checking every word…");
    try {
      validity = await checkWords(analysis.candidates);
    } catch (error) {
      return reject(
        error instanceof DictionaryError
          ? `${error.message} Keep your tiles in place and try again.`
          : "The dictionary could not be reached. Try again.",
      );
    } finally {
      setChecking(false);
    }
    // The turn timer may have passed the turn while the check was running.
    if (latestGame.current !== game) return;
    const result = playMove(
      game,
      draft,
      (words) =>
        new Map(
          words.map((word) => [
            word,
            validity.get(word) === true || approvedWords.has(word),
          ]),
        ),
    );
    if (!result.ok) return reject(result.error);
    if (result.rejected) {
      // Pause with the tiles still on the board until it is settled.
      sounds.play("error");
      setPending({
        placements: draft,
        rejected: result.rejected,
        stage: "decide",
      });
      setSelected(null);
      setMessage("");
      return;
    }
    next(result.state, "Pass the device to the next player.");
  };
  const settle = (outcome: "accepted" | "approved" | "rejected") => {
    if (!game || !pending) return;
    const refused = new Set(pending.rejected),
      approve = outcome === "approved",
      result = playMove(
        game,
        pending.placements,
        (words) =>
          new Map(words.map((word) => [word, approve || !refused.has(word)])),
      );
    if (!result.ok) return;
    const name = current?.name ?? "This player",
      words = pending.rejected.join(", ");
    if (approve)
      setApprovedWords(new Set([...approvedWords, ...pending.rejected]));
    setPending(null);
    next(
      withChallenge(result.state, {
        outcome,
        challenged: pending.stage === "review",
      }),
      approve
        ? `${words} approved: ${name} scores ${result.score}. Pass the device to the next player.`
        : `${words} stays rejected: ${name}'s turn is lost. Pass the device to the next player.`,
    );
  };
  const challengePlay = () => {
    if (!game || !pending) return;
    const index = game.currentPlayerIndex;
    if ((challengesUsed[index] ?? 0) >= MAX_CHALLENGES) return;
    setChallengesUsed(
      game.players.map((_, i) =>
        i === index ? (challengesUsed[i] ?? 0) + 1 : (challengesUsed[i] ?? 0),
      ),
    );
    setPending({ ...pending, stage: "review" });
  };
  const doExchange = (ids: readonly string[]) => {
    if (!game) return;
    const result = exchangeTiles(game, ids, random);
    if (!result.ok) {
      setMessage(result.error);
      setExchanging(false);
      sounds.play("error");
      return;
    }
    next(
      result.state,
      `Exchanged ${ids.length} tile${ids.length === 1 ? "" : "s"}.`,
    );
  };
  if (viewing)
    return (
      <SummaryPage
        code={viewing.code}
        stored={viewing.summary}
        onBack={() => {
          setViewing(null);
          history.replaceState(null, "", location.pathname);
        }}
      />
    );
  if (online)
    return (
      <OnlineGame
        nickname={nickname}
        {...(online.kind === "create" ? { create: online.settings } : {})}
        onExit={() => setOnline(null)}
        theme={theme}
        onThemeChange={setTheme}
        sounds={sounds}
      />
    );
  if (screen === "welcome")
    return (
      <main className="welcome shell">
        <div className="brand">
          <span>S</span>Scrabble
        </div>
        <section className="card">
          <p className="eyebrow">Words with friends, minus the fuss</p>
          <h1>
            Make a room.
            <br />
            <em>Make your move.</em>
          </h1>
          <p className="lede">
            A warm word-board game for two to eight people. No accounts, just
            pass the device and play.
          </p>
          <label className="field">
            Your nickname
            <input
              autoFocus
              maxLength={20}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") continueWelcome();
              }}
              placeholder="What should friends call you?"
            />
          </label>
          <button
            className="primary wide"
            disabled={!nickname.trim()}
            onClick={continueWelcome}
          >
            Create a game →
          </button>
          <button
            className="secondary wide"
            onClick={() => {
              const name = nickname.trim().slice(0, 20);
              if (name) sessionStorage.setItem("scrabble.nickname", name);
              setOnline({ kind: "join" });
            }}
          >
            Join with a code
          </button>
          <small>
            Invite friends with a link, or pass one device around the table.
          </small>
          <PastGames
            onOpen={(past) =>
              setViewing({ code: past.code, summary: past.summary })
            }
          />
        </section>
      </main>
    );
  if (screen === "settings")
    return (
      <main className="shell setup">
        <Header back={() => setScreen("welcome")} />
        <section className="card">
          <p className="eyebrow">Set the table</p>
          <h1>Create your game</h1>
          <fieldset>
            <legend>Where are you playing?</legend>
            <div className="choices two">
              <button
                className={where === "online" ? "active" : ""}
                aria-pressed={where === "online"}
                onClick={() => setWhere("online")}
              >
                <b>Invite friends online</b>
                <small>
                  Everyone uses their own device. You get a link to share.
                </small>
              </button>
              <button
                className={where === "device" ? "active" : ""}
                aria-pressed={where === "device"}
                onClick={() => {
                  setWhere("device");
                  if (capacity === 8) changeCapacity(4);
                }}
              >
                <b>Same device</b>
                <small>
                  Pass one phone, tablet or computer around the table.
                </small>
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>Board size</legend>
            <div className="choices">
              {[15, 21, 32].map((size) => (
                <button
                  key={size}
                  className={settings.boardSize === size ? "active" : ""}
                  onClick={() => setSettings({ ...settings, boardSize: size })}
                >
                  <b>
                    {size} × {size}
                  </b>
                  <small>
                    {size === 15
                      ? "Classic pace"
                      : size === 21
                        ? "Room to roam"
                        : "Epic game"}
                  </small>
                </button>
              ))}
              <label className="field compact">
                Custom (7–40)
                <input
                  type="number"
                  min={BOARD_SIZE.min}
                  max={BOARD_SIZE.max}
                  value={settings.boardSize}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      boardSize: Math.min(
                        40,
                        Math.max(7, Number(e.target.value)),
                      ),
                    })
                  }
                />
              </label>
            </div>
            {(settings.boardSize < 11 || settings.boardSize > 21) && (
              <p className="notice">
                This creates an unusual, experimental game.
              </p>
            )}
          </fieldset>
          <div className="settings-grid three">
            <fieldset className="span-phone">
              <legend>Board theme</legend>
              <div className="segments themes">
                {(["garden", "candy", "midnight"] as const).map((value) => (
                  <button
                    key={value}
                    className={theme === value ? "active" : ""}
                    onClick={() => setTheme(value)}
                  >
                    {value[0]?.toUpperCase()}
                    {value.slice(1)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Players</legend>
              <div className="segments">
                {(where === "online"
                  ? ([2, 3, 4, 8] as const)
                  : ([2, 3, 4] as const)
                ).map((value) => (
                  <button
                    key={value}
                    className={capacity === value ? "active" : ""}
                    aria-pressed={capacity === value}
                    title={
                      value === 8
                        ? `More than four: up to ${maxPlayersFor(settings.boardSize)} on a ${settings.boardSize}×${settings.boardSize} board`
                        : undefined
                    }
                    onClick={() => changeCapacity(value)}
                  >
                    {value === 8 ? "4+" : value}
                  </button>
                ))}
              </div>
              {capacity === 8 && where === "online" && (
                <small className="field-hint">
                  Up to {maxPlayersFor(settings.boardSize)} players on this
                  board.
                </small>
              )}
            </fieldset>
            <fieldset>
              <legend>Turn timer</legend>
              <div className="segments">
                {(
                  [
                    { v: 0, l: "Off" },
                    { v: 120, l: "2 min" },
                    { v: 300, l: "5 min" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.v}
                    className={settings.timerSeconds === item.v ? "active" : ""}
                    onClick={() =>
                      setSettings({ ...settings, timerSeconds: item.v })
                    }
                  >
                    {item.l}
                  </button>
                ))}
              </div>
            </fieldset>
            {where === "online" && (
              <fieldset>
                <legend>Voice chat</legend>
                <div className="segments">
                  {([false, true] as const).map((value) => (
                    <button
                      key={String(value)}
                      className={voice === value ? "active" : ""}
                      aria-pressed={voice === value}
                      onClick={() => setVoice(value)}
                    >
                      {value ? "On" : "Off"}
                    </button>
                  ))}
                </div>
                <small className="field-hint">
                  {voice
                    ? "Players can talk live. Each one chooses to join and can mute."
                    : "No microphones. Players can still see each move live."}
                </small>
              </fieldset>
            )}
          </div>
          <button
            className="primary wide"
            onClick={() =>
              where === "online"
                ? setOnline({
                    kind: "create",
                    settings: { ...settings, capacity, voice },
                  })
                : setScreen("lobby")
            }
          >
            {where === "online"
              ? "Create invite link →"
              : "Continue to lobby →"}
          </button>
        </section>
      </main>
    );
  if (screen === "lobby")
    return (
      <main className="shell setup">
        <Header back={() => setScreen("settings")} />
        <section className="card">
          <p className="eyebrow">Local room</p>
          <h1>Everyone ready?</h1>
          <p className="lede">
            Add the names of the people sharing this device.
          </p>
          <div className="roster">
            {names.map((name, index) => (
              <div className="player" key={index}>
                <span>{(name || "P")[0]?.toUpperCase()}</span>
                <input
                  aria-label={`Player ${index + 1} name`}
                  maxLength={20}
                  value={name}
                  onChange={(e) =>
                    setNames(
                      names.map((item, i) =>
                        i === index ? e.target.value : item,
                      ),
                    )
                  }
                />
                <button
                  className={ready[index] ? "ready" : ""}
                  onClick={() =>
                    setReady(
                      ready.map((item, i) => (i === index ? !item : item)),
                    )
                  }
                >
                  {ready[index] ? "✓ Ready" : "Not ready"}
                </button>
              </div>
            ))}
          </div>
          <div className="summary">
            <span>
              {settings.boardSize} × {settings.boardSize}
            </span>
            <span>
              {settings.timerSeconds
                ? `${settings.timerSeconds / 60} min turns`
                : "No timer"}
            </span>
            <span>WordSoHard words</span>
          </div>
          <button
            className="primary wide"
            disabled={
              !ready.every(Boolean) || names.some((name) => !name.trim())
            }
            onClick={start}
          >
            Start game
          </button>
        </section>
      </main>
    );
  if (!game) return null;
  const moves: HistoryMove[] = (game.history ?? []).map((move) => ({
    ...move,
    player: move.playerIndex,
    name: game.players[move.playerIndex]?.name ?? "Player",
  }));
  if (game.phase === "results") {
    const summary = deviceSummary(game),
      endNote =
        game.endReason === "rack-emptied"
          ? "A rack and the bag ran empty."
          : game.endReason === "ended-early"
            ? "The game was ended early. Each player lost the value of the tiles they still held."
            : "Six scoreless turns ended the game.";
    return (
      <>
        <ResultsPage
          eyebrow="Game complete"
          title={winnerTitle(summary)}
          note={
            <>
              <p>{endNote}</p>
              {game.lastMove && (
                <p>
                  Last move:{" "}
                  {describeMove(
                    game.players[game.lastMove.playerIndex]?.name ?? "A player",
                    game.lastMove,
                  )}
                </p>
              )}
            </>
          }
          summary={summary}
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
            className="primary wide"
            onClick={() => {
              setGame(null);
              setScreen("lobby");
            }}
          >
            Play again
          </button>
          <button
            className="secondary wide"
            onClick={() => {
              setGame(null);
              setScreen("welcome");
            }}
          >
            Exit
          </button>
        </ResultsPage>
        {showReplay && (
          <ReplayDialog
            boardSize={game.settings.boardSize}
            premiums={game.board.map((row) => row.map((cell) => cell.premium))}
            players={game.players.map((player) => ({
              name: player.name,
              finalScore: player.score,
            }))}
            moves={moves}
            startedAt={game.startedAt}
            endNote={endNote}
            onClose={() => setShowReplay(false)}
          />
        )}
        {scorelessEnd && (
          <ScorelessEndDialog
            turns={moves.slice(-6).map((move) => ({ name: move.name, move }))}
            players={game.players.map((player, index) => ({
              name: player.name,
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
  const rack = current?.rack ?? [];
  return (
    <main className="game">
      <h1 className="sr-only">Scrabble game board</h1>
      <header>
        <div className="brand small">
          <span>S</span>Scrabble
        </div>
        <div className="scores">
          {game.players.map((player, i) => (
            <div
              className={i === game.currentPlayerIndex ? "active" : ""}
              key={player.id}
            >
              <small>{player.name}</small>
              <b>{player.score}</b>
            </div>
          ))}
        </div>
        <div className="bag">
          <small>Bag</small>
          <b>{game.bag.length}</b>
        </div>
        <button className="end-game-button" onClick={() => setConfirmEnd(true)}>
          End game
        </button>
        <button
          className="help-button"
          aria-label="Rules of play"
          title="Rules of play"
          onClick={() => setShowRules(true)}
        >
          ?
        </button>
      </header>
      <section className="play">
        <div className="toolbar">
          <b>● {current?.name}'s turn</b>
          <div>
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
        </div>
        <div className="board-scroll" ref={boardViewport}>
          {challengeView && (
            <ChallengeNotice
              view={challengeView}
              mine
              now={0}
              variant="board"
              onAccept={() => settle("accepted")}
              onChallenge={challengePlay}
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
                    !/dictionary|unavailable|busy|reached/i.test(draftError)
                  }
                  onClick={() => void submit()}
                >
                  Try again
                </button>
                <button
                  onClick={() => {
                    setDraft((placements) => recallLast(placements));
                    setDraftError(null);
                    setMessage("Last tile returned to your rack.");
                  }}
                >
                  Undo last
                </button>
                <button
                  onClick={() => {
                    setDraft([]);
                    setSelected(null);
                    setDraftError(null);
                    setMessage("Move reset. All tiles returned to your rack.");
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
            onKeyDown={keys.onKeyDown}
            style={{
              gridTemplateColumns: `repeat(${game.settings.boardSize},${cellSize}px)`,
            }}
            aria-label={`${game.settings.boardSize} by ${game.settings.boardSize} board. Use arrow keys to move between squares.`}
          >
            {game.board.flatMap((row, r) =>
              row.map((cell, c) => {
                const pending = draftCells.get(`${r}:${c}`),
                  tile =
                    cell.tile ??
                    (pending
                      ? (current?.rack.find(
                          (item) => item.id === pending.tileId,
                        ) ?? null)
                      : null),
                  letter = tile?.letter ?? pending?.blankAs;
                return (
                  <button
                    key={`${r}:${c}`}
                    className={`cell ${cell.premium?.toLowerCase() ?? ""} ${starts.has(`${r}:${c}`) ? "start" : ""} ${pending ? "pending" : ""} ${pending && draftError ? "invalid" : ""}`}
                    aria-invalid={pending && draftError ? true : undefined}
                    aria-disabled={cell.tile !== null || undefined}
                    data-row={r}
                    data-col={c}
                    tabIndex={keys.tabIndexFor(r, c)}
                    style={{ width: cellSize, height: cellSize }}
                    aria-label={`Row ${r + 1}, column ${c + 1}: ${
                      tile
                        ? `${draftError && pending ? "invalid provisional tile " : pending ? "your provisional tile " : ""}${letter}, ${tile.value} points${cell.premium ? `, on ${premiumName[cell.premium].toLowerCase()}` : ""}`
                        : cell.premium
                          ? premiumName[cell.premium]
                          : starts.has(`${r}:${c}`)
                            ? "start square"
                            : "empty"
                    }`}
                    onClick={() => place(r, c)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const tileId = event.dataTransfer.getData("text/tile-id");
                      if (tileId) placeTile(tileId, r, c);
                    }}
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
      </section>
      <aside>
        <div
          className={`timer-card ${secondsLeft !== null && secondsLeft <= 20 ? "urgent" : ""}`}
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
            {secondsLeft === null ? "No limit" : formatClock(secondsLeft)}
          </strong>
          <small>
            {secondsLeft === null
              ? "Take your time"
              : secondsLeft <= 10
                ? "Finish your move now"
                : `${current?.name}'s time remaining`}
          </small>
        </div>
        <section className="match-status" aria-label="Scores and turn">
          <header>
            <span>Scoreboard</span>
            <b>Turn {game.turnNumber}</b>
          </header>
          <div className="score-list">
            {game.players.map((player, index) => (
              <div
                className={
                  index === game.currentPlayerIndex ? "active" : undefined
                }
                key={player.id}
              >
                <span aria-hidden="true">
                  {player.name.charAt(0).toUpperCase()}
                </span>
                <b>{player.name}</b>
                <strong>{player.score}</strong>
                <small>pts</small>
              </div>
            ))}
          </div>
        </section>
        <LastPlay
          name={
            game.lastMove
              ? (game.players[game.lastMove.playerIndex]?.name ?? null)
              : null
          }
          move={game.lastMove ?? null}
          onHistory={() => setShowHistory(true)}
        />
        {!pending && <ScorelessWarning count={game.scorelessTurns} />}
        {challengeView ? (
          <ChallengeNotice
            view={challengeView}
            mine
            now={0}
            variant="side"
            onAccept={() => settle("accepted")}
            onChallenge={challengePlay}
          />
        ) : (
          <p className="status" role="status">
            {message}
          </p>
        )}
        <div className="rack-title">
          <b>Your rack</b>
          <small>Tap tile, then board</small>
        </div>
        <div className="rack">
          {rack.map((tile) => {
            const used = draft.some((item) => item.tileId === tile.id),
              active = selected === tile.id;
            return (
              <button
                key={tile.id}
                disabled={used}
                draggable={!used}
                className={active ? "active" : ""}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/tile-id", tile.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => setSelected(active ? null : tile.id)}
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
            disabled={!draft.length}
            onClick={() => {
              setDraft((placements) => recallLast(placements));
              setDraftError(null);
              setSelected(null);
              setMessage("Last tile returned to your rack.");
            }}
            aria-label="Recall last placed tile"
          >
            Recall
          </button>
          <button
            className="primary"
            disabled={!draft.length || checking || pending !== null}
            onClick={() => void submit()}
          >
            {checking ? "Checking…" : "Play word"}
          </button>
        </div>
        <div className="minor">
          <button
            onClick={() => {
              setGame({
                ...game,
                players: game.players.map((p, i) =>
                  i === game.currentPlayerIndex
                    ? { ...p, rack: shuffle(p.rack, random) }
                    : p,
                ),
              });
              setSelected(null);
            }}
          >
            Shuffle
          </button>
          <button
            disabled={pending !== null}
            onClick={() => {
              setExchanging(true);
              sounds.play("warning");
            }}
          >
            Exchange
          </button>
          <button
            disabled={pending !== null}
            onClick={() => {
              setConfirmPass(true);
              sounds.play("warning");
            }}
          >
            Pass
          </button>
        </div>
        <small className="side-hint">Words are checked with WordSoHard.</small>
      </aside>
      {pending?.stage === "review" && challengeView && (
        <ChallengeReview
          view={challengeView}
          words={reviewPlay?.words ?? []}
          score={reviewPlay?.score ?? 0}
          board={game.board}
          placed={reviewPlay?.placed ?? []}
          now={0}
          onApprove={() => settle("approved")}
          onReject={() => settle("rejected")}
        />
      )}
      {showRules && (
        <RulesDialog mode="local" onClose={() => setShowRules(false)} />
      )}
      {showHistory && (
        <HistoryDialog
          moves={moves}
          startedAt={game.startedAt}
          onClose={() => setShowHistory(false)}
        />
      )}
      {concealed && (
        <Overlay>
          <p className="eyebrow">Pass the device</p>
          <h2>{current?.name}, you're up</h2>
          <p>Other players, look away before the rack appears.</p>
          <button
            className="primary wide"
            onClick={() => {
              // On a shared device the turn starts once its player can see
              // the rack, so handing the device over is not counted.
              setGame(
                (state) => state && { ...state, turnStartedAt: Date.now() },
              );
              setConcealed(false);
            }}
          >
            Reveal my rack
          </button>
        </Overlay>
      )}
      {blankTarget && (
        <Overlay>
          <h2>Choose the blank letter</h2>
          <div className="letters">
            {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => (
              <button
                key={letter}
                onClick={() => assignBlank(letter as Letter)}
              >
                {letter}
              </button>
            ))}
          </div>
          <button className="secondary" onClick={() => setBlankTarget(null)}>
            Cancel
          </button>
        </Overlay>
      )}
      {exchanging && (
        <ExchangeDialog
          rack={rack}
          bagCount={game.bag.length}
          onCancel={() => setExchanging(false)}
          onConfirm={doExchange}
        />
      )}
      {confirmEnd && (
        <Overlay>
          <h2>End the game now?</h2>
          <p>
            Use this when everyone agrees to stop. Each player loses the value
            of the tiles they still hold, and the highest score wins.
          </p>
          <div className="actions">
            <button className="secondary" onClick={() => setConfirmEnd(false)}>
              Keep playing
            </button>
            <button
              className="danger"
              onClick={() => {
                setConfirmEnd(false);
                setGame(endGame(game));
              }}
            >
              End game
            </button>
          </div>
        </Overlay>
      )}
      {confirmPass && (
        <Overlay>
          <h2>Pass this turn?</h2>
          <p>You score 0 and play moves to the next player.</p>
          <div className="actions">
            <button className="secondary" onClick={() => setConfirmPass(false)}>
              Keep playing
            </button>
            <button
              className="danger"
              onClick={() => next(passTurn(game), `${current?.name} passed.`)}
            >
              Pass
            </button>
          </div>
        </Overlay>
      )}
    </main>
  );
}
function Header({ back }: { back: () => void }) {
  return (
    <header className="top">
      <button onClick={back}>← Back</button>
      <div className="brand small">
        <span>S</span>Scrabble
      </div>
    </header>
  );
}
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Game dialog"
    >
      <div>{children}</div>
    </div>
  );
}
const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Missing root element");
/** The admin dashboard lives at #/adminit so it needs no server routing. */
function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const update = () => setHash(location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return hash === "#/adminit" ? <AdminPage /> : <App />;
}
createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
