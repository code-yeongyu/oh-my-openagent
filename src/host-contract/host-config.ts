import type { HostKind } from "./host-kind"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }

export type HostConfigRoot = {
  host: HostKind
  cwd: string
  userConfigDir: string
  projectConfigDir: string
  extensionRoot: string
  settingsPath?: string
}

export type HostConfigSource = {
  path: string
  scope: "user" | "project" | "runtime"
  optional: boolean
}

export type HostConfigLoadRequest = {
  root: HostConfigRoot
  sources: readonly HostConfigSource[]
}

export type HostConfigSnapshot = {
  root: HostConfigRoot
  values: JsonObject
  loadedPaths: readonly string[]
}
