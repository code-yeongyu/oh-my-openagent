/** Sidecar naming the backend that built a sandbox, so a later sweep can route teardown through it. */
export const BACKEND_FILE = ".omo-isolation-backend.json"

export type BackendKind = "apfs" | "btrfs" | "zfs" | "reflink" | "overlayfs" | "block-clone" | "rcopy"

export interface ProbeResult {
  readonly available: boolean
  readonly reason?: string
}

export interface IsolationContext {
  readonly id: string
  readonly baseDir: string
  readonly crossDevice: boolean
  readonly maxCopyBytes?: number
}

export interface IsolationBackend {
  readonly kind: BackendKind
  readonly clonesTree: boolean
  probe(repoRoot: string, ctx?: IsolationContext): Promise<ProbeResult>
  start(lower: string, merged: string, ctx: IsolationContext): Promise<void | { strategy_detail: string }>
  stop(merged: string): Promise<void>
  /** Relocate the sandbox parent, including any mounted merged tree. */
  relocate?(from: string, to: string): Promise<void>
}

export class IsolationUnavailableError extends Error {
  readonly name = "IsolationUnavailableError"
  readonly code = "isolation_unavailable"
}

export function resolveCandidates(
  platform: NodeJS.Platform,
  preferred: BackendKind | "auto" = "auto",
): { candidates: BackendKind[]; reason?: string } {
  let candidates: BackendKind[]
  switch (platform) {
    case "darwin": candidates = ["apfs", "zfs", "rcopy"]; break
    case "linux": candidates = ["btrfs", "zfs", "reflink", "overlayfs", "rcopy"]; break
    case "win32": candidates = ["block-clone", "rcopy"]; break
    default: candidates = ["rcopy"]
  }
  if (preferred !== "auto") candidates = [preferred, ...candidates.filter((kind) => kind !== preferred)]
  return { candidates }
}

export function isBackendKind(value: unknown): value is BackendKind {
  return value === "apfs" || value === "btrfs" || value === "zfs" || value === "reflink"
    || value === "overlayfs" || value === "block-clone" || value === "rcopy"
}
