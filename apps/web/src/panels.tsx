import { useEffect, useState } from "react";
import type { PlayAnalysis } from "@scrabble/game-engine";
import {
  defineWord,
  DICTIONARY_CREDIT,
  type Definition,
} from "./dictionary.js";

export interface MoveSummary {
  kind: "play" | "pass" | "exchange" | "auto-pass" | "rejected";
  words: readonly { word: string; score: number }[];
  score: number;
  tiles: number;
  challenge?:
    | {
        outcome: "accepted" | "approved" | "rejected" | "expired";
        challenged: boolean;
      }
    | undefined;
}

/** How a rejected word was settled, as a short clause. */
export function settledHow(challenge: MoveSummary["challenge"]): string | null {
  if (!challenge) return null;
  if (challenge.outcome === "approved")
    return "approved by the host on challenge";
  if (challenge.outcome === "rejected")
    return "challenged, and the host upheld the rejection";
  if (challenge.outcome === "expired")
    return challenge.challenged
      ? "challenged, but the host did not rule in time"
      : "not accepted or challenged in time";
  return null;
}

const listWords = (words: readonly string[]) =>
  words.length < 2
    ? (words[0] ?? "A word")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;

export function describeMove(name: string, move: MoveSummary): string {
  const how = settledHow(move.challenge);
  if (move.kind === "play")
    return `${name} played ${move.words.map((item) => item.word).join(", ")} for ${move.score} point${move.score === 1 ? "" : "s"}${move.tiles === 7 ? ", including the 50 point bonus" : ""}${how ? ` (${how})` : ""}.`;
  if (move.kind === "exchange")
    return `${name} exchanged ${move.tiles} tile${move.tiles === 1 ? "" : "s"}.`;
  if (move.kind === "auto-pass")
    return `${name}'s turn was passed automatically.`;
  if (move.kind === "rejected")
    return `${name}'s play was rejected: ${listWords(move.words.map((item) => item.word))} ${move.words.length > 1 ? "aren't" : "isn't"} in the dictionary${how ? ` (${how})` : ""}. Turn lost, 0 points.`;
  return `${name} passed.`;
}

export function LastPlay({
  name,
  move,
  onHistory,
}: {
  name: string | null;
  move: MoveSummary | null;
  onHistory?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [move]);
  return (
    <section className="last-play" aria-label="Latest play">
      <div className="last-play-head">
        <p aria-live="polite">
          {move && name ? describeMove(name, move) : "No moves yet."}
        </p>
        {onHistory && (
          <button
            className="history-button"
            disabled={!move}
            onClick={onHistory}
            title="Move history"
          >
            History
          </button>
        )}
      </div>
      {move?.kind === "play" && (
        <>
          <div className="word-chips">
            {move.words.map((item) => (
              <button
                key={item.word}
                aria-expanded={open === item.word}
                onClick={() => setOpen(open === item.word ? null : item.word)}
              >
                <b>{item.word}</b>
                <small>{item.score}</small>
              </button>
            ))}
          </div>
          {open && <WordDefinition word={open} />}
        </>
      )}
    </section>
  );
}

