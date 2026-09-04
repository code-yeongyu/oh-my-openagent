import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import type { OmoConfig, OmoHarnessId } from "../schema"

export type OmoConfigDiagnosticKind = "parse" | "profile" | "read" | "unknown-keys" | "validation"

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
  readonly HOME?: string
  readonly USERPROFILE?: string
}

export type OmoConfigReadFileSystem = {
  readonly existsSync: (path: string) => boolean
  readonly lstatSync?: (path: string) => { readonly isSymbolicLink: () => boolean }
  readonly readFileSync: (path: string, encoding: "utf-8") => string
  readonly realpathSync?: (path: string) => string
}

export type OmoConfigRawLayer = {
  readonly config: Readonly<Record<string, unknown>>
  readonly source: OmoConfigSource
}

export type LoadOmoConfigOptions = {
  readonly cwd?: string
  readonly env?: OmoConfigEnv
  readonly fileSystem?: OmoConfigReadFileSystem
  readonly harness?: OmoHarnessId
  readonly platform?: NodeJS.Platform
  readonly profile?: string
}

export type LoadOmoConfigResult = {
  readonly config: OmoConfig
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly layers: readonly OmoConfigRawLayer[]
  readonly profile?: string
  readonly sources: readonly OmoConfigSource[]
}

export const DEFAULT_READ_FILE_SYSTEM: OmoConfigReadFileSystem = {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
}
