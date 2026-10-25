export function fittedCellSize(boardSize: number): number {
  if (typeof window === "undefined") return 46;
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
