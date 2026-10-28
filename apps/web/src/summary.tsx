import { useEffect, useState, type ReactNode } from "react";
import {
  createBoard,
  isSupportedBoardSize,
  type GameSummary,
  type SummaryMeaning,
  type SummaryPlay,
  type SummaryTile,
} from "@scrabble/game-engine";
import { api } from "./config.js";
import { defineWord, DICTIONARY_CREDIT } from "./dictionary.js";

/** "4.2s", "38s" or "2m 05s". */
export function tookText(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function endReasonText(reason: string | null): string {
  if (reason === "six-scoreless-turns")
    return "Finished after six scoreless turns.";
  if (reason === "ended-early") return "The host ended the game early.";
  if (reason === "players-left")
    return "Everyone else left, so the game ended early.";
  if (reason === "room-time-limit")
    return "The room's time limit was reached, so the scores are provisional.";
  return "Finished when a player emptied their rack.";
}

const dayText = (at: number) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);

/** A word's meaning: the stored one, else looked up now. */
function Meaning({
  word,
  stored,
}: {
  word: string;
  stored: SummaryMeaning | null | undefined;
}) {
  const [looked, setLooked] = useState<{
    word: string;
    meaning: SummaryMeaning | null;
  } | null>(null);
  useEffect(() => {
    if (stored !== undefined) return;
    let live = true;
    defineWord(word).then(
      (definition) => {
        const first = definition.found ? definition.senses[0] : undefined;
        if (live)
          setLooked({
            word,
            meaning: first
              ? {
                  partOfSpeech: first.partOfSpeech,
                  definition: first.definition,
                }
              : null,
          });
      },
      () => live && setLooked({ word, meaning: null }),
    );
    return () => {
      live = false;
    };
  }, [word, stored]);
  const meaning =
    stored !== undefined
      ? stored
      : looked?.word === word
        ? looked.meaning
        : undefined;
  if (meaning === undefined)
    return <p className="moment-meaning muted">Looking up {word}…</p>;
  if (meaning === null)
    return <p className="moment-meaning muted">No meaning on record.</p>;
  return (
    <p className="moment-meaning">
      {meaning.partOfSpeech && <i>{meaning.partOfSpeech}</i>}{" "}
      {meaning.definition}
    </p>
  );
}

function PlayDetail({ play }: { play: SummaryPlay }) {
  return (
    <small>
      {play.player} · turn {play.turn}
      {play.took !== null && ` · took ${tookText(play.took)}`}
      {play.words.length > 1 &&
        ` · also ${play.words.filter((word) => word !== play.word).join(", ")}`}
    </small>
  );
}

function Moment({
  play,
  meanings,
  value,
}: {
  play: SummaryPlay;
  meanings: GameSummary["meanings"];
  /** The figure on the right; points by default. */
  value?: string;
}) {
  return (
    <li className="moment">
      <div className="moment-head">
        <b>{play.word}</b>
        {play.bingo && <em className="moment-tag">Bingo +50</em>}
        {play.approved && (
          <em className="moment-tag approved">Approved on challenge</em>
        )}
        <strong>{value ?? `${play.score} pts`}</strong>
      </div>
      <PlayDetail play={play} />
      <Meaning word={play.word} stored={meanings[play.word]} />
    </li>
  );
}

/**
 * The leaderboard and the game's moments, in two tabs. Used on the results
 * screen and when a finished game is opened again later.
 */
