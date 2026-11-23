/** Nearest first in the last navigation direction, plus one step back. */
export function photoPreloadOffsets(direction: number): readonly number[] {
  if (direction > 0) return [1, 2, 3, -1];
  if (direction < 0) return [-1, -2, -3, 1];
  return [1, -1];
}
