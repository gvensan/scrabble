import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PublicLastMove,
  PublicRoom,
} from "@scrabble/game-engine/protocol";

export interface Notice {
  id: number;
  tone: "info" | "good" | "bad";
  text: string;
}
type NoticeDraft = Omit<Notice, "id">;

const AUTO_DISMISS_MS = 6_000;

const listWords = (words: readonly string[]) =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;

function moveNotice(
  move: PublicLastMove,
  name: string,
  self: boolean,
  host: string,
): NoticeDraft {
  const words = listWords(move.words.map((item) => item.word)),
    points = `${move.score} point${move.score === 1 ? "" : "s"}`,
    whose = self ? "your" : `${name}'s`,
    who = self ? "You" : name;
  const outcome = move.challenge?.outcome;
  if (outcome === "approved")
    return {
      tone: "good",
      text: `${host} approved ${words} on challenge: ${who} ${self ? "score" : "scores"} ${points}.`,
    };
  if (outcome === "rejected")
    return {
      tone: "bad",
      text: `${host} upheld the rejection of ${words}: ${whose} turn is lost.`,
    };
  if (outcome === "expired")
    return {
      tone: "bad",
      text: move.challenge?.challenged
        ? `Time ran out before ${host} ruled on ${words}, so the rejection stands: ${whose} turn is lost.`
        : `Time ran out to accept or challenge ${words}, so the rejection stands: ${whose} turn is lost.`,
    };
  if (outcome === "accepted")
    return {
      tone: "bad",
      text: `${who} accepted the rejection of ${words}: ${whose} turn is lost.`,
    };
  if (move.kind === "play")
    return {
      tone: "info",
      text: `${who} played ${words} for ${points}${move.tiles === 7 ? ", with the 50 point bonus" : ""}.`,
    };
  if (move.kind === "exchange")
    return {
      tone: "info",
      text: `${who} exchanged ${move.tiles} tile${move.tiles === 1 ? "" : "s"}.`,
    };
  if (move.kind === "auto-pass")
    return {
      tone: "info",
      text: `${self ? "Your" : `${name}'s`} turn was passed automatically.`,
    };
  if (move.kind === "rejected")
    return { tone: "bad", text: `${whose} play was rejected.` };
  return { tone: "info", text: `${who} passed.` };
}

/**
 * The notifications every player sees for one room change, worked out from
 * the previous and the new snapshot so all browsers agree. Nothing is shown
 * for the first snapshot after (re)connecting.
 */
export function roomNotices(
  before: PublicRoom | null,
  after: PublicRoom,
  selfId: string | null,
): NoticeDraft[] {
  if (before?.roomCode !== after.roomCode) return [];
  const notices: NoticeDraft[] = [],
    name = (id: string | null) =>
      after.players.find((player) => player.id === id)?.nickname ?? "A player",
    hostPlayer = after.players.find((player) => player.host),
    host =
      hostPlayer?.id === selfId
        ? "You (host)"
        : (hostPlayer?.nickname ?? "The host");
  const earlier = before.history?.length ?? 0;
  for (const move of (after.history ?? []).slice(earlier))
    notices.push(
      moveNotice(move, name(move.playerId), move.playerId === selfId, host),
    );
  const scoreless = after.scorelessTurns ?? 0;
  if (
    after.phase === "active" &&
    scoreless >= 4 &&
    scoreless < 6 &&
    scoreless > (before.scorelessTurns ?? 0)
  )
    notices.push({
      tone: "bad",
      text: `Heads up: ${scoreless} scoreless turns in a row. The game ends after ${6 - scoreless} more.`,
    });
  const challenge = after.challenge;
  if (
    challenge?.stage === "review" &&
    before.challenge?.stage === "decide" &&
    before.challenge.playerId === challenge.playerId
  )
    notices.push({
      tone: "info",
      text:
        hostPlayer?.id === challenge.playerId
          ? `${challenge.playerId === selfId ? "You" : name(challenge.playerId)} challenged ${listWords(challenge.rejected)} and, as host, ${challenge.playerId === selfId ? "rule" : "will rule"} on it.`
          : `${challenge.playerId === selfId ? "You" : name(challenge.playerId)} challenged ${listWords(challenge.rejected)}. ${hostPlayer?.id === selfId ? "You rule on it as host." : `${hostPlayer?.nickname ?? "The host"} will rule on it.`}`,
    });
  for (const player of after.players) {
    const previous = before.players.find((item) => item.id === player.id);
    if (!previous)
      notices.push({
        tone: "info",
        text: `${player.nickname} joined the room.`,
      });
    else if (player.left && !previous.left)
      notices.push({ tone: "info", text: `${player.nickname} left the game.` });
    if (
      previous &&
      player.host &&
      !previous.host &&
      after.phase === before.phase
    )
      notices.push({
        tone: "info",
        text: `${player.id === selfId ? "You are" : `${player.nickname} is`} now the host.`,
      });
  }
  const changed = [
    before.settings.boardSize !== after.settings.boardSize &&
      `${after.settings.boardSize}×${after.settings.boardSize} board`,
    before.settings.timerSeconds !== after.settings.timerSeconds &&
      (after.settings.timerSeconds === 0
        ? "no turn timer"
        : `${after.settings.timerSeconds / 60} min turns`),
    before.settings.capacity !== after.settings.capacity &&
      (after.settings.capacity === 8
        ? "more than four players"
        : `${after.settings.capacity} seats`),
  ].filter(Boolean);
  if (changed.length && after.phase === "lobby")
    notices.push({
      tone: "info",
      text: `${hostPlayer?.id === selfId ? "You" : (hostPlayer?.nickname ?? "The host")} changed the room settings: ${changed.join(", ")}.`,
    });
  if ((before.settings.voice === true) !== (after.settings.voice === true))
    notices.push({
      tone: "info",
      text:
        after.settings.voice === true
          ? "The host turned voice chat on. Tap the mic to join."
          : "The host turned voice chat off.",
    });
  if (before.locked !== after.locked && after.phase === "lobby")
    notices.push({
      tone: "info",
      text: after.locked
        ? "The host locked the room. Nobody new can join."
        : "The host unlocked the room.",
    });
  return notices;
}

/** A queue of notifications that close on × or after a few seconds. */
export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]),
    nextId = useRef(1),
    timers = useRef(new Map<number, number>());
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setNotices((list) => list.filter((notice) => notice.id !== id));
  }, []);
  const push = useCallback(
    (drafts: readonly NoticeDraft[]) => {
      if (!drafts.length) return;
      const added = drafts.map((draft) => ({ ...draft, id: nextId.current++ }));
      for (const notice of added)
        timers.current.set(
          notice.id,
          window.setTimeout(() => dismiss(notice.id), AUTO_DISMISS_MS),
        );
      // Keep the stack short; the oldest go first.
      setNotices((list) => [...list, ...added].slice(-4));
    },
    [dismiss],
  );
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);
  return { notices, push, dismiss };
}

export function NoticeStack({
  notices,
  onDismiss,
}: {
  notices: readonly Notice[];
  onDismiss: (id: number) => void;
}) {
  if (!notices.length) return null;
  return (
    <div className="notice-stack" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice ${notice.tone}`}>
          <span>{notice.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => onDismiss(notice.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
