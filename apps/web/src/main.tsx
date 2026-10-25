import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
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
} from "@squabble/game-engine";
import "./styles.css";
import { recallLast } from "./draft.js";
import { fittedCellSize } from "./layout.js";
import { OnlineGame } from "./online.js";
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
const demoValidator = (words: readonly string[]) =>
  new Map(words.map((word) => [word, /^[A-Z]{2,40}$/.test(word)]));
const premiumName = {
  TW: "Triple word",
  DW: "Double word",
  TL: "Triple letter",
  DL: "Double letter",
} as const;

function App() {
  const sounds = useGameSounds();
  const [online, setOnline] = useState(() =>
    new URLSearchParams(location.search).has("room"),
  );
  const [screen, setScreen] = useState<Screen>("welcome"),
    [nickname, setNickname] = useState(
      () => sessionStorage.getItem("squabble.nickname") ?? "",
    );
  const [settings, setSettings] = useState<GameSettings>({
      boardSize: 15,
      timerSeconds: 0,
    }),
    [capacity, setCapacity] = useState<2 | 3 | 4>(2),
    [names, setNames] = useState(["", "Player 2"]),
    [ready, setReady] = useState([true, true]);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("squabble.theme") as Theme | null) ?? "garden",
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
    [blankTarget, setBlankTarget] = useState<{
      row: number;
      col: number;
      tileId: string;
    } | null>(null),
    [secondsLeft, setSecondsLeft] = useState<number | null>(null);
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
    );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("squabble.theme", theme);
  }, [theme]);
  useEffect(() => {
    if (game) setCellSize(fittedCellSize(game.settings.boardSize));
  }, [game?.settings.boardSize]);
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
            ? passTurn(state)
            : state,
        );
        setDraft([]);
        setDraftError(null);
        setSelected(null);
        setConcealed(true);
        setMessage("Time expired — the turn was passed.");
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [concealed, game?.phase, game?.settings.timerSeconds, game?.turnNumber]);
  const continueWelcome = () => {
    const name = nickname.trim().slice(0, 20);
    if (!name) return;
    sessionStorage.setItem("squabble.nickname", name);
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
    if (!tile) return;
    if (tile.letter === null) {
      setBlankTarget({ row, col, tileId: tile.id });
      return;
    }
    setDraft([...draft, { tileId: tile.id, row, col }]);
    setDraftError(null);
    setSelected(null);
    setMessage("Draft updated — add tiles or play the word.");
  };
  const place = (row: number, col: number) => {
    if (selected) placeTile(selected, row, col);
  };
  const assignBlank = (blankAs: Letter) => {
    if (!blankTarget) return;
    setDraft([...draft, { ...blankTarget, blankAs }]);
    setDraftError(null);
    setBlankTarget(null);
    setSelected(null);
  };
  const submit = () => {
    if (!game) return;
    const result = playMove(game, draft, demoValidator);
    if (!result.ok) {
      setMessage(result.error);
      setDraftError(result.error);
      sounds.play("error");
      return;
    }
    next(
      result.state,
      `${result.words.map((item) => item.word).join(", ")} scored ${result.score} points.`,
    );
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
        onExit={() => setOnline(false)}
        theme={theme}
        onThemeChange={setTheme}
        sounds={sounds}
      />
    );
  if (screen === "welcome")
    return (
      <main className="welcome shell">
        <div className="brand">
          <span>S</span>Squabble
        </div>
        <section className="card">
          <p className="eyebrow">Words with friends, minus the fuss</p>
          <h1>
            Make a room.
            <br />
            <em>Make your move.</em>
          </h1>
          <p className="lede">
            A warm word-board game for two to four people. No accounts—just pass
            the device and play.
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
            Create a local game →
          </button>
          <button className="secondary wide" onClick={() => setOnline(true)}>
            Play online with friends
          </button>
          <small>
            Local pass-and-play preview · Nothing leaves this device
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
            </div>
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
            {(settings.boardSize < 11 || settings.boardSize > 21) && (
              <p className="notice">
                This creates an unusual, experimental game.
              </p>
            )}
          </fieldset>
          <fieldset>
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
          <button className="primary wide" onClick={() => setScreen("lobby")}>
            Continue to lobby →
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
            <span>Demo dictionary</span>
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
      <h1 className="sr-only">Squabble game board</h1>
      <header>
        <div className="brand small">
          <span>S</span>Squabble
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
      </header>
      <section className="play">
        <div className="toolbar">
          <b>● {current?.name}'s turn</b>
          <div>
            <button onClick={() => setCellSize(Math.max(26, cellSize - 4))}>
              −
            </button>
            <button
              onClick={() =>
                setCellSize(fittedCellSize(game.settings.boardSize))
              }
            >
              Fit
            </button>
            <button onClick={() => setCellSize(Math.min(58, cellSize + 4))}>
              +
            </button>
          </div>
        </div>
        <div className="board-scroll">
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
                    setMessage("Move reset — all tiles returned to your rack.");
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
              gridTemplateColumns: `repeat(${game.settings.boardSize},${cellSize}px)`,
            }}
            aria-label={`${game.settings.boardSize} square board`}
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
                    style={{ width: cellSize, height: cellSize }}
                    aria-label={
                      tile
                        ? `${draftError && pending ? "Invalid provisional tile, " : ""}${letter}, ${tile.value} points`
                        : cell.premium
                          ? premiumName[cell.premium]
                          : starts.has(`${r}:${c}`)
                            ? "Start"
                            : "Empty"
                    }
                    onClick={() => place(r, c)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const tileId = event.dataTransfer.getData("text/tile-id");
                      if (tileId) placeTile(tileId, r, c);
                    }}
                    disabled={cell.tile !== null}
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
        <div className="validator">
          <b>Demo validator</b>
          <small>
            Accepts any A–Z word locally. Words are not provider-verified.
          </small>
        </div>
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
          <button className="primary" disabled={!draft.length} onClick={submit}>
            Play word
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
      </aside>
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
        <span>S</span>Squabble
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
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
