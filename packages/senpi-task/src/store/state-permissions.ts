import { lstatSync, mkdirSync, type Stats } from "node:fs"

export class StatePermissionsError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`State path must be a regular directory: ${path}`)
    this.name = "StatePermissionsError"
    this.path = path
  }
}

export function ensurePrivateDirectory(path: string): void {
  let stats: Stats
  try {
    stats = lstatSync(path)
  } catch (error) {
    if (!isEnoent(error)) throw error
    mkdirSync(path, { recursive: true, mode: 0o700 })
    stats = lstatSync(path)
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new StatePermissionsError(path)
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
