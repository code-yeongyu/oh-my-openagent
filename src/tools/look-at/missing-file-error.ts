import type { LookAtArgs } from "./types"

export function getMissingLookAtFilePath(error: unknown, args: LookAtArgs): string | null {
  if (!isMissingFileError(error)) {
    return null
  }

  const pathFromError = getMissingFilePathFromError(error)
  if (pathFromError) {
    return pathFromError
  }

  return args.file_path ?? null
}

function getMissingFilePathFromError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  const path = Reflect.get(error, "path")
  if (typeof path === "string" && path.length > 0) {
    return path
  }

  if (error instanceof Error) {
    const match = /open '([^']+)'/.exec(error.message)
    return match?.[1] ?? null
  }

  return null
}

function isMissingFileError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const code = Reflect.get(error, "code")
  if (code === "ENOENT") {
    return true
  }

  return error.message.includes("ENOENT") && error.message.includes("no such file or directory")
}
