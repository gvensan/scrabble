import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminGame,
  AdminMove,
  AdminOverview,
  AdminPlayer,
  AdminRoom,
  AdminRoomDetail,
} from "@squabble/game-engine/protocol";
import { api } from "./config.js";

const TOKEN_KEY = "squabble.admin";
const REFRESH_MS = 20_000;
type Tab = "rooms" | "games" | "activity" | "players";

const endReasons: Record<string, string> = {
  "rack-emptied": "Rack emptied",
  "six-scoreless-turns": "Six scoreless turns",
  "players-left": "Players left",
  "room-time-limit": "Room time limit",
  abandoned: "Abandoned",
  finished: "Finished",
};
const closeReasons: Record<string, string> = {
  emptied: "Everyone left",
  expired: "Expired",
  abandoned: "Nobody connected",
};
const metricLabels: [string, string][] = [
  ["rooms_created", "Rooms created"],
  ["players_joined", "Players joined"],
  ["games_started", "Games started"],
  ["games_finished", "Games ended"],
  ["plays", "Words played"],
  ["words_rejected", "Words rejected"],
  ["dictionary_errors", "Dictionary errors"],
  ["rate_limited", "Rate limited"],
];

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? __DEV_ADMIN_TOKEN__;
  } catch {
    return __DEV_ADMIN_TOKEN__;
  }
}
function storeToken(value: string) {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private windows may refuse storage; the token then lasts for this view.
  }
}
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
function when(time: number | null) {
  if (time === null) return "-";
  return new Date(time).toDateString() === new Date().toDateString()
    ? `Today ${timeOnly.format(time)}`
    : dateTime.format(time);
}
function ago(time: number, now: number) {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
function duration(ms: number | null) {
  if (ms === null) return "-";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1 min";
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
const timer = (seconds: number) =>
  seconds === 0 ? "Untimed" : `${seconds / 60} min`;
const ranked = (players: readonly AdminPlayer[]) =>
  [...players].sort((a, b) => b.score - a.score);

function csv(games: readonly AdminGame[]) {
  const cell = (value: string | number) =>
    /[",\n]/.test(String(value))
      ? `"${String(value).replaceAll('"', '""')}"`
      : String(value);
  const rows = [
    [
      "ended",
      "room",
      "duration_min",
      "board",
      "timer",
      "players",
      "winners",
      "winning_score",
      "end_reason",
      "turns",
      "plays",
      "best_play",
    ],
    ...games.map((game) => [
      new Date(game.endedAt).toISOString(),
      game.roomCode,
      Math.round((game.endedAt - game.startedAt) / 60_000),
      `${game.boardSize}x${game.boardSize}`,
      timer(game.timerSeconds),
      ranked(game.players)
        .map((player) => `${player.nickname} ${player.score}`)
        .join("; "),
      game.winners.join("; "),
      game.winningScore,
      endReasons[game.endReason] ?? game.endReason,
      game.turns,
      game.plays,
      game.bestPlay ? `${game.bestPlay.word} ${game.bestPlay.score}` : "",
    ]),
  ];
  const blob = new Blob(
      [rows.map((row) => row.map(cell).join(",")).join("\n")],
      {
        type: "text/csv",
      },
    ),
    link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `squabble-games-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function AdminPage() {
  const [token, setToken] = useState(readToken),
    [draft, setDraft] = useState(""),
    [data, setData] = useState<AdminOverview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [auto, setAuto] = useState(true),
    [tab, setTab] = useState<Tab>("rooms"),
    [notice, setNotice] = useState(""),
    [openRoom, setOpenRoom] = useState<string | null>(null),
    [roomNotice, setRoomNotice] = useState("");

  const signOut = useCallback((message = "") => {
    storeToken("");
    setToken("");
    setData(null);
    setError(message);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${api}/api/admin/overview`, {
          headers: { authorization: `Bearer ${token}` },
        }),
        body = (await response.json()) as AdminOverview & { error?: string };
      if (response.status === 401) signOut(body.error ?? "Sign in again.");
      else if (!response.ok) setError(body.error ?? "The overview failed.");
      else {
        setData(body);
        setError("");
      }
    } catch {
      setError("Could not reach the game server.");
    } finally {
      setLoading(false);
    }
  }, [token, signOut]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!auto || !token) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, token, load]);

  async function resetLimits() {
    try {
      const response = await fetch(`${api}/api/admin/rate-limits/reset`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        }),
        body = (await response.json()) as { cleared?: number; error?: string };
      setNotice(
        response.ok
          ? `Cleared ${body.cleared ?? 0} rate limit record${body.cleared === 1 ? "" : "s"}.`
          : (body.error ?? "Could not clear rate limits."),
      );
      void load();
    } catch {
      setNotice("Could not reach the game server.");
    }
  }

  if (!token)
    return (
      <main className="admin admin-gate">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            const value = draft.trim();
            if (!value) return;
            storeToken(value);
            setToken(value);
            setDraft("");
            setError("");
          }}
        >
          <p className="eyebrow">Squabble admin</p>
          <h1>Sign in</h1>
          <label className="field">
            <span>Admin token</span>
            <input
              type="password"
              autoComplete="current-password"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
          </label>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <small>
            The token is the Worker&apos;s ADMIN_TOKEN value. It is kept only
            for this browser tab. The local dev server signs in automatically.
          </small>
          <div className="admin-gate-actions">
            <a className="secondary" href="#/">
              Back to game
            </a>
            <button className="primary">Open dashboard</button>
          </div>
        </form>
      </main>
    );

  return (
    <main className="admin">
      <header className="admin-head">
        <div>
          <p className="eyebrow">Squabble admin</p>
          <h1>Rooms and games</h1>
          <small aria-live="polite">
            {data
              ? `Updated ${timeOnly.format(data.generatedAt)}`
              : loading
                ? "Loading…"
                : ""}
          </small>
        </div>
        <div className="admin-controls">
          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={auto}
              onChange={(event) => setAuto(event.target.checked)}
            />
            Auto refresh
          </label>
          <button
            className="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
          <button className="secondary" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <Totals data={data} />
          <nav className="admin-tabs" aria-label="Admin sections">
            {(
              [
                ["rooms", `Rooms (${data.rooms.length})`],
                ["games", `Past games (${data.games.length})`],
                ["activity", "Activity"],
                ["players", "Players"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                aria-pressed={tab === id}
                onClick={() => {
                  setTab(id);
                  setOpenRoom(null);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "rooms" &&
            (openRoom ? (
              <RoomDetail
                code={openRoom}
                token={token}
                auto={auto}
                onBack={() => setOpenRoom(null)}
                onDeleted={(code) => {
                  setOpenRoom(null);
                  setRoomNotice(
                    `Room ${code} was deleted and its players were disconnected.`,
                  );
                  void load();
                }}
                onSignedOut={signOut}
              />
            ) : (
              <Rooms
                rooms={data.rooms}
                now={data.generatedAt}
                notice={roomNotice}
                onOpen={(code) => {
                  setRoomNotice("");
                  setOpenRoom(code);
                }}
              />
            ))}
          {tab === "games" && <Games games={data.games} />}
          {tab === "activity" && (
            <Activity
              data={data}
              notice={notice}
              onReset={() => void resetLimits()}
            />
          )}
          {tab === "players" && <Players data={data} />}
        </>
      )}
    </main>
  );
}

function Totals({ data }: { data: AdminOverview }) {
  const t = data.totals;
  const tiles: [string, string, (string | undefined)?][] = [
    ["Lobbies open", String(t.lobbies)],
    ["Games in play", String(t.activeGames)],
    ["Players connected", String(t.playersOnline)],
    ["Rooms today", String(t.roomsToday), "UTC day"],
    ["Games ended today", String(t.gamesToday)],
    ["Games recorded", String(t.gamesRecorded), "last 180 days"],
    ["Average game", duration(t.averageDurationMs)],
    [
      "Average winning score",
      t.averageWinningScore === null ? "-" : String(t.averageWinningScore),
    ],
    [
      "Top score",
      t.highestScore ? String(t.highestScore.score) : "-",
      t.highestScore
        ? `${t.highestScore.nickname} in ${t.highestScore.roomCode}`
        : undefined,
    ],
    [
      "Best single play",
      t.bestPlay ? `${t.bestPlay.score}` : "-",
      t.bestPlay ? `${t.bestPlay.word} by ${t.bestPlay.by}` : undefined,
    ],
  ];
  return (
    <section className="admin-tiles" aria-label="Totals">
      {tiles.map(([label, value, note]) => (
        <div key={label}>
          <span>{label}</span>
          <b>{value}</b>
          {note && <small>{note}</small>}
        </div>
      ))}
    </section>
  );
}

/** Live rooms show presence; finished games show final scores. */
function PlayerList({
  players,
  final = false,
  scores = true,
}: {
  players: readonly AdminPlayer[];
  final?: boolean;
  scores?: boolean;
}) {
  return (
    <ul className={`admin-players${final ? " final" : ""}`}>
      {players.map((player) => (
        <li
          key={player.nickname}
          className={player.left ? "left" : player.connected ? "here" : ""}
          title={
            player.left
              ? "Left the game"
              : final
                ? undefined
                : player.connected
                  ? "Connected"
                  : "Offline"
          }
        >
          {player.nickname}
          {player.host && !final && <small> host</small>}
          {scores && <b> {player.score}</b>}
        </li>
      ))}
    </ul>
  );
}

function Rooms({
  rooms,
  now,
  notice,
  onOpen,
}: {
  rooms: AdminRoom[];
  now: number;
  notice: string;
  onOpen: (code: string) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const shown = rooms.filter((room) => showClosed || room.status !== "closed");
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <p>
          Open rooms, newest activity first. Select a room for its players,
          words and scores, or to delete it. Closed rooms from the last 24 hours
          are kept for reference.
        </p>
        <label className="admin-toggle">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(event) => setShowClosed(event.target.checked)}
          />
          Show closed
        </label>
      </div>
      {notice && (
        <p className="admin-note" role="status">
          {notice}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="admin-empty">No rooms right now.</p>
      ) : (
        <div
          className="admin-table"
          tabIndex={0}
          role="region"
          aria-label="Rooms table"
        >
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Status</th>
                <th>Players</th>
                <th>Seats</th>
                <th>Board</th>
                <th>Timer</th>
                <th>Turn</th>
                <th>Words</th>
                <th>Bag</th>
                <th>Created</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((room) => (
                <tr
                  key={`${room.roomCode}-${room.createdAt}`}
                  className="admin-row-link"
                  onClick={() => onOpen(room.roomCode)}
                >
                  <td>
                    {/* The row handles the click; the button gives keyboard
                        and screen reader users the same way in. */}
                    <button
                      className="admin-link"
                      aria-label={`Open room ${room.roomCode}`}
                    >
                      {room.roomCode}
                    </button>
                  </td>
                  <td>
                    <StatusBadge room={room} />
                    {room.locked && room.status === "lobby" && (
                      <small> locked</small>
                    )}
                  </td>
                  <td>
                    <PlayerList
                      players={room.players}
                      scores={room.startedAt !== null}
                    />
                  </td>
                  <td>
                    {room.players.length}/{room.capacity}
                  </td>
                  <td>
                    {room.boardSize}×{room.boardSize}
                  </td>
                  <td>{timer(room.timerSeconds)}</td>
                  <td>{room.startedAt === null ? "-" : room.turnNumber}</td>
                  <td>{room.plays}</td>
                  <td>{room.startedAt === null ? "-" : room.bagRemaining}</td>
                  <td>{when(room.createdAt)}</td>
                  <td>{ago(room.updatedAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Games({ games }: { games: AdminGame[] }) {
  const [query, setQuery] = useState(""),
    [includeAbandoned, setIncludeAbandoned] = useState(true);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return games.filter(
      (game) =>
        (includeAbandoned || game.endReason !== "abandoned") &&
        (!needle ||
          game.roomCode.toLocaleLowerCase().includes(needle) ||
          game.players.some((player) =>
            player.nickname.toLocaleLowerCase().includes(needle),
          )),
    );
  }, [games, query, includeAbandoned]);
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <input
          className="admin-search"
          type="search"
          placeholder="Filter by player or room code"
          aria-label="Filter games"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="admin-toggle">
          <input
            type="checkbox"
            checked={includeAbandoned}
            onChange={(event) => setIncludeAbandoned(event.target.checked)}
          />
          Include abandoned
        </label>
        <button
          className="secondary"
          onClick={() => csv(shown)}
          disabled={shown.length === 0}
        >
          Export CSV
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="admin-empty">
          {games.length
            ? "No games match."
            : "No online games have finished yet. Same-device games stay on the device and are not recorded."}
        </p>
      ) : (
        <div
          className="admin-table"
          tabIndex={0}
          role="region"
          aria-label="Past games table"
        >
          <table>
            <thead>
              <tr>
                <th>Ended</th>
                <th>Room</th>
                <th>Participants</th>
                <th>Winner</th>
                <th>Score</th>
                <th>Margin</th>
                <th>Length</th>
                <th>Board</th>
                <th>Turns</th>
                <th>Best play</th>
                <th>Ending</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((game) => {
                const order = ranked(game.players),
                  runnerUp = order.find(
                    (player) => !game.winners.includes(player.nickname),
                  );
                return (
                  <tr key={`${game.roomCode}-${game.endedAt}`}>
                    <td>{when(game.endedAt)}</td>
                    <td>
                      <code>{game.roomCode}</code>
                    </td>
                    <td>
                      <PlayerList players={order} final />
                    </td>
                    <td>
                      <b>{game.winners.join(", ") || "-"}</b>
                      {game.winners.length > 1 && <small> tie</small>}
                    </td>
                    <td>{game.winningScore}</td>
                    <td>
                      {runnerUp ? game.winningScore - runnerUp.score : "-"}
                    </td>
                    <td>{duration(game.endedAt - game.startedAt)}</td>
                    <td>
                      {game.boardSize}×{game.boardSize}
                      <small> {timer(game.timerSeconds)}</small>
                    </td>
                    <td>{game.turns}</td>
                    <td>
                      {game.bestPlay ? (
                        <>
                          {game.bestPlay.word} <b>{game.bestPlay.score}</b>
                          <small> {game.bestPlay.by}</small>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{endReasons[game.endReason] ?? game.endReason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Activity({
  data,
  notice,
  onReset,
}: {
  data: AdminOverview;
  notice: string;
  onReset: () => void;
}) {
  const days = [...data.daily].reverse();
  return (
    <section className="admin-panel">
      <div className="admin-limits">
        <div>
          <b>Limits per network</b>
          <small>
            {data.limits.roomsPerHour} new rooms per hour,{" "}
            {data.limits.joinsPer10Min} join attempts per 10 minutes.
            {data.rateLimited.length
              ? ` ${data.rateLimited.length} network${data.rateLimited.length === 1 ? " is" : "s are"} blocked now: ${data.rateLimited
                  .map(
                    (item) =>
                      `${item.kind === "create" ? "room creation" : "joining"} until ${timeOnly.format(item.resetsAt)}`,
                  )
                  .join(", ")}.`
              : " Nobody is blocked right now."}
          </small>
        </div>
        <button className="secondary" onClick={onReset}>
          Clear rate limits
        </button>
      </div>
      {notice && <p className="admin-note">{notice}</p>}
      <div
        className="admin-table"
        tabIndex={0}
        role="region"
        aria-label="Daily activity table"
      >
        <table>
          <thead>
            <tr>
              <th>Day (UTC)</th>
              {metricLabels.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <td>{day.day}</td>
                {metricLabels.map(([key]) => (
                  <td key={key} className={day.metrics[key] ? "" : "zero"}>
                    {day.metrics[key] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Players({ data }: { data: AdminOverview }) {
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <p>
          Grouped by nickname across recorded games. Nicknames are not accounts,
          so two people using the same name count as one.
        </p>
      </div>
      {data.leaders.length === 0 ? (
        <p className="admin-empty">No finished games yet.</p>
      ) : (
        <div
          className="admin-table"
          tabIndex={0}
          role="region"
          aria-label="Players table"
        >
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Nickname</th>
                <th>Games</th>
                <th>Wins</th>
                <th>Win rate</th>
                <th>Best score</th>
                <th>Average score</th>
              </tr>
            </thead>
            <tbody>
              {data.leaders.map((leader, index) => (
                <tr key={leader.nickname}>
                  <td>{index + 1}</td>
                  <td>
                    <b>{leader.nickname}</b>
                  </td>
                  <td>{leader.games}</td>
                  <td>{leader.wins}</td>
                  <td>{Math.round((leader.wins / leader.games) * 100)}%</td>
                  <td>{leader.bestScore}</td>
                  <td>{Math.round(leader.totalScore / leader.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const moveLabel: Record<AdminMove["kind"], string> = {
  play: "Played",
  pass: "Passed",
  exchange: "Exchanged",
  "auto-pass": "Timed out",
};

function StatusBadge({ room }: { room: AdminRoom }) {
  return (
    <span className={`admin-status ${room.status}`}>
      {room.status === "closed"
        ? (closeReasons[room.closeReason ?? ""] ?? "Closed")
        : room.status === "results"
          ? "Finished"
          : room.status === "active"
            ? "In play"
            : "Lobby"}
    </span>
  );
}

function RoomDetail({
  code,
  token,
  auto,
  onBack,
  onDeleted,
  onSignedOut,
}: {
  code: string;
  token: string;
  auto: boolean;
  onBack: () => void;
  onDeleted: (code: string) => void;
  onSignedOut: (message: string) => void;
}) {
  const [detail, setDetail] = useState<AdminRoomDetail | null>(null),
    [error, setError] = useState(""),
    [confirming, setConfirming] = useState(false),
    [deleting, setDeleting] = useState(false);
  const url = `${api}/api/admin/rooms/${encodeURIComponent(code)}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
        }),
        body = (await response.json()) as AdminRoomDetail & { error?: string };
      if (response.status === 401) onSignedOut(body.error ?? "Sign in again.");
      else if (!response.ok) setError(body.error ?? "The room failed to load.");
      else {
        setDetail(body);
        setError("");
      }
    } catch {
      setError("Could not reach the game server.");
    }
  }, [url, token, onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, load]);

  async function remove() {
    setDeleting(true);
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        onDeleted(code);
        return;
      }
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "The room could not be deleted.");
    } catch {
      setError("Could not reach the game server.");
    }
    setDeleting(false);
    setConfirming(false);
  }

  const room = detail?.room,
    live = detail?.live ?? null;
  return (
    <section className="admin-panel admin-room" aria-label={`Room ${code}`}>
      <div className="admin-room-head">
        <button className="secondary" onClick={onBack}>
          ← All rooms
        </button>
        <h2>
          Room <code>{code}</code>
        </h2>
        {room && <StatusBadge room={room} />}
        {live && !confirming && (
          <button className="danger" onClick={() => setConfirming(true)}>
            Delete room
          </button>
        )}
      </div>
      {confirming && (
        <div className="admin-confirm" role="group" aria-label="Confirm delete">
          <p>
            Delete room <b>{code}</b>? Everyone in it is disconnected and told
            the room is gone. Its board, scores and dashboard entry are removed.
            This cannot be undone.
          </p>
          <div>
            <button
              className="secondary"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              className="danger"
              onClick={() => void remove()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Yes, delete room"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!detail && !error && <p className="admin-empty">Loading room…</p>}
      {room && (
        <dl className="admin-facts">
          {(
            [
              ["Board", `${room.boardSize}×${room.boardSize}`],
              ["Timer", timer(room.timerSeconds)],
              ["Seats", `${room.players.length}/${room.capacity}`],
              ["Created", when(room.createdAt)],
              ["Started", when(room.startedAt)],
              [
                room.status === "closed" ? "Closed" : "Ended",
                when(room.closedAt ?? room.endedAt),
              ],
              ["Turn", room.startedAt === null ? "-" : String(room.turnNumber)],
              [
                "Words played",
                String(
                  live
                    ? live.moves.filter((move) => move.kind === "play").length
                    : room.plays,
                ),
              ],
              [
                "Tiles in bag",
                room.startedAt === null ? "-" : String(room.bagRemaining),
              ],
              ["Whose turn", live?.currentPlayer ?? "-"],
              ["Open connections", live ? String(live.connections) : "-"],
              [
                "Ending",
                room.endReason
                  ? (endReasons[room.endReason] ?? room.endReason)
                  : room.locked
                    ? "Lobby locked"
                    : "-",
              ],
              ["Expires", live ? when(live.expiresAt) : "-"],
              ["Rematch room", live?.rematchCode ?? "-"],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {room && !live && (
        <p className="admin-note">
          This room no longer exists, so only its last recorded summary is
          shown.
        </p>
      )}
      {room && (
        <>
          <h3>Participants</h3>
          <div
            className="admin-table"
            tabIndex={0}
            role="region"
            aria-label="Participants table"
          >
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Words</th>
                  <th>Tiles placed</th>
                  <th>Best play</th>
                  <th>Passes</th>
                  <th>Exchanges</th>
                  <th>Rack</th>
                  <th>End adjustment</th>
                </tr>
              </thead>
              <tbody>
                {room.players.map((player) => {
                  const seat = live?.seats.find(
                      (item) => item.nickname === player.nickname,
                    ),
                    current = seat ?? player;
                  return (
                    <tr key={player.nickname}>
                      <td>
                        <b>{player.nickname}</b>
                        {current.host && <small> host</small>}
                      </td>
                      <td>
                        {current.left
                          ? "Left"
                          : current.connected
                            ? "Connected"
                            : "Offline"}
                      </td>
                      <td>
                        <b>{current.score}</b>
                      </td>
                      <td>{seat?.plays ?? "-"}</td>
                      <td>{seat?.tilesPlayed ?? "-"}</td>
                      <td>
                        {seat?.bestPlay ? (
                          <>
                            {seat.bestPlay.words} <b>{seat.bestPlay.score}</b>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{seat?.passes ?? "-"}</td>
                      <td>{seat?.exchanges ?? "-"}</td>
                      <td>{seat ? `${seat.rackCount} tiles` : "-"}</td>
                      <td>
                        {seat && seat.score !== seat.movePoints
                          ? seat.score - seat.movePoints
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {live && live.board.length > 0 && (
        <div className="admin-room-play">
          <div>
            <h3>Moves ({live.moves.length})</h3>
            {live.moves.length === 0 ? (
              <p className="admin-empty">No moves yet.</p>
            ) : (
              <div
                className="admin-table admin-moves"
                tabIndex={0}
                role="region"
                aria-label="Moves table, newest first"
              >
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>Move</th>
                      <th>Words</th>
                      <th>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...live.moves].reverse().map((move) => (
                      <tr key={move.turn}>
                        <td>{move.turn}</td>
                        <td>{move.nickname}</td>
                        <td>
                          {moveLabel[move.kind]}
                          {move.kind === "exchange" && (
                            <small> {move.tiles} tiles</small>
                          )}
                          {move.kind === "play" && move.tiles === 7 && (
                            <small> all seven</small>
                          )}
                        </td>
                        <td className="admin-words">
                          {move.words.length
                            ? move.words.map((item) => (
                                <span key={item.word}>
                                  {item.word} <small>{item.score}</small>
                                </span>
                              ))
                            : "-"}
                        </td>
                        <td>
                          <b>{move.score}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <h3>Board</h3>
            <MiniBoard board={live.board} />
          </div>
        </div>
      )}
    </section>
  );
}

function MiniBoard({
  board,
}: {
  board: NonNullable<AdminRoomDetail["live"]>["board"];
}) {
  const placed = board.flat().filter((cell) => cell.tile).length;
  return (
    <div
      className="admin-board"
      style={{ gridTemplateColumns: `repeat(${board.length}, 1fr)` }}
      role="img"
      aria-label={`Board with ${placed} tile${placed === 1 ? "" : "s"} placed`}
    >
      {board.flat().map((cell, index) => (
        <span
          key={index}
          className={
            cell.tile
              ? `tile${cell.tile.blankAs ? " blank" : ""}`
              : (cell.premium?.toLowerCase() ?? "")
          }
        >
          {cell.tile ? (cell.tile.blankAs ?? cell.tile.letter) : ""}
        </span>
      ))}
    </div>
  );
}
