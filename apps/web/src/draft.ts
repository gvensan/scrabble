export function recallLast<T>(items: readonly T[]): T[] {
  return items.slice(0, -1);
}
