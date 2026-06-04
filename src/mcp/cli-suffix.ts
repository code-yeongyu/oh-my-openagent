function normalizeCliPath(path: string): string {
  return path.replaceAll("\\", "/")
}

export function hasCliSuffix(candidatePath: string, suffix: string): boolean {
  return normalizeCliPath(candidatePath).endsWith(normalizeCliPath(suffix))
}
