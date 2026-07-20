import {
  copyFileSync,
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
}

export type OmoConfigWriteFileSystem = {
  readonly copyFileSync: (source: string, destination: string) => void
  readonly existsSync: (path: string) => boolean
  readonly lstatSync: (path: string) => OmoConfigPathStats
  readonly mkdirSync: (path: string, options: { readonly recursive: true }) => string | undefined
  readonly readFileSync: (path: string, encoding: "utf-8") => string
  readonly readdirSync: (path: string) => string[]
  readonly renameSync: (oldPath: string, newPath: string) => void
  readonly unlinkSync: (path: string) => void
  readonly writeFileExclusiveSync: (path: string, content: string) => void
  readonly writeFileSync: (path: string, content: string, encoding: "utf-8") => void
}

export type UpdateOmoConfigOptions = {
  readonly edits: readonly OmoConfigEdit[]
  readonly env?: OmoConfigEnv
  readonly fileSystem?: OmoConfigWriteFileSystem
  readonly platform?: NodeJS.Platform
  readonly projectDir?: string
  readonly scope: "project" | "user"
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
  writeFileExclusiveSync: (path: string, content: string): void => {
    writeFileSync(path, content, { encoding: "utf-8", flag: "wx" })
  },
  writeFileSync,
}

export class OmoConfigWriteError extends Error {
  readonly name = "OmoConfigWriteError"

  constructor(
    readonly path: string,
    readonly operation: "backup" | "parse" | "read" | "write",
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Failed to ${operation} omo config at ${path}: ${detail}`, { cause })
  }
}
