const EXCLUDED_DIR_NAMES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".sisyphus",
  ".omx",
  ".turbo",
  "coverage",
  "out",
  ".cache",
  ".vscode-test",
  "target",
  ".local-ignore",
] as const

export const EXCLUDED_DIRS: ReadonlySet<string> = Object.freeze(new Set<string>(EXCLUDED_DIR_NAMES))
