export function extractSemverFromOutput(output: string): string | null {
  const trimmed = output.trim()
  if (!trimmed) return null
  // The negative lookbehind `(?<![\d:])` prevents matching the milliseconds segment of timestamps
  // like `00:24:25.202` that the Electron-based OpenCode binary leaks into stdout.
  const semverPattern = /(?<![\d:])v?(\d+\.\d+\.\d+(?:[-+][\w.]+)*)/
  const match = trimmed.match(semverPattern)
  return match?.[1] ?? null
}
