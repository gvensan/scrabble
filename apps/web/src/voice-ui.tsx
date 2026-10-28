import { useEffect, useRef, useState } from "react";
import type { GameSounds } from "./sound.js";
import type { VoiceSession, VoiceSnapshot } from "./voice.js";

interface Player {
  id: string;
  nickname: string;
}

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {off && (
        <path
          d="M4 4l16 16"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
function SpeakerIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        d="M4 9h4l5-4v14l-5-4H4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {off ? (
        <path
          d="M17 9l5 6M22 9l-5 6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

const nameOf = (players: readonly Player[], id: string) =>
  players.find((player) => player.id === id)?.nickname ?? "A player";

/** "Ada is speaking", "Ada and Lin are speaking", or null when it's quiet. */
export function speakingText(
  voice: VoiceSnapshot | null,
  players: readonly Player[],
  selfId: string | null,
): string | null {
  if (!voice?.speaking.size) return null;
  const names = players
    .filter((player) => voice.speaking.has(player.id))
    .map((player) => (player.id === selfId ? "You" : player.nickname));
  if (!names.length) return null;
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list} ${names.length === 1 && names[0] !== "You" ? "is" : "are"} speaking`;
}

/** The mic glyph shown next to a player's name for voice rooms. */
export function VoiceBadge({
  voice,
  playerId,
}: {
  voice: VoiceSnapshot | null;
  playerId: string;
}) {
  const peer = voice?.peers.find((item) => item.playerId === playerId);
  if (!voice || !peer) return null;
  const failed = voice.links.get(playerId) === "failed";
  return (
    <span
      className={`voice-badge ${peer.muted ? "muted" : ""} ${failed ? "failed" : ""}`}
      title={
        failed
          ? "Can't reach this player's voice"
          : peer.muted
            ? "Microphone muted"
            : "In voice chat"
      }
    >
      <MicIcon off={peer.muted || failed} />
    </span>
  );
}

function joinLabel(voice: VoiceSnapshot) {
  return voice.status === "joining"
    ? "Starting the microphone…"
    : voice.status === "denied" || voice.status === "error"
      ? "Try joining voice chat again"
      : "Join voice chat";
}

/**
 * The sound controls in the turn card. Without voice it is the old single
 * game-sounds toggle; with voice it is a mic button (join, then mute) and a
 * speaker button that opens settings for voices and game sounds. The host
 * always gets the settings menu, since it holds the room's voice switch.
 */
export function SoundControls({
  voice,
  session,
  sounds,
  players,
  selfId,
  onHostVoice,
}: {
  voice: VoiceSnapshot | null;
  session: VoiceSession | null;
  sounds: GameSounds;
  players: readonly Player[];
  selfId: string | null;
  /** Set for the host only: turns voice chat on or off for the room. */
  onHostVoice?: ((enabled: boolean) => void) | undefined;
}) {
  const [open, setOpen] = useState(false),
    menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
        if (!menu.current?.contains(event.target as Node)) setOpen(false);
      },
      escape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (!voice && !onHostVoice)
    return (
      <button
        onClick={sounds.toggleMuted}
        aria-pressed={sounds.muted}
        aria-label={sounds.muted ? "Turn sounds on" : "Mute game sounds"}
        title={sounds.muted ? "Turn sounds on" : "Mute game sounds"}
      >
        {sounds.muted ? "🔇" : "🔊"}
      </button>
    );
  const joined = voice?.status === "on",
    speakerOff = voice ? voice.speakerOff : sounds.muted,
    allQuiet = speakerOff && sounds.muted;
  return (
    <div className="sound-controls" ref={menu}>
      {voice &&
        voice.status !== "unsupported" &&
        (joined ? (
          <button
            className={`mic-button ${voice.muted ? "muted" : "live"} ${selfId && voice.speaking.has(selfId) ? "speaking" : ""}`}
            aria-pressed={voice.muted}
            aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}
            title={voice.muted ? "Unmute microphone" : "Mute microphone"}
            onClick={() => session?.setMuted(!voice.muted)}
          >
            <MicIcon off={voice.muted} />
          </button>
        ) : (
          <button
            className="mic-button join"
            aria-label={joinLabel(voice)}
            title={voice.error ?? joinLabel(voice)}
            disabled={voice.status === "joining"}
            onClick={() => void session?.join()}
          >
            <MicIcon />
          </button>
        ))}
      <button
        className={allQuiet ? "muted" : ""}
        aria-label="Sound settings"
        aria-haspopup="true"
        aria-expanded={open}
        title="Sound settings"
        onClick={() => setOpen(!open)}
      >
        <SpeakerIcon off={speakerOff} />
      </button>
      {open && (
        <div className="sound-menu" role="group" aria-label="Sound settings">
          {onHostVoice && (
            <label className="host-voice">
              <input
                type="checkbox"
                checked={voice !== null}
                onChange={(event) => onHostVoice(event.target.checked)}
              />
              <span>
                <b>Voice chat for this room</b>
                <small>
                  {voice
                    ? "Turning it off ends the call for everyone."
                    : "Lets every player join a live call. Nobody's mic starts until they join."}
                </small>
              </span>
            </label>
          )}
          {voice && (
            <label>
              <input
                type="checkbox"
                checked={!voice.speakerOff}
                onChange={(event) =>
                  session?.setSpeakerOff(!event.target.checked)
                }
              />
              <span>
                <b>Voices</b>
                <small>Hear the other players</small>
              </span>
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={!sounds.muted}
              onChange={sounds.toggleMuted}
            />
            <span>
              <b>Game sounds</b>
              <small>Turn chimes and timer warnings</small>
            </span>
          </label>
          {voice && (
            <>
              <VoiceStatusLines
                voice={voice}
                players={players}
                selfId={selfId}
              />
              {voice.status === "unsupported" ? null : joined ? (
                <button className="secondary" onClick={() => session?.leave()}>
                  Leave voice chat
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={voice.status === "joining"}
                  onClick={() => void session?.join()}
                >
                  {joinLabel(voice)}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Who is in the call and how each connection is doing. */
function VoiceStatusLines({
  voice,
  players,
  selfId,
}: {
  voice: VoiceSnapshot;
  players: readonly Player[];
  selfId: string | null;
}) {
  if (voice.status === "unsupported")
    return <p className="voice-note">This browser can't do voice chat.</p>;
  const others = voice.peers.filter((peer) => peer.playerId !== selfId);
  return (
    <div className="voice-lines" aria-live="polite">
      {voice.error && <p className="voice-note error">{voice.error}</p>}
      {voice.status === "on" && !others.length && (
        <p className="voice-note">Nobody else has joined voice yet.</p>
      )}
      {voice.status !== "on" && (
        <p className="voice-note">
          {others.length
            ? `In voice: ${others.map((peer) => nameOf(players, peer.playerId)).join(", ")}.`
            : "Nobody is in voice yet."}
        </p>
      )}
      {voice.status === "on" &&
        others.map((peer) => {
          const state = voice.links.get(peer.playerId) ?? "connecting";
          return (
            <p key={peer.playerId} className={`voice-line ${state}`}>
              <b>{nameOf(players, peer.playerId)}</b>
              <span>
                {state === "connected"
                  ? peer.muted
                    ? "Connected, muted"
                    : "Connected"
                  : state === "failed"
                    ? "Can't connect; a strict network may block calls"
                    : "Connecting…"}
              </span>
            </p>
          );
        })}
    </div>
  );
}

/** The voice block on the lobby and results screens. */
export function VoicePanel({
  voice,
  session,
  players,
  selfId,
}: {
  voice: VoiceSnapshot | null;
  session: VoiceSession | null;
  players: readonly Player[];
  selfId: string | null;
}) {
  if (!voice) return null;
  const joined = voice.status === "on";
  return (
    <section className="voice-panel" aria-label="Voice chat">
      <div>
        <b>Voice chat is on for this room</b>
        <small>
          {joined
            ? voice.muted
              ? "You're in, with your microphone muted."
              : "You're in. Everyone in voice can hear you."
            : "Talk while you play. Your microphone starts only when you join; nothing is recorded."}
        </small>
      </div>
      <div className="voice-panel-actions">
        {voice.status === "unsupported" ? null : joined ? (
          <>
            <button
              className="secondary"
              aria-pressed={voice.muted}
              onClick={() => session?.setMuted(!voice.muted)}
            >
              <MicIcon off={voice.muted} />
              {voice.muted ? "Unmute" : "Mute"}
            </button>
            <button className="secondary" onClick={() => session?.leave()}>
              Leave voice
            </button>
          </>
        ) : (
          <button
            className="primary"
            disabled={voice.status === "joining"}
            onClick={() => void session?.join()}
          >
            <MicIcon />
            {voice.status === "joining" ? "Starting…" : "Join voice"}
          </button>
        )}
      </div>
      <VoiceStatusLines voice={voice} players={players} selfId={selfId} />
      {voice.blocked && (
        <button className="link-button" onClick={() => session?.unblock()}>
          Tap to hear the other players
        </button>
      )}
    </section>
  );
}
