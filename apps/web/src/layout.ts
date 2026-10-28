function pixels(value: string | undefined): number {
  return Number.parseFloat(value ?? "") || 0;
}

export function fittedCellSize(
  boardSize: number,
  viewport?: HTMLElement | null,
): number {
  if (typeof window === "undefined") return 46;
  if (viewport) {
    const viewportStyle = getComputedStyle(viewport);
    const board = viewport.querySelector<HTMLElement>(".board");
    const boardStyle = board ? getComputedStyle(board) : null;
    // The bonus legend shares the canvas: beside the board it takes a column
    // on each side (the board stays centred), otherwise a strip below it.
    const legend = viewport.querySelector<HTMLElement>(".board-legend");
    const legendStyle = legend ? getComputedStyle(legend) : null;
    const besideBoard = legendStyle?.gridRowStart === "1";
    const legendWidth =
      legend && legendStyle && besideBoard
        ? 2 * (legend.offsetWidth + pixels(legendStyle.marginRight))
        : 0;
    const legendHeight =
      legend && legendStyle && !besideBoard
        ? legend.offsetHeight + pixels(legendStyle.marginTop)
        : 0;
    const availableWidth =
      viewport.clientWidth -
      pixels(viewportStyle.paddingLeft) -
      pixels(viewportStyle.paddingRight) -
      legendWidth;
    const availableHeight =
      viewport.clientHeight -
      pixels(viewportStyle.paddingTop) -
      pixels(viewportStyle.paddingBottom) -
      legendHeight;
    const frameWidth = boardStyle
      ? pixels(boardStyle.paddingLeft) + pixels(boardStyle.paddingRight)
      : 18;
    const frameHeight = boardStyle
      ? pixels(boardStyle.paddingTop) + pixels(boardStyle.paddingBottom)
      : 18;
    const columnGap = boardStyle ? pixels(boardStyle.columnGap) : 3;
    const rowGap = boardStyle ? pixels(boardStyle.rowGap) : 3;
    const width =
      (availableWidth -
        frameWidth -
        Math.max(0, boardSize - 1) * columnGap -
        2) /
      boardSize;
    const height =
      (availableHeight -
        frameHeight -
        Math.max(0, boardSize - 1) * rowGap -
        2) /
      boardSize;
    return Math.max(26, Math.min(58, Math.floor(Math.min(width, height))));
  }
  const compact = window.innerWidth <= 800;
  const availableWidth = compact
    ? window.innerWidth - 28
    : window.innerWidth - 368 - 64;
  const availableHeight = compact
    ? window.innerHeight * 0.54 - 32
    : window.innerHeight - 68 - 76;
  const gapsAndFrame = 18 + Math.max(0, boardSize - 1) * 3;
  const size = Math.floor(
    (Math.min(availableWidth, availableHeight) - gapsAndFrame) / boardSize,
  );
  return Math.max(26, Math.min(58, size));
}
