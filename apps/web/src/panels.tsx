import { useEffect, useState } from "react";
import type { PlayAnalysis } from "@squabble/game-engine";
import {
  defineWord,
  DICTIONARY_CREDIT,
  type Definition,
} from "./dictionary.js";

export interface MoveSummary {
  kind: "play" | "pass" | "exchange" | "auto-pass";
  words: readonly { word: string; score: number }[];
  score: number;
  tiles: number;
}

export function describeMove(name: string, move: MoveSummary): string {
  if (move.kind === "play")
    return `${name} played ${move.words.map((item) => item.word).join(", ")} for ${move.score} point${move.score === 1 ? "" : "s"}${move.tiles === 7 ? ", including the 50 point bonus" : ""}.`;
  if (move.kind === "exchange")
    return `${name} exchanged ${move.tiles} tile${move.tiles === 1 ? "" : "s"}.`;
  if (move.kind === "auto-pass")
    return `${name}'s turn was passed automatically.`;
  return `${name} passed.`;
}

export function LastPlay({
  name,
  move,
}: {
  name: string | null;
  move: MoveSummary | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [move]);
  return (
    <section className="last-play" aria-label="Latest play">
      <p aria-live="polite">
        {move && name ? describeMove(name, move) : "No moves yet."}
      </p>
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
    <p className={`score-preview ${analysis.ok ? "" : "pending-shape"}`}>
      {analysis.ok ? (
        <>
          <span>Estimate</span>
          <b>{analysis.score} pts</b>
          <small>
            {analysis.words.map((item) => item.word).join(", ")} · final once
            the play is accepted
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

/** The rules and dictionary note, opened from the ? button in the game header. */
export function RulesDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
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
        <h2 id="rules-title">Rules and dictionary</h2>
        <ul>
          <li>
            Place tiles in one row or column with no gaps. The first word must
            cover the star; later words must touch the board.
          </li>
          <li>
            Every new word scores. Letter and word bonuses count only on newly
            covered squares; using all seven tiles adds 50 points.
          </li>
          <li>
            Blanks can be any letter and score zero. Exchanging needs at least
            seven tiles in the bag.
          </li>
          <li>
            Six scoreless turns in a row end the game. Otherwise it ends when
            the bag is empty and a player uses their last tile; leftover tiles
            count against their holders.
          </li>
          <li>
            Every word is checked against the WordSoHard word list, which is not
            an official tournament lexicon.
          </li>
        </ul>
        <small>{DICTIONARY_CREDIT}</small>
        <button className="primary wide" autoFocus onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
