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
  createGame,
  exchangeTiles,
  getOpeningCells,
  passTurn,
  playMove,
  shuffle,
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
import { LastPlay, RulesDialog, ScorePreview } from "./panels.js";
import { formatClock, useGameSounds } from "./sound.js";

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

function App() {
  const sounds = useGameSounds();
  // null: local screens; otherwise the online flow, joining or creating.
  const [online, setOnline] = useState<
    { kind: "join" } | { kind: "create"; settings: RoomSettings } | null
  >(() =>
    new URLSearchParams(location.search).has("room") ? { kind: "join" } : null,
  );
  const [where, setWhere] = useState<"online" | "device">("online");
  const [screen, setScreen] = useState<Screen>("welcome"),
    [nickname, setNickname] = useState(
      () => sessionStorage.getItem("scrabble.nickname") ?? "",
    );
  const [settings, setSettings] = useState<GameSettings>({
      boardSize: 15,
      timerSeconds: 0,
    }),
    [capacity, setCapacity] = useState<2 | 3 | 4>(2),
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
    [message, setMessage] = useState("Choose a tile, then a board cell."),
    [concealed, setConcealed] = useState(true),
    [cellSize, setCellSize] = useState(() => fittedCellSize(15));
  const [exchangeMode, setExchangeMode] = useState(false),
    [exchangeIds, setExchangeIds] = useState<string[]>([]),
    [confirm, setConfirm] = useState<"pass" | "exchange" | null>(null),
    [showRules, setShowRules] = useState(false),
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
      concealed
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
            ? passTurn(state, "auto-pass")
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
  }, [concealed, game?.phase, game?.settings.timerSeconds, game?.turnNumber]);
  const continueWelcome = () => {
    const name = nickname.trim().slice(0, 20);
    if (!name) return;
    sessionStorage.setItem("scrabble.nickname", name);
    setNickname(name);
    setNames([name, "Player 2"]);
    setScreen("settings");
  };
  const changeCapacity = (value: 2 | 3 | 4) => {
    setCapacity(value);
    setNames(
      Array.from({ length: value }, (_, i) =>
        i === 0 ? nickname : (names[i] ?? `Player ${i + 1}`),
      ),
    );
    setReady(Array.from({ length: value }, () => true));
  };
  const start = () => {
    const players = names.map((name, i) => name.trim() || `Player ${i + 1}`);
    setGame(createGame(settings, players, random));
    setConcealed(true);
    setScreen("game");
  };
  const next = (state: GameState, text: string) => {
    setGame(state);
    setDraft([]);
    setDraftError(null);
    setSelected(null);
    setExchangeMode(false);
    setExchangeIds([]);
    setConfirm(null);
    setConcealed(state.phase === "active");
    setMessage(text);
  };
  const placeTile = (tileId: string, row: number, col: number) => {
    if (
      !game ||
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
        new Map(words.map((word) => [word, validity.get(word) === true])),
    );
    if (!result.ok) return reject(result.error);
    next(result.state, "Pass the device to the next player.");
  };
  const doExchange = () => {
    if (!game) return;
    const result = exchangeTiles(game, exchangeIds, random);
    if (!result.ok) {
      setMessage(result.error);
      setConfirm(null);
      sounds.play("error");
      return;
    }
    next(
      result.state,
      `Exchanged ${exchangeIds.length} tile${exchangeIds.length === 1 ? "" : "s"}.`,
    );
  };
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
            A warm word-board game for two to four people. No accounts, just
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
                onClick={() => setWhere("device")}
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
                {([2, 3, 4] as const).map((value) => (
                  <button
                    key={value}
                    className={capacity === value ? "active" : ""}
                    onClick={() => changeCapacity(value)}
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
          </div>
          <button
            className="primary wide"
            onClick={() =>
              where === "online"
                ? setOnline({
                    kind: "create",
                    settings: { ...settings, capacity },
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
  if (game.phase === "results") {
    const rank = [...game.players].sort((a, b) => b.score - a.score);
    return (
      <main className="shell results">
        <section className="card">
          <p className="eyebrow">Game complete</p>
          <h1>{rank[0]?.name} wins!</h1>
          <p>
            {game.endReason === "rack-emptied"
              ? "A rack and the bag ran empty."
              : "Six scoreless turns ended the game."}
          </p>
          <p>
            {game.lastMove &&
              `Last move: ${game.players[game.lastMove.playerIndex]?.name ?? "A player"} ${game.lastMove.kind === "play" ? `played ${game.lastMove.words.map((item) => item.word).join(", ")} for ${game.lastMove.score}` : game.lastMove.kind === "exchange" ? "exchanged tiles" : "passed"}.`}
          </p>
          <div className="standings">
            {rank.map((player, i) => (
              <div key={player.id}>
                <span>{i + 1}</span>
                <b>{player.name}</b>
                <strong>{player.score}</strong>
                <small>points</small>
              </div>
            ))}
          </div>
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
        </section>
      </main>
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
        <button
          className="help-button"
          aria-label="Rules and dictionary"
          title="Rules and dictionary"
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
                        ? `${draftError && pending ? "invalid provisional tile " : pending ? "your provisional tile " : ""}${letter}, ${tile.value} points`
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
        />
        <p className="status" role="status">
          {message}
        </p>
        <div className="rack-title">
          <b>Your rack</b>
          <small>
            {exchangeMode ? "Select tiles to exchange" : "Tap tile, then board"}
          </small>
        </div>
        <div className="rack">
          {rack.map((tile) => {
            const used = draft.some((item) => item.tileId === tile.id),
              chosen = exchangeIds.includes(tile.id),
              active = selected === tile.id;
            return (
              <button
                key={tile.id}
                disabled={used}
                draggable={!used && !exchangeMode}
                className={active || chosen ? "active" : ""}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/tile-id", tile.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => {
                  if (exchangeMode)
                    setExchangeIds(
                      chosen
                        ? exchangeIds.filter((id) => id !== tile.id)
                        : [...exchangeIds, tile.id],
                    );
                  else setSelected(active ? null : tile.id);
                }}
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
            disabled={!draft.length || checking}
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
            onClick={() => {
              setExchangeMode(!exchangeMode);
              setExchangeIds([]);
            }}
          >
            {exchangeMode ? "Cancel" : "Exchange"}
          </button>
          <button
            onClick={() => {
              setConfirm("pass");
              sounds.play("warning");
            }}
          >
            Pass
          </button>
        </div>
        {exchangeMode && (
          <button
            className="primary wide"
            disabled={!exchangeIds.length}
            onClick={() => {
              setConfirm("exchange");
              sounds.play("warning");
            }}
          >
            Exchange {exchangeIds.length} selected
          </button>
        )}
        <small className="side-hint">Words are checked with WordSoHard.</small>
      </aside>
      {showRules && <RulesDialog onClose={() => setShowRules(false)} />}
      {concealed && (
        <Overlay>
          <p className="eyebrow">Pass the device</p>
          <h2>{current?.name}, you're up</h2>
          <p>Other players, look away before the rack appears.</p>
          <button className="primary wide" onClick={() => setConcealed(false)}>
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
      {confirm && (
        <Overlay>
          <h2>
            {confirm === "pass"
              ? "Pass this turn?"
              : `Exchange ${exchangeIds.length} tiles?`}
          </h2>
          <p>This ends the current turn.</p>
          <div className="actions">
            <button className="secondary" onClick={() => setConfirm(null)}>
              Keep playing
            </button>
            <button
              className="danger"
              onClick={() =>
                confirm === "pass"
                  ? next(passTurn(game), `${current?.name} passed.`)
                  : doExchange()
              }
            >
              Confirm
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
