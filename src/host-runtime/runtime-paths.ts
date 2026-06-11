import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { HostKind } from "../host-contract"
import { getOpenCodeConfigPaths } from "../shared/opencode-config-dir"

export type HostRuntimePathOptions = {
  host: HostKind
  cwd: string
  homeDir?: string
  openCodeConfigDir?: string
}

export type HostRuntimePaths = {
  host: HostKind
  cwd: string
  homeDir: string
  userConfigDir: string
  projectConfigDir: string
  extensionRoot: string
}

function resolveHomeDir(homeDir?: string): string {
  return resolve(homeDir ?? homedir())
}

function resolveOpenCodeUserConfigDir(openCodeConfigDir?: string): string {
  if (openCodeConfigDir) return resolve(openCodeConfigDir)
  return getOpenCodeConfigPaths({ binary: "opencode", version: null }).configDir
}

export function resolveHostRuntimePaths(options: HostRuntimePathOptions): HostRuntimePaths {
  const cwd = resolve(options.cwd)
  const homeDir = resolveHomeDir(options.homeDir)

  switch (options.host) {
    case "opencode": {
      const userConfigDir = resolveOpenCodeUserConfigDir(options.openCodeConfigDir)
      return {
        host: options.host,
        cwd,
        homeDir,
        userConfigDir,
        projectConfigDir: join(cwd, ".opencode"),
        extensionRoot: userConfigDir,
      }
    }

    case "oh-my-pi": {
      const agentDir = join(homeDir, ".omp", "agent")
      return {
        host: options.host,
        cwd,
        homeDir,
        userConfigDir: agentDir,
        projectConfigDir: join(cwd, ".omp"),
        extensionRoot: join(agentDir, "extensions"),
      }
    }

    case "pi": {
      const agentDir = join(homeDir, ".pi", "agent")
      return {
        host: options.host,
        cwd,
        homeDir,
        userConfigDir: agentDir,
        projectConfigDir: join(cwd, ".pi"),
        extensionRoot: join(agentDir, "extensions"),
      }
    }
  }
}
