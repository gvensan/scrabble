import { createBoard, getOpeningCells } from "./board.js";
import { createBag, drawTiles, shuffle } from "./bag.js";
import { BINGO_BONUS, isLetter, RACK_SIZE } from "./config.js";
import type {
  Cell,
  GameSettings,
  GameState,
  Letter,
  MoveResult,
  Placement,
  PlacedTile,
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
  if (names.length < 2 || names.length > 4)
    throw new RangeError("A game needs 2–4 players.");
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
function boardHasTiles(board: GameState["board"]) {
  return board.some((row) => row.some((cell) => cell.tile !== null));
}
function readTile(
  board: GameState["board"],
  placed: ReadonlyMap<string, PlacedTile>,
  row: number,
  col: number,
) {
  return placed.get(cellKey(row, col)) ?? board[row]?.[col]?.tile ?? null;
}
function shown(tile: PlacedTile): Letter {
  if (tile.letter !== null) return tile.letter;
  if (tile.blankAs === undefined) throw new Error("Blank has no letter.");
  return tile.blankAs;
}
function collectWord(
  board: GameState["board"],
  placed: ReadonlyMap<string, PlacedTile>,
  origin: Placement,
  rs: number,
  cs: number,
) {
  let row = origin.row,
    col = origin.col;
  while (readTile(board, placed, row - rs, col - cs) !== null) {
    row -= rs;
    col -= cs;
  }
  const cells: { row: number; col: number; tile: PlacedTile }[] = [];
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
  board: GameState["board"],
  newCells: ReadonlySet<string>,
  cells: readonly { row: number; col: number; tile: PlacedTile }[],
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
): GameState {
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
    cells = new Set<string>(),
    placed = new Map<string, PlacedTile>();
  for (const placement of placements) {
    const tile = rack.get(placement.tileId);
    if (tile === undefined || tileIds.has(tile.id))
      return { ok: false, error: "A placed tile is not in your rack." };
    if (
      !Number.isInteger(placement.row) ||
      !Number.isInteger(placement.col) ||
      state.board[placement.row]?.[placement.col] === undefined
    )
      return { ok: false, error: "A tile is outside the board." };
    const key = cellKey(placement.row, placement.col);
    if (
      cells.has(key) ||
      state.board[placement.row]?.[placement.col]?.tile !== null
    )
      return { ok: false, error: "Each tile needs an empty board cell." };
    if (
      tile.letter === null &&
      (placement.blankAs === undefined || !isLetter(placement.blankAs))
    )
      return { ok: false, error: "Choose a letter for every blank tile." };
    if (tile.letter !== null && placement.blankAs !== undefined)
      return { ok: false, error: "Only a blank can substitute a letter." };
    tileIds.add(tile.id);
    cells.add(key);
    placed.set(key, {
      ...tile,
      ...(placement.blankAs === undefined
        ? {}
        : { blankAs: placement.blankAs }),
    });
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
        state.board,
        placed,
        sameRow ? first.row : value,
        sameRow ? value : first.col,
      ) === null
    )
      return { ok: false, error: "Tiles cannot leave an empty gap." };
  }
  if (!boardHasTiles(state.board)) {
    if (
      !getOpeningCells(state.settings.boardSize).some(({ row, col }) =>
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
      ].some(([r, c]) => state.board[r ?? -1]?.[c ?? -1]?.tile !== null),
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
      const word = collectWord(state.board, placed, placement, rs, cs);
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
  const unique = [...new Set([...found.values()].map((item) => item.word))],
    valid = validator(unique),
    invalid = unique.find((word) => valid.get(word) !== true);
  if (invalid !== undefined)
    return {
      ok: false,
      error: `${invalid} is not accepted by the dictionary.`,
    };
  const words: WordScore[] = [...found.values()].map((item) => ({
      word: item.word,
      score: scoreWord(state.board, cells, item.cells),
    })),
    score =
      words.reduce((sum, item) => sum + item.score, 0) +
      (placements.length === 7 ? BINGO_BONUS : 0),
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
            score: entry.score + score,
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
      score === 0 ? state.scorelessTurns + 1 : 0,
    ),
    words,
    score,
  };
}
export function passTurn(state: GameState): GameState {
  return finishTurn(
    state,
    state.players,
    state.bag,
    state.board,
    state.scorelessTurns + 1,
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
    ),
    words: [],
    score: 0,
  };
}