function WordDefinition({ word }: { word: string }) {
  const [state, setState] = useState<{
    word: string;
    definition: Definition | null;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    let live = true;
    defineWord(word).then(
      (definition) => live && setState({ word, definition, failed: false }),
      () => live && setState({ word, definition: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [word]);
  const current = state?.word === word ? state : null;
  return (
    <div className="definition" role="region" aria-label={`Meaning of ${word}`}>
      {current === null ? (
        <small>Looking up {word}…</small>
      ) : current.definition?.found ? (
        <>
          <b>
            {word}
            {current.definition.phonetic && (
              <small> {current.definition.phonetic}</small>
            )}
          </b>
          <ol>
            {current.definition.senses.map((sense, index) => (
              <li key={index}>
                {sense.partOfSpeech && <i>{sense.partOfSpeech}</i>}{" "}
                {sense.definition}
              </li>
            ))}
          </ol>
          <small>{current.definition.attribution}</small>
        </>
      ) : (
        <small>
          {current.failed
            ? "The definition could not be loaded right now."
            : `No definition is available for ${word}. It still counts.`}
        </small>
      )}
    </div>
  );
}

export function ScorePreview({ analysis }: { analysis: PlayAnalysis | null }) {
  if (!analysis) return null;
  return (
    <p
      className={`score-preview ${analysis.ok ? "estimate" : "pending-shape"}`}
    >
      {analysis.ok ? (
        <>
          <span>Estimate, not checked yet</span>
          <b>≈ {analysis.score} pts</b>
          <small>
            If {analysis.words.map((item) => item.word).join(", ")}{" "}
            {analysis.words.length > 1 ? "are" : "is"} in the dictionary. Words
            are checked when you press Play; a refused word can be challenged.
          </small>
        </>
      ) : (
        <>
          <span>Not playable yet</span>
          <small>{analysis.error}</small>
        </>
      )}
    </p>
  );
}

type RulesTab = "turn" | "scoring" | "end" | "room";

const RULE_FACTS = [
  {
    value: "7",
    label: "Tiles on your rack",
    detail: "Your rack is topped back up to 7 after every play.",
  },
  {
    value: "+50",
    label: "Bonus for using all 7",
    detail: "Play every tile on your rack in a single turn.",
  },
  {
    value: "7+",
    label: "Tiles in the bag to exchange",
    detail: "With 6 or fewer left, you can only play or pass.",
  },
  {
    value: "6",
    label: "Scoreless turns end the game",
    detail:
      "Six in a row from any player: passes, exchanges, timeouts or rejected words.",
  },
] as const;

const TURN_ACTIONS = [
  {
    icon: "▶",
    name: "Play a word",
    detail:
      "One row or column, no gaps. The first word covers the star; later words touch the board.",
  },
  {
    icon: "⇄",
    name: "Exchange",
    detail:
      "Swap any of your tiles for new ones, as often as you like, while 7 or more remain in the bag. Scores 0.",
  },
  {
    icon: "⏭",
    name: "Pass",
    detail: "Skip your turn. Scores 0.",
  },
] as const;

const BONUSES = [
  { square: "dl", label: "DL", effect: "Letter ×2" },
  { square: "tl", label: "TL", effect: "Letter ×3" },
  { square: "dw", label: "DW", effect: "Word ×2" },
  { square: "tw", label: "TW", effect: "Word ×3" },
] as const;

const ROOM_RULES = {
  online: [
    ["Private rack", "Only you see your tiles. They unlock on your turn."],
    [
      "Live tiles",
      "Everyone sees the tiles you try on the board as you place them, before you play.",
    ],
    ["Server checked", "Every play is checked and scored by the server."],
    [
      "Host",
      "Starts the game, can lock the room and can end the game early. No joining mid-game.",
    ],
    ["Turn timer", "When it runs out, your turn is passed automatically."],
    [
      "Disconnects",
      "You rejoin the same seat. After 3 minutes away, your turns are passed. If everyone drops, the clock pauses.",
    ],
    ["Leaving", "Gives up your seat. Under two players left ends the game."],
    ["Room time", "4 hours at most, then scores are shown as provisional."],
    [
      "Voice chat",
      "The host can turn it on or off at any time. Tap the mic to join. Audio goes straight between players and is never recorded.",
    ],
  ],
  local: [
    [
      "Pass the device",
      "The next rack stays hidden until that player is ready.",
    ],
    ["Turn timer", "When it runs out, the turn is passed automatically."],
    [
      "End game",
      "Stops the game early. Leftover tiles count against each player.",
    ],
    ["Not saved", "Games on one device are not recorded."],
  ],
} as const;

/**
 * The rules of play and of this app, opened from the ? button in the game
 * header. `mode` picks the room tab that applies to the current board.
 */
export function RulesDialog({
  mode,
  onClose,
}: {
  mode: "local" | "online";
  onClose: () => void;
}) {
  const [tab, setTab] = useState<RulesTab>("turn");
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const tabs: readonly { id: RulesTab; label: string }[] = [
    { id: "turn", label: "Your turn" },
    { id: "scoring", label: "Scoring" },
    { id: "end", label: "Game end" },
    { id: "room", label: mode === "online" ? "Online" : "This device" },
  ];
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="rules-dialog">
        <header>
          <h2 id="rules-title">Rules of play</h2>
          <button
            className="rules-close"
            aria-label="Close rules"
            autoFocus
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <dl className="rules-facts">
          {RULE_FACTS.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.value}</dt>
              <dd>
                <b>{fact.label}</b>
                <small>{fact.detail}</small>
              </dd>
            </div>
          ))}
        </dl>
        <div
          className="rules-tabs"
          role="tablist"
          aria-label="Rule topics"
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowRight"
                ? 1
                : event.key === "ArrowLeft"
                  ? -1
                  : 0;
            if (!step) return;
            const index = tabs.findIndex((item) => item.id === tab),
              next = tabs[(index + step + tabs.length) % tabs.length];
            if (!next) return;
            setTab(next.id);
            document.getElementById(`rules-tab-${next.id}`)?.focus();
          }}
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`rules-tab-${item.id}`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls="rules-panel"
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          className="rules-panel"
          id="rules-panel"
          role="tabpanel"
          aria-labelledby={`rules-tab-${tab}`}
        >
          {tab === "turn" && (
            <>
              <p className="rules-lead">
                Do one of three things. Each ends your turn.
              </p>
              <ul className="rules-cards">
                {TURN_ACTIONS.map((action) => (
                  <li key={action.name}>
                    <span aria-hidden="true">{action.icon}</span>
                    <div>
                      <b>{action.name}</b>
                      <small>{action.detail}</small>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="rules-note">
                Every word is checked against the WordSoHard word list (not an
                official tournament lexicon) when you press Play. The points
                shown before you play are only an estimate.{" "}
                <b>If a word is refused, play pauses:</b> accept it and lose
                your turn (0 points, tiles back on your rack), or challenge it
                (up to 3 times a game) and the host rules, after checking
                Collins if they like. An approved play scores normally and the
                word counts for the rest of the game. Each step has 60 seconds,
                then the rejection stands. If the dictionary can't be reached,
                you keep your turn and can try again.
              </p>
            </>
          )}
          {tab === "scoring" && (
            <>
              <p className="rules-lead">
                Bonuses count only on squares you cover this turn.
              </p>
              <ul className="rules-bonuses">
                {BONUSES.map((bonus) => (
                  <li key={bonus.label}>
                    <span
                      className={`bonus-chip ${bonus.square}`}
                      aria-hidden="true"
                    >
                      {bonus.label}
                    </span>
                    {bonus.effect}
                  </li>
                ))}
              </ul>
              <ul className="rules-list">
                <li>
                  <b>Every new word scores</b>, including words formed across
                  letters already on the board.
                </li>
                <li>
                  <b>Word bonuses stack:</b> two DW squares in one word make it
                  ×4.
                </li>
                <li>
                  <b>Blanks</b> can be any letter and are worth 0, but word
                  bonuses still apply.
                </li>
                <li>
                  <b>All 7 tiles</b> in one play adds 50 points.
                </li>
              </ul>
            </>
          )}
          {tab === "end" && (
            <>
              <p className="rules-lead">A game ends in one of three ways.</p>
              <ul className="rules-cards">
                <li>
                  <span aria-hidden="true">🏁</span>
                  <div>
                    <b>Someone goes out</b>
                    <small>
                      The bag is empty and a player uses their last tile. Others
                      lose the value of their leftover tiles; the player who
                      went out gains it all.
                    </small>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true">⏸</span>
                  <div>
                    <b>Six scoreless turns in a row</b>
                    <small>
                      Passes, exchanges, timed-out turns and rejected words,
                      across all players. Everyone loses the value of their own
                      leftover tiles.
                    </small>
                  </div>
                </li>
                <li>
                  <span aria-hidden="true">✋</span>
                  <div>
                    <b>
                      {mode === "online"
                        ? "The host ends it early"
                        : "You press End game"}
                    </b>
                    <small>
                      Scored the same way: everyone loses the value of their own
                      leftover tiles, and the highest total wins.
                    </small>
                  </div>
                </li>
              </ul>
              <p className="rules-note">
                Afterwards everyone sees the results: a leaderboard, the
                game&apos;s best and quickest plays with their meanings, and the
                final board.{" "}
                {mode === "online"
                  ? "Its link keeps working for 180 days, and Past games on the start screen lists it."
                  : "Past games on the start screen keeps it on this device."}
              </p>
            </>
          )}
          {tab === "room" && (
            <dl className="rules-terms">
              {ROOM_RULES[mode].map(([term, detail]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <small>{DICTIONARY_CREDIT}</small>
        <button className="primary wide" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

/**
 * Key to the bonus squares, drawn on the board canvas: a column beside the
 * board when there is room, otherwise a strip under it (see styles.css).
 */
export function BoardLegend() {
  return (
    <section className="board-legend" aria-label="Board key">
      <ul>
        {BONUSES.map((bonus) => (
          <li key={bonus.label}>
            <span className={`bonus-chip ${bonus.square}`} aria-hidden="true">
              {bonus.label}
            </span>
            <small>{bonus.effect}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface HistoryMove extends MoveSummary {
  name: string;
  /** Seat order of the player who moved. */
  player: number;
  /** Where a play put its tiles; needed for replay. */
  placed?:
    | readonly {
        row: number;
        col: number;
        letter: string | null;
        blankAs?: string | undefined;
        value: number;
      }[]
    | undefined;
  /** When the turn ended (epoch ms); missing on moves recorded before timing existed. */
  at?: number | undefined;
  /** How long the player spent on the turn (ms). */
  took?: number | undefined;
}

/** A turn length as m:ss, to the nearest second (countdowns round up instead). */
export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

/**
 * Seconds a player spent on `moves[index]`: the recorded duration, or for
 * moves stamped before durations existed the gap since the previous move.
 */
export function turnSeconds(
  moves: readonly HistoryMove[],
  index: number,
  startedAt?: number | null,
): number | null {
  const move = moves[index];
  if (move?.took !== undefined) return move.took / 1000;
  const begun = index === 0 ? startedAt : moves[index - 1]?.at;
  return move?.at !== undefined && typeof begun === "number"
    ? (move.at - begun) / 1000
    : null;
}

function moveLabel(move: HistoryMove) {
  if (move.kind === "play")
    return (
      <span className="history-words">
        {move.words.map((item) => (
          <span key={item.word}>
            <b>{item.word}</b>
            <small>{item.score}</small>
          </span>
        ))}
        {move.tiles === 7 && <em>+50 bonus</em>}
        {move.challenge?.outcome === "approved" && (
          <em className="history-approved">approved on challenge</em>
        )}
      </span>
    );
  if (move.kind === "exchange")
    return (
      <span className="history-quiet">
        Exchanged {move.tiles} tile{move.tiles === 1 ? "" : "s"}
      </span>
    );
  if (move.kind === "auto-pass")
    return <span className="history-quiet">Timed out (auto pass)</span>;
  if (move.kind === "rejected")
    return (
      <span className="history-rejected">
        Rejected: {move.words.map((item) => item.word).join(", ")}
        {move.challenge?.challenged && <small> · challenged</small>}
      </span>
    );
  return <span className="history-quiet">Passed</span>;
}

/**
 * Every finished turn, newest first, with each turn's points, the player's
 * running total and how long the turn took. Escape or a click outside closes it.
 */
export function HistoryDialog({
  moves,
  startedAt,
  onClose,
}: {
  moves: readonly HistoryMove[];
  startedAt?: number | null | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const totals = new Map<string, number>(),
    rows = moves.map((move, index) => {
      const total = (totals.get(move.name) ?? 0) + move.score;
      totals.set(move.name, total);
      return {
        move,
        turn: index + 1,
        total,
        took: turnSeconds(moves, index, startedAt),
      };
    }),
    players = [...totals.keys()].map((name) => {
      const own = rows.filter((row) => row.move.name === name),
        timed = own.flatMap((row) => (row.took === null ? [] : [row.took])),
        best = own.reduce<(typeof own)[number] | null>(
          (top, row) =>
            row.move.kind === "play" && row.move.score > (top?.move.score ?? 0)
              ? row
              : top,
          null,
        );
      return {
        name,
        total: totals.get(name) ?? 0,
        average: timed.length
          ? timed.reduce((sum, value) => sum + value, 0) / timed.length
          : null,
        best: best
          ? `${best.move.words[0]?.word ?? ""} ${best.move.score}`
          : null,
      };
    });
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="history-dialog">
        <header>
          <h2 id="history-title">Move history</h2>
          <button
            className="rules-close"
            aria-label="Close move history"
            autoFocus
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {moves.length === 0 ? (
          <p className="history-quiet">No moves yet.</p>
        ) : (
          <>
            <ul className="history-players">
              {players.map((player) => (
                <li key={player.name}>
                  <b>{player.name}</b>
                  <span>
                    {player.total} pts
                    {player.average !== null &&
                      ` · avg ${formatDuration(player.average)} per turn`}
                    {player.best && ` · best ${player.best}`}
                  </span>
                </li>
              ))}
            </ul>
            <div className="history-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Player</th>
                    <th scope="col">Move</th>
                    <th scope="col">Pts</th>
                    <th scope="col">Total</th>
                    <th scope="col">Took</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((row) => (
                    <tr key={row.turn}>
                      <td>{row.turn}</td>
                      <td>{row.move.name}</td>
                      <td>{moveLabel(row.move)}</td>
                      <td className={row.move.score ? "" : "history-quiet"}>
                        {row.move.score}
                      </td>
                      <td>{row.total}</td>
                      <td>
                        {row.took === null ? "-" : formatDuration(row.took)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small className="history-foot">
              Newest first. Took is how long the player spent on that turn; a
              dash marks moves made before turn timing was recorded. Totals
              exclude end-of-game tile adjustments.
            </small>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Opened by the Exchange button: explains the cost, lets the player pick the
 * tiles to swap and confirms in one step. When the bag is too low it explains
 * why exchanging is not allowed instead.
 */
export function ExchangeDialog({
  rack,
  bagCount,
  onCancel,
  onConfirm,
}: {
  rack: readonly { id: string; letter: string | null; value: number }[];
  bagCount: number;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel]);
  const allowed = bagCount >= 7,
    all = ids.length === rack.length;
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exchange-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="exchange-dialog">
        <h2 id="exchange-title">
          {allowed ? "Exchange tiles?" : "Can't exchange now"}
        </h2>
        {allowed ? (
          <>
            <p>
              Pick the tiles to swap for new ones from the bag. This uses your
              turn and scores 0.
            </p>
            <div className="exchange-rack" role="group" aria-label="Your tiles">
              {rack.map((tile) => {
                const chosen = ids.includes(tile.id);
                return (
                  <button
                    key={tile.id}
                    aria-pressed={chosen}
                    aria-label={`${tile.letter ?? "Blank"}, ${tile.value} points`}
                    className={chosen ? "active" : ""}
                    onClick={() =>
                      setIds(
                        chosen
                          ? ids.filter((id) => id !== tile.id)
                          : [...ids, tile.id],
                      )
                    }
                  >
                    <b>{tile.letter ?? "□"}</b>
                    <small>{tile.value}</small>
                  </button>
                );
              })}
            </div>
            <button
              className="link-button"
              onClick={() => setIds(all ? [] : rack.map((tile) => tile.id))}
            >
              {all ? "Clear selection" : "Select all"}
            </button>
            <div className="actions">
              <button className="secondary" autoFocus onClick={onCancel}>
                Keep my tiles
              </button>
              <button
                className="danger"
                disabled={!ids.length}
                onClick={() => onConfirm(ids)}
              >
                {ids.length
                  ? `Exchange ${ids.length} tile${ids.length === 1 ? "" : "s"}`
                  : "Pick tiles"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              Only {bagCount} tile{bagCount === 1 ? " is" : "s are"} left in the
              bag. Exchanging needs at least 7, so play a word or pass instead.
            </p>
            <button className="primary wide" autoFocus onClick={onCancel}>
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Six scoreless turns in a row end the game. */
export const SCORELESS_LIMIT = 6;

/** Shown once a game is close to ending on scoreless turns. */
export function ScorelessWarning({ count }: { count: number }) {
  if (count < SCORELESS_LIMIT - 2 || count >= SCORELESS_LIMIT) return null;
  const left = SCORELESS_LIMIT - count;
  return (
    <p className="scoreless-warning" role="status">
      <b>
        {count} scoreless turns in a row: the game ends after {left} more.
      </b>{" "}
      Passes, exchanges, timeouts and rejected words all count. Any scoring play
      resets it.
    </p>
  );
}

/**
 * Explains a game that ended on six scoreless turns before the results:
 * the turns that did it and what each player's leftover tiles cost them.
 */
export function ScorelessEndDialog({
  turns,
  players,
  onOk,
}: {
  turns: readonly { name: string; move: MoveSummary }[];
  players: readonly { name: string; moveTotal: number; final: number }[];
  onOk: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") onOk();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onOk]);
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scoreless-title"
    >
      <div className="scoreless-end">
        <p className="eyebrow">Game over</p>
        <h2 id="scoreless-title">Six scoreless turns in a row</h2>
        <p>
          Nobody scored for six turns running, so the game ended for everyone,
          as the rules say.
        </p>
        <ol className="scoreless-turns">
          {turns.map((turn, index) => (
            <li key={index}>{describeMove(turn.name, turn.move)}</li>
          ))}
        </ol>
        <p>Each player loses the value of the tiles left on their rack:</p>
        <ul className="scoreless-adjust">
          {players.map((player) => {
            const change = player.final - player.moveTotal;
            return (
              <li key={player.name}>
                <b>{player.name}</b>
                <span>
                  {player.moveTotal} {change < 0 ? "−" : "+"} {Math.abs(change)}{" "}
                  = <strong>{player.final}</strong>
                </span>
              </li>
            );
          })}
        </ul>
        <button className="primary wide" autoFocus onClick={onOk}>
          OK, see the results
        </button>
      </div>
    </div>
  );
}
