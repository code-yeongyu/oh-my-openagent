import { existsSync, lstatSync, readFileSync } from "node:fs"
import type { OmoConfig } from "../schema"

export type OmoConfigDiagnosticKind = "parse" | "read" | "validation"

export type OmoConfigDiagnostic = {
  readonly kind: OmoConfigDiagnosticKind
  readonly path: string
  readonly message: string
  readonly issuePaths?: readonly string[]
}

export type OmoConfigSourceScope = "project" | "user"

export type OmoConfigSource = {
  readonly exists: boolean
  readonly loaded: boolean
  readonly path: string
  readonly scope: OmoConfigSourceScope
}

export type OmoConfigEnv = {
  readonly [key: string]: string | undefined
  readonly APPDATA?: string
  readonly HOME?: string
  readonly USERPROFILE?: string
  readonly XDG_CONFIG_HOME?: string
}

export type OmoConfigReadFileSystem = {
  readonly existsSync: (path: string) => boolean
  readonly lstatSync?: (path: string) => { readonly isSymbolicLink: () => boolean }
  readonly readFileSync: (path: string, encoding: "utf-8") => string
}

export type LoadOmoConfigOptions = {
  readonly cwd?: string
  readonly env?: OmoConfigEnv
  readonly fileSystem?: OmoConfigReadFileSystem
  readonly platform?: NodeJS.Platform
}

export type LoadOmoConfigResult = {
  readonly config: OmoConfig
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly sources: readonly OmoConfigSource[]
}

export const DEFAULT_READ_FILE_SYSTEM: OmoConfigReadFileSystem = {
  existsSync,
  lstatSync,
  readFileSync,
}
