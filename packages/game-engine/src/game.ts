import { createBoard, getOpeningCells } from "./board.js";
import { createBag, drawTiles, maxPlayersFor, shuffle } from "./bag.js";
import { BINGO_BONUS, isLetter, RACK_SIZE } from "./config.js";
import type {
  BoardCell,
  BoardTile,
  Cell,
  GameSettings,
  GameState,
  LastMove,
  Letter,
  MoveResult,
  ChallengeOutcome,
  Placement,
  PlacedTile,
  PlayAnalysis,
  PlayerState,
  RandomSource,
  Tile,
  WordScore,
  WordValidator,
} from "./types.js";
const cellKey = (row: number, col: number) => `${row}:${col}`;
export function createGame(
  settings: GameSettings,
  names: readonly string[],
  random: RandomSource,
): GameState {
  const most = maxPlayersFor(settings.boardSize);
  if (names.length < 2 || names.length > most)
    throw new RangeError(
      `A ${settings.boardSize}×${settings.boardSize} game takes 2 to ${most} players.`,
    );
  let bag = createBag(settings.boardSize, random);
  const players: PlayerState[] = names.map((name, index) => {
    const draw = drawTiles(bag, RACK_SIZE);
    bag = draw.bag;
    return { id: `player-${index + 1}`, name, score: 0, rack: draw.drawn };
  });
  return {
    version: 1,
    settings,
    phase: "active",
    board: createBoard(settings.boardSize),
    bag,
    players,
    currentPlayerIndex: 0,
    scorelessTurns: 0,
    turnNumber: 1,
    endReason: null,
  };
}
type Board = readonly (readonly BoardCell[])[];
interface Positioned {
  readonly row: number;
  readonly col: number;
  readonly tile: BoardTile;
}
function boardHasTiles(board: Board) {
  return board.some((row) => row.some((cell) => cell.tile !== null));
}
function readTile(
  board: Board,
  placed: ReadonlyMap<string, BoardTile>,
  row: number,
  col: number,
) {
  return placed.get(cellKey(row, col)) ?? board[row]?.[col]?.tile ?? null;
}
function shown(tile: BoardTile): Letter {
  if (tile.letter !== null) return tile.letter;
  if (tile.blankAs === undefined) throw new Error("Blank has no letter.");
  return tile.blankAs;
}
function collectWord(
  board: Board,
  placed: ReadonlyMap<string, BoardTile>,
  origin: { row: number; col: number },
  rs: number,
  cs: number,
) {
  let row = origin.row,
    col = origin.col;
  while (readTile(board, placed, row - rs, col - cs) !== null) {
    row -= rs;
    col -= cs;
  }
  const cells: Positioned[] = [];
  let tile = readTile(board, placed, row, col);
  while (tile !== null) {
    cells.push({ row, col, tile });
    row += rs;
    col += cs;
    tile = readTile(board, placed, row, col);
  }
  return { cells, word: cells.map((item) => shown(item.tile)).join("") };
}
function scoreWord(
  board: Board,
  newCells: ReadonlySet<string>,
  cells: readonly Positioned[],
) {
  let subtotal = 0,
    multiplier = 1;
  for (const { row, col, tile } of cells) {
    const premium = newCells.has(cellKey(row, col))
      ? board[row]?.[col]?.premium
      : null;
    subtotal += tile.value * (premium === "DL" ? 2 : premium === "TL" ? 3 : 1);
    if (premium === "DW") multiplier *= 2;
    if (premium === "TW") multiplier *= 3;
  }
  return subtotal * multiplier;
}
function finishTurn(
  state: GameState,
  players: readonly PlayerState[],
  bag: readonly Tile[],
  board: GameState["board"],
  scorelessTurns: number,
  lastMove: LastMove,
): GameState {
  const history = [...(state.history ?? []), lastMove];
  const wentOut =
      bag.length === 0 && players[state.currentPlayerIndex]?.rack.length === 0,
    stalled = scorelessTurns >= 6;
  if (!wentOut && !stalled)
    return {
      ...state,
      board,
      bag,
      players,
      scorelessTurns,
      currentPlayerIndex: (state.currentPlayerIndex + 1) % players.length,
      turnNumber: state.turnNumber + 1,
      lastMove,
      history,
    };
  const values = players.map((player) =>
      player.rack.reduce((sum, tile) => sum + tile.value, 0),
    ),
    total = values.reduce((a, b) => a + b, 0);
  return {
    ...state,
    board,
    bag,
    players: players.map((player, index) => ({
      ...player,
      score:
        player.score -
        (values[index] ?? 0) +
        (wentOut && index === state.currentPlayerIndex ? total : 0),
    })),
    scorelessTurns,
    phase: "results",
    endReason: wentOut ? "rack-emptied" : "six-scoreless-turns",
    lastMove,
    history,
  };
}
/**
 * Checks placement geometry and scores a provisional play without consulting
 * a dictionary, so clients can preview and servers can collect the words.
 */
