import { existsSync, readdirSync, realpathSync } from "node:fs"

export type ConfigMigrationPathOperations = {
  readonly basename: (path: string) => string
  readonly dirname: (path: string) => string
  readonly isAbsolute: (path: string) => boolean
  readonly join: (...paths: string[]) => string
  readonly normalize: (path: string) => string
  readonly relative: (from: string, to: string) => string
  readonly resolve: (...paths: string[]) => string
}

export type ConfigMigrationDiscoveryFileSystem = {
  readonly existsSync: (path: string) => boolean
  readonly readdirSync: (path: string) => string[]
  readonly realpathSync: (path: string) => string
}

export const DEFAULT_DISCOVERY_FILE_SYSTEM: ConfigMigrationDiscoveryFileSystem = {
  existsSync,
  readdirSync,
  realpathSync,
}

export type LegacyConfigSourceKind =
  | "config-jsonc"
  | "migration-sidecar"
  | "profile-config"
  | "project-config"
  | "user-config"

export type DiscoveredLegacyConfigSource = {
  readonly baseRoot?: string
  readonly configPath: string
  readonly isActiveProfile?: boolean
  readonly kind: LegacyConfigSourceKind
  readonly path: string
  readonly precedence: number
  readonly profile?: string
  readonly projectRoot?: string
}

export type LegacyConfigMigrationGroup = {
  readonly id: string
  readonly sources: readonly DiscoveredLegacyConfigSource[]
}

export type ConfigMigrationDiscoveryOptions = {
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly fileSystem?: ConfigMigrationDiscoveryFileSystem
  readonly homeDir: string
  readonly pathOperations: ConfigMigrationPathOperations
  readonly platform?: NodeJS.Platform
  readonly tauriConfigDirs?: readonly string[]
}
