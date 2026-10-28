import { useEffect, useMemo, useState } from "react";
import { getOpeningCells } from "@scrabble/game-engine";
import {
  describeMove,
  formatDuration,
  turnSeconds,
  type HistoryMove,
} from "./panels.js";

type Premium = "TW" | "DW" | "TL" | "DL" | null;

const SPEEDS = [
  { label: "1×", ms: 1800 },
  { label: "2×", ms: 900 },
  { label: "4×", ms: 450 },
] as const;

/** True when every play in the history recorded where its tiles went. */
export function canReplay(moves: readonly HistoryMove[]): boolean {
  return (
    moves.length > 0 &&
    moves.every((move) => move.kind !== "play" || move.placed !== undefined)
  );
}

function cellSizeFor(boardSize: number): number {
  const compact = window.innerWidth <= 800,
    width = compact ? window.innerWidth - 40 : window.innerWidth - 470,
    height = compact ? window.innerHeight * 0.48 : window.innerHeight - 150;
  return Math.max(
    14,
    Math.min(40, Math.floor((Math.min(width, height) - 24) / boardSize) - 2),
  );
}

/**
 * Replays a finished game turn by turn on an empty copy of its board: who
 * moved, what they played, the score after each turn and the time it took.
 * The last step shows the final standings after end-of-game adjustments.
 */
