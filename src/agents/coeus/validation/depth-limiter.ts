export function canSpawnChild(
  currentDepth: number,
  maxDepth: number
): boolean {
  return currentDepth < maxDepth;
}

export function incrementDepth(currentDepth: number): number {
  return currentDepth + 1;
}
