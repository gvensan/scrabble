import { formatClock } from "./sound.js";

/** Challenges each player may make in one game. */
export const MAX_CHALLENGES = 3;
/** The official tournament word list, for players to check a refused word. */
export const COLLINS_URL = "https://scrabble.collinsdictionary.com/check/";

const listWords = (words: readonly string[]) =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;

/**
 * Opens the Collins checker. It has no link format for a single word, so
 * the word is copied as well, ready to paste into its search box.
 */
export function CollinsLink({ words }: { words: readonly string[] }) {
  const label = listWords(words);
  return (
    <a
      className="collins-link"
      href={COLLINS_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={`Opens the Collins Scrabble word checker. ${label} is copied so you can paste it there.`}
      onClick={() => {
        void navigator.clipboard
          .writeText(words.join(" "))
          .catch(() => undefined);
      }}
    >
      Check {label} on Collins ↗
    </a>
  );
}

function Countdown({ deadline, now }: { deadline: number; now: number }) {
  const left = Math.max(0, deadline - now);
  return (
    <strong
      className={`challenge-clock ${left <= 15_000 ? "urgent" : ""}`}
      title="When this runs out, the rejection stands"
    >
      {formatClock(left / 1000)}
    </strong>
  );
}

export interface ChallengeView {
  stage: "decide" | "review";
  rejected: readonly string[];
  /** Whose play it is, for other players' wording. */
  playerName: string;
  /** Who rules on a challenge: "Ada (host)", "you (as host)" or "everyone at the table". */
  ruler: string;
  deadline: number | null;
  challengesLeft: number;
}

/**
 * The paused-game notice after a rejected word. It cannot be closed: the
 * game waits until the player accepts or challenges and, if challenged,
 * until the ruling. `mine` gives the player the buttons.
 */
export function ChallengeNotice({
  view,
  mine,
  now,
  variant,
  onAccept,
  onChallenge,
}: {
  view: ChallengeView;
  mine: boolean;
  now: number;
  variant: "board" | "side";
  onAccept?: (() => void) | undefined;
  onChallenge?: (() => void) | undefined;
}) {
  const words = listWords(view.rejected),
    plural = view.rejected.length > 1,
    deciding = view.stage === "decide";
  const title = deciding
    ? mine
      ? `Word rejected: ${words}`
      : `${view.playerName}'s word ${words} was rejected`
    : mine
      ? `You challenged ${words}`
      : `${view.playerName} challenged ${words}`;
  const text = deciding
    ? mine
      ? `${words} ${plural ? "aren't" : "isn't"} in the WordSoHard word list. Accept and lose this turn, or challenge it and ${view.ruler} will decide.`
      : `Play is paused while ${view.playerName} accepts the rejection or challenges it.`
    : `Play is paused while ${view.ruler} ${view.ruler.startsWith("you") || view.ruler.startsWith("everyone") ? "rule" : "rules"} on it. If approved, the play counts; if not, the turn is lost.`;
  return (
    <div
      className={`challenge-notice ${variant} ${view.stage}`}
      role={variant === "board" ? "alert" : "status"}
    >
      <div className="challenge-head">
        <b>{title}</b>
        {view.deadline !== null && (
          <Countdown deadline={view.deadline} now={now} />
        )}
      </div>
      <span>{text}</span>
      <CollinsLink words={view.rejected} />
      {mine && deciding && (
        <div className="challenge-actions">
          <button className="secondary" onClick={onAccept}>
            Accept · lose turn
          </button>
          <button
            className="primary"
            disabled={view.challengesLeft === 0}
            title={
              view.challengesLeft === 0
                ? "You have used all your challenges this game"
                : `You can challenge ${view.challengesLeft} more time${view.challengesLeft === 1 ? "" : "s"} this game`
            }
            onClick={onChallenge}
          >
            {view.challengesLeft === 0
              ? "No challenges left"
              : `Challenge (${view.challengesLeft} left)`}
          </button>
        </div>
      )}
    </div>
  );
}

type Premium = "TW" | "DW" | "TL" | "DL" | null;
interface BoardTileView {
  letter: string | null;
  blankAs?: string | undefined;
  value: number;
}

/** A small picture of the board with the challenged play highlighted. */
function MiniBoard({
  board,
  placed,
}: {
  board: readonly (readonly {
    premium: Premium;
    tile: BoardTileView | null;
  }[])[];
  placed: readonly ({ row: number; col: number } & BoardTileView)[];
}) {
  const size = board.length,
    fresh = new Map(placed.map((tile) => [`${tile.row}:${tile.col}`, tile])),
    cell = Math.max(
      9,
      Math.floor(Math.min(340, window.innerWidth - 72) / Math.max(size, 1)),
    );
  return (
    <div
      className="mini-board"
      role="img"
      aria-label={`The board with the challenged tiles highlighted`}
      style={{
        gridTemplateColumns: `repeat(${size},${cell}px)`,
        gridAutoRows: `${cell}px`,
        fontSize: `${Math.max(7, Math.round(cell * 0.55))}px`,
      }}
    >
      {board.flatMap((row, r) =>
        row.map((square, c) => {
          const tile = fresh.get(`${r}:${c}`) ?? square.tile,
            highlighted = fresh.has(`${r}:${c}`);
          return (
            <span
              key={`${r}:${c}`}
              className={`${tile ? "tile" : (square.premium?.toLowerCase() ?? "")} ${highlighted ? "challenged" : ""}`}
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
 * The ruling popup: who played what, the board with the play highlighted,
 * the words and what they would score, and Approve or Reject.
 */
export function ChallengeReview({
  view,
  words,
  score,
  board,
  placed,
  now,
  onApprove,
  onReject,
}: {
  view: ChallengeView;
  words: readonly { word: string; score: number }[];
  score: number;
  board: readonly (readonly {
    premium: Premium;
    tile: BoardTileView | null;
  }[])[];
  placed: readonly ({ row: number; col: number } & BoardTileView)[];
  now: number;
  onApprove: () => void;
  onReject: () => void;
}) {
  const refused = new Set(view.rejected),
    label = listWords(view.rejected);
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-title"
    >
      <div className="challenge-review">
        <header>
          <div>
            <p className="eyebrow">Challenge</p>
            <h2 id="challenge-title">
              {view.playerName} challenged {label}
            </h2>
          </div>
          {view.deadline !== null && (
            <Countdown deadline={view.deadline} now={now} />
          )}
        </header>
        <p>
          The WordSoHard word list refused {label}. Check it on Collins, the
          official tournament list, then rule. Everyone sees your decision.
        </p>
        <MiniBoard board={board} placed={placed} />
        <ul className="challenge-words">
          {words.map((item) => (
            <li
              key={item.word}
              className={refused.has(item.word) ? "refused" : ""}
            >
              <b>{item.word}</b>
              <small>{refused.has(item.word) ? "refused" : "accepted"}</small>
              <span>{item.score} pts</span>
            </li>
          ))}
        </ul>
        <CollinsLink words={view.rejected} />
        <p className="challenge-stakes">
          Approve:{" "}
          {view.playerName === "You"
            ? "you score"
            : `${view.playerName} scores`}{" "}
          {score} point{score === 1 ? "" : "s"} and {label} counts for the rest
          of this game. Reject: the turn is lost.
        </p>
        <div className="challenge-actions">
          <button className="secondary" onClick={onReject}>
            Reject
          </button>
          <button className="primary" onClick={onApprove}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
