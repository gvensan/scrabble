import { useEffect, useState } from "react";
import { BOARD_SIZE, maxPlayersFor, seatsFor } from "@scrabble/game-engine";

export interface LobbySettings {
  boardSize: number;
  /** 8 is "4+": as many as the board allows, up to eight. */
  capacity: 2 | 3 | 4 | 8;
  timerSeconds: 0 | 120 | 300;
  voice?: boolean | undefined;
}

const timerText = (seconds: number) =>
  seconds === 0 ? "no turn timer" : `${seconds / 60} min turns`;

/** "15×15 board · no turn timer · 2 seats · voice off" */
export function settingsText(settings: LobbySettings): string {
  return [
    `${settings.boardSize}×${settings.boardSize} board`,
    timerText(settings.timerSeconds),
    settings.capacity === 8
      ? `up to ${seatsFor(8, settings.boardSize)} players`
      : `${settings.capacity} seats`,
    `voice ${settings.voice ? "on" : "off"}`,
  ].join(" · ");
}

/**
 * The host's lobby editor for the room's settings. Seats cannot drop below
 * the players already here. Saving sends the changes; everyone sees them.
 */
export function RoomSettingsDialog({
  settings,
  players,
  onSave,
  onClose,
}: {
  settings: LobbySettings;
  /** Players already in the room: the fewest seats allowed. */
  players: number;
  onSave: (next: LobbySettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LobbySettings>({
    ...settings,
    voice: settings.voice === true,
  });
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const unchanged =
    draft.boardSize === settings.boardSize &&
    draft.capacity === settings.capacity &&
    draft.timerSeconds === settings.timerSeconds &&
    draft.voice === (settings.voice === true);
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-settings-title"
    >
      <div className="room-settings">
        <h2 id="room-settings-title">Room settings</h2>
        <p>Change anything before you start. Everyone in the room sees it.</p>
        <fieldset>
          <legend>Board size</legend>
          <div className="choices">
            {[15, 21, 32].map((size) => (
              <button
                key={size}
                className={draft.boardSize === size ? "active" : ""}
                aria-pressed={draft.boardSize === size}
                onClick={() => setDraft({ ...draft, boardSize: size })}
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
                value={draft.boardSize}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    boardSize: Math.min(
                      BOARD_SIZE.max,
                      Math.max(BOARD_SIZE.min, Number(event.target.value)),
                    ),
                  })
                }
              />
            </label>
          </div>
        </fieldset>
        <div className="settings-grid three">
          <fieldset>
            <legend>Players</legend>
            <div className="segments">
              {([2, 3, 4, 8] as const).map((value) => (
                <button
                  key={value}
                  className={draft.capacity === value ? "active" : ""}
                  aria-pressed={draft.capacity === value}
                  disabled={value < players}
                  title={
                    value < players
                      ? `${players} players are already here`
                      : value === 8
                        ? `More than four: up to ${maxPlayersFor(draft.boardSize)} on this board`
                        : undefined
                  }
                  onClick={() => setDraft({ ...draft, capacity: value })}
                >
                  {value === 8 ? "4+" : value}
                </button>
              ))}
            </div>
            {draft.capacity === 8 && (
              <small className="field-hint">
                Up to {maxPlayersFor(draft.boardSize)} players on this board.
              </small>
            )}
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
                  className={draft.timerSeconds === item.v ? "active" : ""}
                  aria-pressed={draft.timerSeconds === item.v}
                  onClick={() => setDraft({ ...draft, timerSeconds: item.v })}
                >
                  {item.l}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Voice chat</legend>
            <div className="segments">
              {([false, true] as const).map((value) => (
                <button
                  key={String(value)}
                  className={draft.voice === value ? "active" : ""}
                  aria-pressed={draft.voice === value}
                  onClick={() => setDraft({ ...draft, voice: value })}
                >
                  {value ? "On" : "Off"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {players > maxPlayersFor(draft.boardSize) && (
          <p className="notice">
            {players} players are here, but a {draft.boardSize}×
            {draft.boardSize} board has tiles for at most{" "}
            {maxPlayersFor(draft.boardSize)}. Choose a bigger board.
          </p>
        )}
        {(draft.boardSize < 11 || draft.boardSize > 21) && (
          <p className="notice">This creates an unusual, experimental game.</p>
        )}
        <div className="room-settings-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={unchanged || players > maxPlayersFor(draft.boardSize)}
            onClick={() => onSave(draft)}
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