export function ReplayDialog({
  boardSize,
  premiums,
  players,
  moves,
  startedAt,
  endNote,
  onClose,
}: {
  boardSize: number;
  premiums: readonly (readonly Premium[])[];
  players: readonly { name: string; finalScore: number }[];
  moves: readonly HistoryMove[];
  startedAt?: number | null | undefined;
  endNote: string;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(true),
    [speed, setSpeed] = useState(0),
    [cell, setCell] = useState(() => cellSizeFor(boardSize)),
    last = moves.length;
  useEffect(() => {
    const resize = () => setCell(cellSizeFor(boardSize));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [boardSize]);
  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setStep((value) => Math.min(last, value + 1)),
      SPEEDS[speed]?.ms ?? 1800,
    );
    return () => window.clearTimeout(timer);
  }, [playing, step, speed, last]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") {
        setPlaying(false);
        setStep((value) => Math.min(last, value + 1));
      } else if (event.key === "ArrowLeft") {
        setPlaying(false);
        setStep((value) => Math.max(0, value - 1));
      } else if (event.key === " ") {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onClose, last]);
  const starts = useMemo(
      () =>
        new Set(
          getOpeningCells(boardSize).map(({ row, col }) => `${row}:${col}`),
        ),
      [boardSize],
    ),
    tiles = useMemo(() => {
      const placed = new Map<
        string,
        { letter: string; value: number; fresh: boolean }
      >();
      moves.slice(0, step).forEach((move, index) => {
        for (const tile of move.placed ?? [])
          placed.set(`${tile.row}:${tile.col}`, {
            letter: tile.blankAs ?? tile.letter ?? "",
            value: tile.value,
            fresh: index === step - 1,
          });
      });
      return placed;
    }, [moves, step]),
    scores = players.map((_, index) =>
      moves
        .slice(0, step)
        .reduce(
          (sum, move) => sum + (move.player === index ? move.score : 0),
          0,
        ),
    ),
    move = step > 0 ? moves[step - 1] : undefined,
    took = step > 0 ? turnSeconds(moves, step - 1, startedAt) : null,
    finished = step === last,
    top = Math.max(...players.map((player) => player.finalScore)),
    winners = players.filter((player) => player.finalScore === top);
  const go = (value: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(last, value)));
  };
  return (
    <div
      className="overlay replay-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="replay-title"
    >
      <div className="replay">
        <header>
          <h2 id="replay-title">Game replay</h2>
          <button
            className="rules-close"
            aria-label="Close replay"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="replay-body">
          <div
            className="board replay-board"
            role="img"
            aria-label={`Board after turn ${step} of ${last}`}
            style={{
              gridTemplateColumns: `repeat(${boardSize},${cell}px)`,
              gridAutoRows: `${cell}px`,
              ["--replay-cell" as string]: `${cell}px`,
            }}
          >
            {premiums.flatMap((row, r) =>
              row.map((premium, c) => {
                const key = `${r}:${c}`,
                  tile = tiles.get(key);
                return (
                  <div
                    key={key}
                    className={`cell ${premium?.toLowerCase() ?? ""} ${starts.has(key) ? "start" : ""} ${tile?.fresh ? "replay-new" : ""}`}
                  >
                    {tile ? (
                      <>
                        <b>{tile.letter}</b>
                        <small>{tile.value}</small>
                      </>
                    ) : starts.has(key) ? (
                      <span className="start-star" aria-hidden="true">
                        ★
                      </span>
                    ) : (
                      premium
                    )}
                  </div>
                );
              }),
            )}
          </div>
          <aside className="replay-side">
            <div className="replay-turn" aria-live="polite">
              {move ? (
                <>
                  <small>
                    Turn {step} of {last}
                    {took !== null && ` · took ${formatDuration(took)}`}
                  </small>
                  <b>{move.name}</b>
                  <p>{describeMove(move.name, move)}</p>
                  {move.kind === "play" && (
                    <div className="history-words">
                      {move.words.map((item) => (
                        <span key={item.word}>
                          <b>{item.word}</b>
                          <small>{item.score}</small>
                        </span>
                      ))}
                      {move.tiles === 7 && <em>+50 bonus</em>}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <small>Start</small>
                  <b>Empty board</b>
                  <p>
                    {players.map((player) => player.name).join(", ")} take turns
                    in this order.
                  </p>
                </>
              )}
            </div>
            <ol className="replay-scores">
              {players.map((player, index) => (
                <li
                  key={`${player.name}-${index}`}
                  className={move?.player === index ? "active" : ""}
                >
                  <span>{player.name}</span>
                  {move?.player === index && move.score > 0 && (
                    <em>+{move.score}</em>
                  )}
                  <b>{finished ? player.finalScore : scores[index]}</b>
                </li>
              ))}
            </ol>
            {finished && (
              <div className="replay-final">
                <b>
                  {winners.length === 1
                    ? `${winners[0]?.name} wins`
                    : `Tie: ${winners.map((player) => player.name).join(" and ")}`}
                </b>
                <p>{endNote}</p>
                {players.some(
                  (player, index) => player.finalScore !== scores[index],
                ) && (
                  <small>
                    Final scores include leftover tile adjustments:{" "}
                    {players
                      .map((player, index) => {
                        const change = player.finalScore - (scores[index] ?? 0);
                        return `${player.name} ${change >= 0 ? "+" : ""}${change}`;
                      })
                      .join(", ")}
                    .
                  </small>
                )}
              </div>
            )}
            <input
              className="replay-scrub"
              type="range"
              min={0}
              max={last}
              value={step}
              aria-label="Replay position"
              onChange={(event) => go(Number(event.target.value))}
            />
            <div className="replay-controls">
              <button aria-label="Back to start" onClick={() => go(0)}>
                ⏮
              </button>
              <button aria-label="Previous turn" onClick={() => go(step - 1)}>
                ◀
              </button>
              <button
                className="primary"
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => {
                  if (!playing && step >= last) setStep(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Pause" : step >= last ? "Replay" : "Play"}
              </button>
              <button aria-label="Next turn" onClick={() => go(step + 1)}>
                ▶
              </button>
              <button aria-label="Jump to the end" onClick={() => go(last)}>
                ⏭
              </button>
            </div>
            <div className="segments replay-speed" aria-label="Replay speed">
              {SPEEDS.map((item, index) => (
                <button
                  key={item.label}
                  className={speed === index ? "active" : ""}
                  aria-pressed={speed === index}
                  onClick={() => setSpeed(index)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <small className="history-foot">
              Space plays or pauses, arrow keys step, Esc closes.
            </small>
          </aside>
        </div>
      </div>
    </div>
  );
}
