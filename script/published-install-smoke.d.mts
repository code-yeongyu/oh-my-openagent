export declare function findMissingInstalledArtifacts(pluginPath: string): string[]

export declare function isSupportedPackageSpec(packageSpec: string): boolean

export declare function registryTarballUrl(name: string, version: string): string

export declare function registryWaitFromEnv(env: Readonly<Record<string, string | undefined>>): {
  deadlineMs: number
  delayMs: number
}

export declare function resolveCommittedLatestSpec(
  packageSpec: string,
  options: {
    readonly deadlineMs: number
    readonly delayMs: number
    readonly viewVersion?: (name: string, tag: string) => string
    readonly fetchImpl?: (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; cache?: string; signal?: AbortSignal },
    ) => Promise<Response>
    readonly now?: () => number
    readonly sleep?: (ms: number) => Promise<void>
    readonly log?: (line: string) => void
  },
): Promise<string>

export declare function parseSmokeArgs(argv: readonly string[]): {
  packageSpec: string | null
  tarballPath: string | null
  keep: boolean
}
