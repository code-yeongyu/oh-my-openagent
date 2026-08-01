import { posix } from "node:path"

// The engine is a pure platform whose injected filesystem ports are keyed by
// forward-slash paths; node:path joins to the host separator (backslashes on
// Windows), so migration paths normalize here instead of through the host.
export function toPosixPath(path: string): string {
  return path.split("\\").join("/")
}

export function posixJoin(...segments: string[]): string {
  return toPosixPath(posix.join(...segments))
}