export function analyzePlay(
  board: Board,
  placements: readonly Positioned[],
): PlayAnalysis {
  if (placements.length === 0)
    return { ok: false, error: "Place at least one tile." };
  const cells = new Set<string>(),
    placed = new Map<string, BoardTile>();
  for (const { row, col, tile } of placements) {
    const target = board[row]?.[col];
    if (!Number.isInteger(row) || !Number.isInteger(col) || !target)
      return { ok: false, error: "A tile is outside the board." };
    const key = cellKey(row, col);
    if (cells.has(key) || target.tile !== null)
      return { ok: false, error: "Each tile needs an empty board cell." };
    if (tile.letter === null && !isLetter(tile.blankAs ?? ""))
      return { ok: false, error: "Choose a letter for every blank tile." };
    cells.add(key);
    placed.set(key, tile);
  }
  const first = placements[0];
  if (first === undefined)
    return { ok: false, error: "Place at least one tile." };
  const sameRow = placements.every((item) => item.row === first.row),
    sameCol = placements.every((item) => item.col === first.col);
  if (!sameRow && !sameCol)
    return { ok: false, error: "Tiles must share one row or column." };
  const values = placements.map((item) => (sameRow ? item.col : item.row));
  for (
    let value = Math.min(...values);
    value <= Math.max(...values);
    value += 1
  ) {
    if (
      readTile(
        board,
        placed,
        sameRow ? first.row : value,
        sameRow ? value : first.col,
      ) === null
    )
      return { ok: false, error: "Tiles cannot leave an empty gap." };
  }
  if (!boardHasTiles(board)) {
    if (
      !getOpeningCells(board.length).some(({ row, col }) =>
        cells.has(cellKey(row, col)),
      )
    )
      return {
        ok: false,
        error: "The first word must cross a marked center cell.",
      };
  } else {
    const connected = placements.some(({ row, col }) =>
      [
        [row - 1, col],
        [row + 1, col],
        [row, col - 1],
        [row, col + 1],
      ].some(([r, c]) => (board[r ?? -1]?.[c ?? -1]?.tile ?? null) !== null),
    );
    if (!connected)
      return { ok: false, error: "The play must connect to the board." };
  }
  const found = new Map<string, ReturnType<typeof collectWord>>();
  for (const placement of placements)
    for (const [rs, cs] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const word = collectWord(board, placed, placement, rs, cs);
      if (word.cells.length >= 2)
        found.set(
          word.cells.map(({ row, col }) => cellKey(row, col)).join("|"),
          word,
        );
    }
  if (found.size === 0)
    return {
      ok: false,
      error: "A play must create a word with at least two letters.",
    };
  const words: WordScore[] = [...found.values()].map((item) => ({
    word: item.word,
    score: scoreWord(board, cells, item.cells),
  }));
  return {
    ok: true,
    words,
    score:
      words.reduce((sum, item) => sum + item.score, 0) +
      (placements.length === RACK_SIZE ? BINGO_BONUS : 0),
    candidates: [...new Set(words.map((item) => item.word))],
  };
}
export function playMove(
  state: GameState,
  placements: readonly Placement[],
  validator: WordValidator,
): MoveResult {
  if (state.phase !== "active")
    return { ok: false, error: "This game is already finished." };
  if (placements.length === 0)
    return { ok: false, error: "Place at least one tile." };
  const player = state.players[state.currentPlayerIndex];
  if (player === undefined)
    return { ok: false, error: "Current player is missing." };
  const rack = new Map(player.rack.map((tile) => [tile.id, tile])),
    tileIds = new Set<string>(),
    positioned: { row: number; col: number; tile: PlacedTile }[] = [];
  for (const placement of placements) {
    const tile = rack.get(placement.tileId);
    if (tile === undefined || tileIds.has(tile.id))
      return { ok: false, error: "A placed tile is not in your rack." };
    if (tile.letter !== null && placement.blankAs !== undefined)
      return { ok: false, error: "Only a blank can substitute a letter." };
    tileIds.add(tile.id);
    positioned.push({
      row: placement.row,
      col: placement.col,
      tile:
        placement.blankAs === undefined
          ? tile
          : { ...tile, blankAs: placement.blankAs },
    });
  }
  const analysis = analyzePlay(state.board, positioned);
  if (!analysis.ok) return analysis;
  const valid = validator(analysis.candidates),
    rejected = analysis.candidates.filter((word) => valid.get(word) !== true);
  // A submitted play is final: an invalid word costs the turn, scores 0 and
  // the tiles stay on the player's rack.
  if (rejected.length)
    return {
      ok: true,
      state: finishTurn(
        state,
        state.players,
        state.bag,
        state.board,
        state.scorelessTurns + 1,
        {
          playerIndex: state.currentPlayerIndex,
          kind: "rejected",
          words: rejected.map((word) => ({ word, score: 0 })),
          score: 0,
          tiles: placements.length,
        },
      ),
      words: [],
      score: 0,
      rejected,
    };
  const placed = new Map(
      positioned.map(({ row, col, tile }) => [cellKey(row, col), tile]),
    ),
    board = state.board.map((row, r) =>
      row.map(
        (cell, c): Cell => ({
          ...cell,
          tile: placed.get(cellKey(r, c)) ?? cell.tile,
        }),
      ),
    ),
    kept = player.rack.filter((tile) => !tileIds.has(tile.id)),
    draw = drawTiles(state.bag, RACK_SIZE - kept.length),
    players = state.players.map((entry, index) =>
      index === state.currentPlayerIndex
        ? {
            ...entry,
            score: entry.score + analysis.score,
            rack: [...kept, ...draw.drawn],
          }
        : entry,
    );
  return {
    ok: true,
    state: finishTurn(
      state,
      players,
      draw.bag,
      board,
      analysis.score === 0 ? state.scorelessTurns + 1 : 0,
      {
        playerIndex: state.currentPlayerIndex,
        kind: "play",
        words: analysis.words,
        score: analysis.score,
        tiles: placements.length,
        placed: positioned.map(({ row, col, tile }) => ({
          row,
          col,
          letter: tile.letter,
          value: tile.value,
          ...(tile.blankAs === undefined ? {} : { blankAs: tile.blankAs }),
        })),
      },
    ),
    words: analysis.words,
    score: analysis.score,
  };
}
/** Records how a dictionary rejection was settled on the move just made. */
export function withChallenge(
  state: GameState,
  challenge: ChallengeOutcome,
): GameState {
  const last = state.lastMove;
  if (!last) return state;
  const tagged = { ...last, challenge };
  return {
    ...state,
    lastMove: tagged,
    history: [...(state.history ?? []).slice(0, -1), tagged],
  };
}
export function passTurn(
  state: GameState,
  kind: "pass" | "auto-pass" = "pass",
): GameState {
  return finishTurn(
    state,
    state.players,
    state.bag,
    state.board,
    state.scorelessTurns + 1,
    {
      playerIndex: state.currentPlayerIndex,
      kind,
      words: [],
      score: 0,
      tiles: 0,
    },
  );
}
export function exchangeTiles(
  state: GameState,
  ids: readonly string[],
  random: RandomSource,
): MoveResult {
  if (ids.length === 0)
    return { ok: false, error: "Select at least one tile to exchange." };
  if (state.bag.length < 7)
    return { ok: false, error: "At least seven tiles must remain in the bag." };
  const player = state.players[state.currentPlayerIndex];
  if (player === undefined)
    return { ok: false, error: "Current player is missing." };
  const selected = new Set(ids);
  if (
    selected.size !== ids.length ||
    ids.some((id) => !player.rack.some((tile) => tile.id === id))
  )
    return { ok: false, error: "Only rack tiles can be exchanged." };
  const returned = player.rack.filter((tile) => selected.has(tile.id)),
    kept = player.rack.filter((tile) => !selected.has(tile.id)),
    draw = drawTiles(state.bag, returned.length),
    bag = shuffle([...draw.bag, ...returned], random),
    players = state.players.map((entry, index) =>
      index === state.currentPlayerIndex
        ? { ...entry, rack: [...kept, ...draw.drawn] }
        : entry,
    );
  return {
    ok: true,
    state: finishTurn(
      state,
      players,
      bag,
      state.board,
      state.scorelessTurns + 1,
      {
        playerIndex: state.currentPlayerIndex,
        kind: "exchange",
        words: [],
        score: 0,
        tiles: returned.length,
      },
    ),
    words: [],
    score: 0,
  };
}
/**
 * Records `now` as the end time of every turn finished between `before` and
 * `after`, and how long each took. The engine never reads the clock, so
 * callers stamp moves after each transition. A turn is timed from
 * `turnStartedAt`, falling back to the previous move or the game start for
 * games saved before it existed; turns finished together (a run of automatic
 * passes) take no time after the first.
 */
export function stampMoves(
  before: GameState,
  after: GameState,
  now: number,
): GameState {
  const done = before.history?.length ?? 0,
    history = after.history ?? [];
  if (history.length <= done) return after;
  const begun =
    before.turnStartedAt ?? before.history?.at(-1)?.at ?? before.startedAt;
  const stamped = history.map((move, index) => {
    if (index < done) return move;
    const took =
      index > done ? 0 : begun === undefined ? undefined : now - begun;
    return {
      ...move,
      at: now,
      ...(took === undefined ? {} : { took: Math.max(0, took) }),
    };
  });
  const lastMove = stamped.at(-1);
  return lastMove
    ? { ...after, history: stamped, lastMove, turnStartedAt: now }
    : after;
}
/**
 * Ends an active game early by agreement. Nobody went out, so it settles like
 * a stalled game: each player loses the value of their own remaining tiles.
 */
export function endGame(state: GameState): GameState {
  if (state.phase !== "active") return state;
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      score:
        player.score - player.rack.reduce((sum, tile) => sum + tile.value, 0),
    })),
    phase: "results",
    endReason: "ended-early",
  };
}
