import type { HostConfigRoot, HostKind } from "../host-contract"
import { findExistingHostSettingsFile, type PathExists } from "./settings-file"
import { resolveHostRuntimePaths, type HostRuntimePathOptions } from "./runtime-paths"

export type HostConfigRootOptions = HostRuntimePathOptions & {
  existsPath?: PathExists
}

const missingPath: PathExists = () => false

export function createHostConfigRoot(options: HostConfigRootOptions): HostConfigRoot {
  const runtimePaths = resolveHostRuntimePaths(options)
  const settingsFile = findExistingHostSettingsFile(runtimePaths, options.existsPath ?? missingPath)

  return {
    host: runtimePaths.host,
    cwd: runtimePaths.cwd,
    userConfigDir: runtimePaths.userConfigDir,
    projectConfigDir: runtimePaths.projectConfigDir,
    extensionRoot: runtimePaths.extensionRoot,
    settingsPath: settingsFile?.path,
  }
}

export function createHostConfigRoots(
  options: Omit<HostConfigRootOptions, "host"> & { hosts: readonly HostKind[] },
): readonly HostConfigRoot[] {
  return options.hosts.map((host) => createHostConfigRoot({ ...options, host }))
}