export function GameSummaryView({
  summary,
  self,
}: {
  summary: GameSummary;
  /** The viewer's name, to mark their row. */
  self?: string | null | undefined;
}) {
  const [tab, setTab] = useState<"leaderboard" | "moments">("leaderboard");
  const { bestPlays, quickest, longest, bingos } = summary.moments,
    tabs = [
      { id: "leaderboard", label: "Leaderboard" },
      { id: "moments", label: "Moments" },
    ] as const;
  return (
    <section className="game-summary" aria-label="Game summary">
      <div
        className="rules-tabs"
        role="tablist"
        aria-label="Game summary"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft")
            setTab(tab === "leaderboard" ? "moments" : "leaderboard");
        }}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`summary-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="summary-panel"
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id="summary-panel"
        role="tabpanel"
        aria-labelledby={`summary-tab-${tab}`}
        className="summary-panel"
      >
        {tab === "leaderboard" ? (
          <div className="standings">
            {summary.players.map((player) => (
              <div
                key={player.name}
                className={player.name === self ? "self" : ""}
              >
                <span>{player.rank}</span>
                <b>
                  {player.name}
                  {player.name === self && " (you)"}
                  {player.left && " · Left"}
                  <small className="standing-detail">
                    {[
                      `${player.plays} play${player.plays === 1 ? "" : "s"}`,
                      player.best &&
                        `best ${player.best.word} ${player.best.score}`,
                      player.bingos > 0 &&
                        `${player.bingos} bingo${player.bingos === 1 ? "" : "s"}`,
                      player.averageMs !== null &&
                        `${tookText(player.averageMs)} a turn`,
                      player.adjustment !== 0 &&
                        `${player.adjustment > 0 ? "+" : "−"}${Math.abs(player.adjustment)} at the end`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </b>
                <strong>{player.score}</strong>
                <small>points</small>
              </div>
            ))}
          </div>
        ) : bestPlays.length === 0 ? (
          <p className="summary-empty">No words were played in this game.</p>
        ) : (
          <div className="moments">
            <h3>Best plays</h3>
            <ol>
              {bestPlays.map((play) => (
                <Moment
                  key={`best-${play.turn}`}
                  play={play}
                  meanings={summary.meanings}
                />
              ))}
            </ol>
            {quickest.length > 0 && (
              <>
                <h3>Quickest plays</h3>
                <ol>
                  {quickest.map((play) => (
                    <Moment
                      key={`quick-${play.turn}`}
                      play={play}
                      meanings={summary.meanings}
                      value={tookText(play.took ?? 0)}
                    />
                  ))}
                </ol>
              </>
            )}
            {longest && (
              <>
                <h3>Longest word</h3>
                <ol>
                  <Moment
                    play={longest}
                    meanings={summary.meanings}
                    value={`${longest.word.length} letters`}
                  />
                </ol>
              </>
            )}
            <h3>Bingos</h3>
            {bingos.length ? (
              <ol>
                {bingos.map((play) => (
                  <Moment
                    key={`bingo-${play.turn}`}
                    play={play}
                    meanings={summary.meanings}
                  />
                ))}
              </ol>
            ) : (
              <p className="summary-empty">
                Nobody used all seven tiles in one play.
              </p>
            )}
            <small className="summary-credit">{DICTIONARY_CREDIT}</small>
          </div>
        )}
      </div>
    </section>
  );
}

/** The board as the game ended, with every word that was played. */
export function FinalBoard({
  size,
  tiles,
}: {
  size: number;
  tiles: readonly SummaryTile[];
}) {
  if (!isSupportedBoardSize(size)) return null;
  const placed = new Map(
    tiles.map((tile) => [`${tile.row}:${tile.col}`, tile]),
  );
  return (
    <div
      className="admin-board final-board"
      style={{
        gridTemplateColumns: `repeat(${size}, 1fr)`,
        fontSize: `clamp(6px, ${Math.round(5000 / size) / 100}vw, 15px)`,
      }}
      role="img"
      aria-label={`The final board, with ${tiles.length} tile${tiles.length === 1 ? "" : "s"} placed`}
    >
      {createBoard(size).flatMap((row, r) =>
        row.map((cell, c) => {
          const tile = placed.get(`${r}:${c}`);
          return (
            <span
              key={`${r}:${c}`}
              className={
                tile
                  ? `tile${tile.blankAs ? " blank" : ""}`
                  : (cell.premium?.toLowerCase() ?? "")
              }
            >
              {tile ? (tile.blankAs ?? tile.letter ?? "") : ""}
            </span>
          );
        }),
      )}
    </div>
  );
}

/**
 * The end-of-game page: who won and why, the leaderboard and moments tabs,
 * the final board, then the page's own actions. The results screens and a
 * game opened again later all use it, so they look the same.
 */
export function ResultsPage({
  eyebrow,
  title,
  note,
  summary,
  self,
  before,
  children,
}: {
  eyebrow: string;
  title: string;
  note: ReactNode;
  summary: GameSummary | null;
  self?: string | null | undefined;
  /** Shown above the summary, such as the voice chat panel. */
  before?: ReactNode;
  /** The actions at the foot of the page. */
  children?: ReactNode;
}) {
  return (
    <main className="shell results results-page">
      <section className="card">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <div className="results-note">{note}</div>
        {before}
        {summary && (
          <>
            <GameSummaryView summary={summary} self={self} />
            <section className="final-board-section" aria-label="Final board">
              <h3>Final board</h3>
              {summary.tiles.length === 0 && (
                <p className="summary-empty">
                  No tiles were placed in this game.
                </p>
              )}
              <FinalBoard size={summary.boardSize} tiles={summary.tiles} />
            </section>
          </>
        )}
        <div className="results-actions">{children}</div>
      </section>
    </main>
  );
}

/** "Lin wins!", or "Ada and Lin tie!" */
export function winnerTitle(summary: GameSummary, past = false): string {
  const winners = summary.players.filter((player) => player.rank === 1);
  return winners.length > 1
    ? `${winners.map((player) => player.name).join(" and ")} tie${past ? "d" : ""}!`
    : `${winners[0]?.name ?? "Nobody"} ${past ? "won" : "wins"}!`;
}

/* Past games: kept on this device so a finished game can be opened again. */

export interface PastGame {
  key: string;
  code: string | null;
  endedAt: number;
  players: { name: string; score: number }[];
  /** Same-device games have no server copy, so the summary lives here. */
  summary?: GameSummary;
}
const PAST_KEY = "scrabble.pastGames",
  PAST_LIMIT = 20;

export function pastGames(): PastGame[] {
  try {
    const value = JSON.parse(localStorage.getItem(PAST_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter(
          (item): item is PastGame =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as PastGame).key === "string" &&
            typeof (item as PastGame).endedAt === "number" &&
            Array.isArray((item as PastGame).players),
        )
      : [];
  } catch {
    return [];
  }
}
/** Adds or refreshes a finished game in this device's list. */
export function rememberGame(summary: GameSummary) {
  const entry: PastGame = {
    key: summary.code ?? `device-${summary.endedAt}`,
    code: summary.code,
    endedAt: summary.endedAt,
    players: summary.players.map((player) => ({
      name: player.name,
      score: player.score,
    })),
    ...(summary.code === null ? { summary } : {}),
  };
  try {
    localStorage.setItem(
      PAST_KEY,
      JSON.stringify(
        [entry, ...pastGames().filter((item) => item.key !== entry.key)].slice(
          0,
          PAST_LIMIT,
        ),
      ),
    );
  } catch {
    // Storage full or blocked: the game just isn't listed.
  }
}
function forgetGame(key: string) {
  try {
    localStorage.setItem(
      PAST_KEY,
      JSON.stringify(pastGames().filter((item) => item.key !== key)),
    );
  } catch {
    // Nothing stored.
  }
}
function forgetGames() {
  try {
    localStorage.removeItem(PAST_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The "Past games" list on the welcome screen. */
export function PastGames({ onOpen }: { onOpen: (game: PastGame) => void }) {
  const [games, setGames] = useState(pastGames);
  if (!games.length) return null;
  return (
    <details className="past-games">
      <summary>Past games ({games.length})</summary>
      <ul>
        {games.map((game) => (
          <li key={game.key}>
            <button onClick={() => onOpen(game)}>
              <b>
                {[...game.players]
                  .sort((a, b) => b.score - a.score)
                  .map((player) => `${player.name} ${player.score}`)
                  .join(" · ")}
              </b>
              <small>
                {dayText(game.endedAt)} ·{" "}
                {game.code ? `Online ${game.code}` : "This device"}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <button
        className="link-button"
        onClick={() => {
          forgetGames();
          setGames([]);
        }}
      >
        Clear this list
      </button>
    </details>
  );
}

const isSummary = (value: unknown): value is GameSummary =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as GameSummary).version === "number" &&
  Array.isArray((value as GameSummary).players) &&
  typeof (value as GameSummary).moments === "object" &&
  typeof (value as GameSummary).meanings === "object";

export const summaryLink = (code: string) =>
  `${location.origin}${location.pathname}?game=${code}`;

/** A finished game opened again: by link (online) or from the device list. */
export function SummaryPage({
  code,
  stored,
  onBack,
}: {
  code: string | null;
  stored?: GameSummary | undefined;
  onBack: () => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; summary: GameSummary }
  >(() => (stored ? { kind: "ready", summary: stored } : { kind: "loading" }));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (stored || !code) return;
    let live = true;
    fetch(`${api}/api/games/${encodeURIComponent(code)}`)
      .then(async (response) => {
        const body = (await response.json()) as unknown;
        if (!live) return;
        if (response.ok && isSummary(body))
          setState({ kind: "ready", summary: body });
        else {
          // Deleted or expired: drop it from this device's Past games too.
          if (response.status === 404) forgetGame(code);
          setState({
            kind: "error",
            message:
              typeof body === "object" &&
              body !== null &&
              "error" in body &&
              typeof body.error === "string"
                ? body.error
                : "That game's summary could not be loaded.",
          });
        }
      })
      .catch(() => {
        if (live)
          setState({
            kind: "error",
            message:
              "Could not reach the game server. Check your connection and try again.",
          });
      });
    return () => {
      live = false;
    };
  }, [code, stored]);
  const summary = state.kind === "ready" ? state.summary : null;
  return (
    <ResultsPage
      eyebrow={code ? `Game ${code}` : "Game on this device"}
      title={
        summary
          ? winnerTitle(summary, true)
          : state.kind === "error"
            ? "Game not found"
            : "Loading the game…"
      }
      note={
        summary ? (
          <p>
            {endReasonText(summary.endReason)} {dayText(summary.endedAt)} ·{" "}
            {summary.boardSize}×{summary.boardSize} board · {summary.totalTurns}{" "}
            turns
          </p>
        ) : state.kind === "error" ? (
          <p role="status">{state.message}</p>
        ) : null
      }
      summary={summary}
    >
      {code && summary && (
        <button
          className="secondary wide"
          onClick={() => {
            void navigator.clipboard.writeText(summaryLink(code)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Link copied" : "Copy link to this summary"}
        </button>
      )}
      <button className="primary wide" onClick={onBack}>
        Back to the start
      </button>
    </ResultsPage>
  );
}
