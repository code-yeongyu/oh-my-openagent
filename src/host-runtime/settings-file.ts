import { join } from "node:path"
import type { HostKind } from "../host-contract"
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../shared/plugin-identity"
import type { HostRuntimePaths } from "./runtime-paths"

export type HostSettingsFormat = "json" | "jsonc" | "yaml"

export type HostSettingsCandidate = {
  host: HostKind
  path: string
  format: HostSettingsFormat
  scope: "user" | "project"
}

export type HostSettingsFile = HostSettingsCandidate & {
  exists: true
}

export type PathExists = (path: string) => boolean

function createOpenCodeCandidates(paths: HostRuntimePaths): HostSettingsCandidate[] {
  return [
    {
      host: "opencode",
      path: join(paths.userConfigDir, `${CONFIG_BASENAME}.jsonc`),
      format: "jsonc",
      scope: "user",
    },
    {
      host: "opencode",
      path: join(paths.userConfigDir, `${CONFIG_BASENAME}.json`),
      format: "json",
      scope: "user",
    },
    {
      host: "opencode",
      path: join(paths.userConfigDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
      format: "jsonc",
      scope: "user",
    },
    {
      host: "opencode",
      path: join(paths.userConfigDir, `${LEGACY_CONFIG_BASENAME}.json`),
      format: "json",
      scope: "user",
    },
  ]
}

function createOhMyPiCandidates(paths: HostRuntimePaths): HostSettingsCandidate[] {
  return [
    { host: "oh-my-pi", path: join(paths.userConfigDir, "settings.json"), format: "json", scope: "user" },
    { host: "oh-my-pi", path: join(paths.userConfigDir, "config.yml"), format: "yaml", scope: "user" },
    { host: "oh-my-pi", path: join(paths.userConfigDir, "config.yaml"), format: "yaml", scope: "user" },
    { host: "oh-my-pi", path: join(paths.projectConfigDir, "settings.json"), format: "json", scope: "project" },
  ]
}

function createPiCandidates(paths: HostRuntimePaths): HostSettingsCandidate[] {
  return [
    { host: "pi", path: join(paths.userConfigDir, "settings.json"), format: "json", scope: "user" },
    { host: "pi", path: join(paths.projectConfigDir, "settings.json"), format: "json", scope: "project" },
  ]
}

export function getHostSettingsCandidates(paths: HostRuntimePaths): readonly HostSettingsCandidate[] {
  switch (paths.host) {
    case "opencode":
      return createOpenCodeCandidates(paths)
    case "oh-my-pi":
      return createOhMyPiCandidates(paths)
    case "pi":
      return createPiCandidates(paths)
  }
}

export function findExistingHostSettingsFile(
  paths: HostRuntimePaths,
  existsPath: PathExists,
): HostSettingsFile | undefined {
  for (const candidate of getHostSettingsCandidates(paths)) {
    if (existsPath(candidate.path)) {
      return { ...candidate, exists: true }
    }
  }
  return undefined
}
