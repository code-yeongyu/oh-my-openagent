export interface RuntimeStageOptions {
  readonly repoRoot?: string
  readonly sourceDist?: string
  readonly targetDist?: string
  readonly inputCandidates?: readonly string[]
}

export interface RuntimeStageResult {
  readonly ok: true
  readonly targetDist: string
  readonly manifestPath: string
}

export interface RuntimeVerifyResult {
  readonly ok: true
  readonly version: string
  readonly inputDigest: string
  readonly outputs: readonly { readonly path: string; readonly sha256: string }[]
}

export function stageLspDaemonRuntime(options?: RuntimeStageOptions): Promise<RuntimeStageResult>
export function verifyRuntimeDist(distDir: string): Promise<RuntimeVerifyResult>
export function checkRuntimeDistFresh(options?: RuntimeStageOptions): Promise<RuntimeVerifyResult>
