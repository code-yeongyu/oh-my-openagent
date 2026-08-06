export const SG_PATH_ENV_KEY = "OMO_AST_GREP_SG_PATH"

export type SgRuntimePlatform = "darwin" | "linux" | "win32"
export type SgRuntimeArch = "arm64" | "x64"
export type SgRuntimeSlug = `${SgRuntimePlatform}-${SgRuntimeArch}`

export interface SgManifestAsset {
  readonly sha256: string
  readonly url: string
}

export type SgResolutionTier = "env-override" | "omo-runtime" | "skill-bin" | "path" | "homebrew"

export interface SgCandidate {
  readonly path: string
  readonly tier: SgResolutionTier
}

export interface SgResolverOptions {
  readonly arch?: string
  readonly cache?: boolean
  readonly env?: Record<string, string | undefined>
  readonly fileExists?: (filePath: string) => boolean
  readonly homeDir?: string
  readonly packageDir?: string
  readonly platform?: NodeJS.Platform
  readonly revalidate?: boolean
  readonly runtimeDir?: string
  readonly runVersionProbeSync?: (binaryPath: string) => string
  readonly which?: (commandName: string) => string | null
}

export const SG_BINARY_NOT_FOUND = "BINARY_NOT_FOUND"

export interface SgBinaryNotFoundError {
  readonly code: typeof SG_BINARY_NOT_FOUND
  readonly hints: readonly string[]
  readonly message: string
}

export type SgResolution =
  | { readonly found: true; readonly path: string; readonly tier: SgResolutionTier }
  | { readonly found: false; readonly error: SgBinaryNotFoundError }

export type SgFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>

export interface SgProvisionOptions {
  readonly arch?: string
  readonly fetchImpl?: SgFetch
  readonly platform?: NodeJS.Platform
  readonly releaseAssets?: Partial<Record<SgRuntimeSlug, SgManifestAsset>>
  readonly signal?: AbortSignal
  readonly targetDir: string
}
