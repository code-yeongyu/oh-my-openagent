export type HostKind = "opencode" | "oh-my-pi" | "pi"

export type HostPackageFamily = "oh-my-openagent" | "oh-my-pi" | "pi"

export type HostRuntimeIdentity = {
  kind: HostKind
  packageFamily: HostPackageFamily
  displayName: string
  packageName?: string
  version?: string
  executablePath?: string
  sourceRepoPath?: string
  installedRuntimePath?: string
}
