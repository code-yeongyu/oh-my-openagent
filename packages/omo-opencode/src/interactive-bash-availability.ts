type RuntimeWithBun = typeof globalThis & {
  Bun?: {
    which(binary: string): string | null
  }
}

function defaultWhich(binary: string): string | null {
  return (globalThis as RuntimeWithBun).Bun?.which(binary) ?? null
}

export function isInteractiveBashEnabled(
  which: (binary: string) => string | null = defaultWhich,
): boolean {
  return which("tmux") !== null
}
