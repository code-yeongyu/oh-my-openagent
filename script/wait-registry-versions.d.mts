export type RegistryFetch = (url: string, init?: { headers?: Record<string, string>; cache?: string; signal?: AbortSignal }) => Promise<Response>
export type PendingSpec = { spec: string; reason: string }

export declare function parseSpec(spec: string): { name: string; version: string }
export declare function pendingSpecs(specs: readonly string[], fetchImpl?: RegistryFetch): Promise<PendingSpec[]>
export declare function waitForRegistryVersions(options: {
  readonly specs: readonly string[]
  readonly deadlineMs: number
  readonly delayMs: number
  readonly fetchImpl?: RegistryFetch
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: (line: string) => void
}): Promise<{ ok: boolean; pending: PendingSpec[] }>
export declare function platformPackageNames(rootManifest: { optionalDependencies?: Record<string, string> }): string[]
