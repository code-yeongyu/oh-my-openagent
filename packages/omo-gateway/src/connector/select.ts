// Argument parsing and surface selection for `omo gateway connect`. The gateway section was already
// validated against the config schema by the CLI wrapper; this reads only what the connector needs
// and refuses what it cannot run on (unknown scope, ambiguous or account-less surface).

import type { Platform } from "../adapter/contract"
import type { ConnectorSurface } from "./credentials"

export type ConnectArgs = {
  scope: string
  surface: string | null
  once: boolean
  shadow: boolean
  foreground: boolean
  adapterModule: string | null
}

type Parsed<T> = ({ kind: "ok" } & T) | { kind: "error"; message: string }

const PLATFORMS: readonly Platform[] = ["slack", "discord", "telegram", "notion", "feishu"]
const VALUE_FLAGS = new Set(["--scope", "--surface", "--sink", "--adapter-module"])

export function parseConnectArgs(argv: readonly string[]): Parsed<{ args: ConnectArgs }> {
  const values = new Map<string, string>()
  const switches = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? ""
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) return { kind: "error", message: `${flag} needs a value` }
      values.set(flag, value)
      index += 1
    } else if (flag === "--once" || flag === "--shadow" || flag === "--foreground") {
      switches.add(flag)
    } else {
      return { kind: "error", message: `unknown argument '${flag}'` }
    }
  }
  const scope = values.get("--scope")
  if (scope === undefined) return { kind: "error", message: "--scope <id> is required" }
  const sink = values.get("--sink")
  if (sink !== undefined && sink !== "stdout") return { kind: "error", message: `unknown sink '${sink}' (supported: stdout)` }
  const once = switches.has("--once")
  return {
    kind: "ok",
    args: {
      scope,
      surface: values.get("--surface") ?? null,
      once,
      shadow: switches.has("--shadow"),
      foreground: once || switches.has("--foreground") || sink === "stdout",
      adapterModule: values.get("--adapter-module") ?? null,
    },
  }
}

const isRecord = (value: unknown): value is object => value !== null && typeof value === "object" && !Array.isArray(value)
const optionalString = (value: object, key: string): string | undefined => {
  const entry: unknown = Reflect.get(value, key)
  return typeof entry === "string" ? entry : undefined
}

function toSurface(value: unknown): ConnectorSurface | null {
  if (!isRecord(value)) return null
  const platform = PLATFORMS.find((candidate) => candidate === Reflect.get(value, "platform"))
  if (platform === undefined) return null
  const surface: ConnectorSurface = { platform }
  for (const key of ["account_id", "credentials_dir", "credentials_file", "credentials_env"] as const) {
    const entry = optionalString(value, key)
    if (entry !== undefined) surface[key] = entry
  }
  const tokenKind = optionalString(value, "token_kind")
  if (tokenKind === "user" || tokenKind === "bot") surface.token_kind = tokenKind
  const listen: unknown = Reflect.get(value, "listen")
  const owned: unknown = isRecord(listen) ? Reflect.get(listen, "owned_chats") : undefined
  if (Array.isArray(owned)) surface.listen = { owned_chats: owned.filter((chat): chat is string => typeof chat === "string") }
  return surface
}

export function selectSurface(
  gateway: unknown,
  args: ConnectArgs,
): Parsed<{ scope: string; surface: ConnectorSurface; account_id: string }> {
  const scopes: unknown = isRecord(gateway) ? Reflect.get(gateway, "scopes") : undefined
  const scope = Array.isArray(scopes) ? scopes.find((entry) => isRecord(entry) && Reflect.get(entry, "id") === args.scope) : undefined
  if (!isRecord(scope)) return { kind: "error", message: `no gateway scope '${args.scope}' in the user config` }
  const rawSurfaces: unknown = Reflect.get(scope, "surfaces")
  const surfaces = (Array.isArray(rawSurfaces) ? rawSurfaces : []).map(toSurface).filter((entry) => entry !== null)
  const matching = args.surface === null ? surfaces : surfaces.filter((entry) => entry.platform === args.surface)
  if (matching.length === 0) {
    const wanted = args.surface === null ? "any surface" : `a ${args.surface} surface`
    return { kind: "error", message: `scope '${args.scope}' has no ${wanted}` }
  }
  if (matching.length > 1) {
    const list = matching.map((entry) => entry.platform).join(", ")
    return { kind: "error", message: `scope '${args.scope}' has several surfaces (${list}); pick one with --surface <platform>` }
  }
  const [surface] = matching
  if (surface === undefined) return { kind: "error", message: `scope '${args.scope}' has no surface` }
  if (surface.account_id === undefined) {
    return { kind: "error", message: `the ${surface.platform} surface of scope '${args.scope}' needs an account_id` }
  }
  return { kind: "ok", scope: args.scope, surface, account_id: surface.account_id }
}
