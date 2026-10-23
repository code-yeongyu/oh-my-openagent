import {
  copyFileSync,
  closeSync,
  fchmodSync,
  openSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import type { OmoConfigEnv } from "../loader"

export type OmoConfigEditPathSegment = string | number

export type OmoConfigEdit = {
  readonly path: readonly OmoConfigEditPathSegment[]
  readonly value: unknown
}

export type OmoConfigPathStats = {
  readonly isSymbolicLink: () => boolean
  readonly mode?: number
}

export type OmoConfigWriteFileSystem = {
  readonly copyFileSync: (source: string, destination: string) => void
  readonly existsSync: (path: string) => boolean
  readonly lstatSync: (path: string) => OmoConfigPathStats
  readonly mkdirSync: (path: string, options: { readonly recursive: true; readonly mode?: number }) => string | undefined
  readonly readFileSync: (path: string, encoding: "utf-8") => string
  readonly readdirSync: (path: string) => string[]
  readonly renameSync: (oldPath: string, newPath: string) => void
  readonly unlinkSync: (path: string) => void
  readonly writeFileExclusiveSync: (path: string, content: string, mode?: number) => void
  readonly writeFileSync: (path: string, content: string, encoding: "utf-8") => void
}

export type UpdateOmoConfigOptions = {
  readonly edits: readonly OmoConfigEdit[]
  readonly env?: OmoConfigEnv
  readonly fileSystem?: OmoConfigWriteFileSystem
  readonly platform?: NodeJS.Platform
  readonly projectDir?: string
  readonly scope: "project" | "user"
  readonly targetPath?: string
  /** Exact path for the pre-write copy; the write fails rather than pick another name when it exists. */
  readonly backupPath?: string
}

export type UpdateOmoConfigResult = {
  readonly backupPath?: string
  readonly path: string
}

export const DEFAULT_WRITE_FILE_SYSTEM: OmoConfigWriteFileSystem = {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileExclusiveSync: (path: string, content: string, mode?: number): void => {
    const descriptor = openSync(path, "wx", 0o600)
    try {
      if (mode !== undefined) fchmodSync(descriptor, mode)
      writeFileSync(descriptor, content, { encoding: "utf-8" })
    } finally {
      closeSync(descriptor)
    }
  },
  writeFileSync,
}

export class OmoConfigWriteError extends Error {
  override readonly name = "OmoConfigWriteError"

  constructor(
    readonly path: string,
    readonly operation: "backup" | "parse" | "read" | "write",
    cause: unknown,
  ) {
    const reason = cause instanceof Error && [
      "Refusing to edit symlinked omo config",
      "Refusing to edit config under symlinked project .omo directory",
    ].includes(cause.message) ? `: ${cause.message}` : ""
    super(`Failed to ${operation} omo config at ${path}${reason}`, { cause })
  }
}
