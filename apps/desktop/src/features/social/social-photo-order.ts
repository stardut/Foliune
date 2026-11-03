/** Move one stable photo ID by insertion, preserving all other relative order. */
export function movePhotoId(ids: readonly string[], id: string, targetIndex: number): string[] {
  const sourceIndex = ids.indexOf(id);
  if (sourceIndex < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= ids.length || sourceIndex === targetIndex) return [...ids];
  const next = [...ids];
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, id);
  return next;
}

export type SocialGridCell = { left: number; top: number; width: number; height: number };

/** Hit fixed grid slots, including the dragged placeholder, so reordering cannot move the target. */
export function socialGridTarget(cells: readonly SocialGridCell[], x: number, y: number): number {
  if (!cells.length) return -1;
  // Choose the closest row first. A partial last row must not steal a hit from
  // the right-hand side of the row above it merely because it has fewer cells.
  let rowTop = cells[0].top;
  let nearestRow = Infinity;
  for (const cell of cells) {
    const distance = Math.abs(y - cell.top - cell.height / 2);
    if (distance < nearestRow) { nearestRow = distance; rowTop = cell.top; }
  }
  let target = 0;
  let nearestColumn = Infinity;
  cells.forEach((cell, index) => {
    if (Math.abs(cell.top - rowTop) > 1) return;
    const distance = Math.abs(x - cell.left - cell.width / 2);
    if (distance < nearestColumn) { nearestColumn = distance; target = index; }
  });
  return target;
}

export function socialGridColumns(cells: readonly SocialGridCell[]): number {
  return cells.length ? cells.filter((cell) => Math.abs(cell.top - cells[0].top) <= 1).length : 1;
}
