export const SG_PATH_ENV_KEY = "OMO_AST_GREP_SG_PATH"

export type SgRuntimePlatform = "darwin" | "linux" | "win32"
export type SgRuntimeArch = "arm64" | "x64"
export type SgRuntimeSlug = `${SgRuntimePlatform}-${SgRuntimeArch}`

export interface SgManifestAsset {
  readonly sha256: string
  readonly url: string
}

export interface SgResolverOptions {
  readonly arch?: string
  readonly env?: Record<string, string | undefined>
  readonly fileExists?: (filePath: string) => boolean
  readonly platform?: NodeJS.Platform
  readonly runtimeDir?: string
  readonly runVersionProbeSync?: (binaryPath: string) => string
  readonly which?: (commandName: string) => string | null
}

export type SgFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>

export interface SgProvisionOptions {
  readonly arch?: string
  readonly fetchImpl?: SgFetch
  readonly platform?: NodeJS.Platform
  readonly releaseAssets?: Partial<Record<SgRuntimeSlug, SgManifestAsset>>
  readonly signal?: AbortSignal
  readonly targetDir: string
}
