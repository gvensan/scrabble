import { useCallback, useEffect, useRef, useState } from "react";

export type GameCue = "turn" | "timer-start" | "warning" | "error" | "time-up";
export interface GameSounds {
  muted: boolean;
  play: (cue: GameCue) => void;
  toggleMuted: () => void;
}

export function formatClock(seconds: number): string {
  const bounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(bounded / 60)}:${String(bounded % 60).padStart(2, "0")}`;
}

const patterns: Record<
  GameCue,
  readonly {
    frequency: number;
    offset: number;
    duration: number;
    gain: number;
  }[]
> = {
  turn: [
    { frequency: 523, offset: 0, duration: 0.12, gain: 0.045 },
    { frequency: 659, offset: 0.1, duration: 0.16, gain: 0.05 },
  ],
  "timer-start": [
    { frequency: 440, offset: 0, duration: 0.1, gain: 0.035 },
    { frequency: 554, offset: 0.09, duration: 0.13, gain: 0.04 },
  ],
  warning: [
    { frequency: 740, offset: 0, duration: 0.08, gain: 0.045 },
    { frequency: 740, offset: 0.13, duration: 0.08, gain: 0.045 },
  ],
  error: [
    { frequency: 220, offset: 0, duration: 0.13, gain: 0.05 },
    { frequency: 175, offset: 0.11, duration: 0.2, gain: 0.055 },
  ],
  "time-up": [
    { frequency: 330, offset: 0, duration: 0.12, gain: 0.05 },
    { frequency: 262, offset: 0.12, duration: 0.16, gain: 0.055 },
    { frequency: 196, offset: 0.27, duration: 0.25, gain: 0.06 },
  ],
};

export function useGameSounds(): GameSounds {
  const [muted, setMuted] = useState(
    () => localStorage.getItem("scrabble.sound-muted") === "true",
  );
  const mutedRef = useRef(muted);
  const contextRef = useRef<AudioContext | null>(null);

  const unlock = useCallback(() => {
    contextRef.current ??= new AudioContext({ latencyHint: "interactive" });
    if (contextRef.current.state === "suspended")
      void contextRef.current.resume();
  }, []);

  useEffect(() => {
    const activate = () => unlock();
    window.addEventListener("pointerdown", activate, { once: true });
    window.addEventListener("keydown", activate, { once: true });
    return () => {
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
      void contextRef.current?.close();
    };
  }, [unlock]);

  const play = useCallback((cue: GameCue) => {
    if (mutedRef.current || !contextRef.current) return;
    const context = contextRef.current;
    const start = context.currentTime + 0.01;
    for (const tone of patterns[cue]) {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      const toneStart = start + tone.offset;
      oscillator.type =
        cue === "error" || cue === "time-up" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
      volume.gain.setValueAtTime(0.0001, toneStart);
      volume.gain.exponentialRampToValueAtTime(tone.gain, toneStart + 0.01);
      volume.gain.exponentialRampToValueAtTime(
        0.0001,
        toneStart + tone.duration,
      );
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + tone.duration + 0.02);
    }
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      mutedRef.current = next;
      localStorage.setItem("scrabble.sound-muted", String(next));
      if (!next) unlock();
      return next;
    });
  }, [unlock]);

  return { muted, play, toggleMuted };
}
