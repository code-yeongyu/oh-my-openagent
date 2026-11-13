export declare function findMissingInstalledArtifacts(pluginPath: string): string[]

export declare function isSupportedPackageSpec(packageSpec: string): boolean

export declare function parseSmokeArgs(argv: readonly string[]): {
  packageSpec: string | null
  tarballPath: string | null
  keep: boolean
}
