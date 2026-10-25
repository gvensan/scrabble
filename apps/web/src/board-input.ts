import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export const MIN_CELL = 26;
export const MAX_CELL = 58;

/**
 * Roving focus for the board: one cell is in the tab order and the arrow,
 * Home and End keys move between cells.
 */
export function useBoardKeys(size: number) {
  const [cursor, setCursor] = useState(() => {
    const middle = Math.floor(size / 2);
    return { row: middle, col: middle };
  });
  useEffect(() => {
    const middle = Math.floor(size / 2);
    setCursor({ row: middle, col: middle });
  }, [size]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const row = Number(target.dataset.row),
      col = Number(target.dataset.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [row - 1, col],
      ArrowDown: [row + 1, col],
      ArrowLeft: [row, col - 1],
      ArrowRight: [row, col + 1],
      Home: [row, 0],
      End: [row, size - 1],
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    const [r, c] = next.map((value) =>
      Math.max(0, Math.min(size - 1, value)),
    ) as [number, number];
    setCursor({ row: r, col: c });
    event.currentTarget
      .querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`)
      ?.focus();
  };
  const tabIndexFor = (row: number, col: number) =>
    row === cursor.row && col === cursor.col ? 0 : -1;
  return { onKeyDown, tabIndexFor, setCursor };
}

/** Two-finger pinch on the board viewport changes the cell size. */
export function usePinchZoom(
  viewport: React.RefObject<HTMLElement | null>,
  cellSize: number,
  setCellSize: (size: number) => void,
  active: boolean,
) {
  const size = useRef(cellSize);
  size.current = cellSize;
  useEffect(() => {
    const element = viewport.current;
    if (!active || !element) return;
    let start: { distance: number; size: number } | null = null;
    const distance = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return a && b
        ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
        : 0;
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2)
        start = { distance: distance(event.touches), size: size.current };
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 2 || start.distance === 0) return;
      event.preventDefault();
      const scaled = Math.round(
        (start.size * distance(event.touches)) / start.distance,
      );
      setCellSize(Math.max(MIN_CELL, Math.min(MAX_CELL, scaled)));
    };
    const onEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) start = null;
    };
    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, [active, setCellSize, viewport]);
}
