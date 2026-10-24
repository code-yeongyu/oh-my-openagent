import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { isAllowedMcpEnvVar } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/configure-allowed-env-vars"
import { createCleanMcpEnvironment } from "./env-cleaner"
import type { SkillMcpClientInfo } from "./types"
import { declarationDigest as hashIdentity } from "./env-grants-store"

export const SAFE_MCP_ENV_NAMES = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "TMPDIR", "TMP", "TEMP", "TZ",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_COLLATE", "LC_MESSAGES", "LC_MONETARY",
  "LC_NUMERIC", "LC_TIME", "LC_ADDRESS", "LC_IDENTIFICATION", "LC_MEASUREMENT", "LC_NAME", "LC_PAPER", "LC_TELEPHONE",
  "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USERNAME", "SYSTEMROOT",
  "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "PROGRAMFILES", "PROCESSOR_ARCHITECTURE",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
] as const
const safe = new Set<string>(SAFE_MCP_ENV_NAMES)
const packageExclusion = /^(?:NPM_CONFIG_|YARN_|PNPM_|NO_UPDATE_NOTIFIER$)/i

export const policyHash = hashIdentity
function canonicalPath(path: string): string {
  try { return realpathSync.native(path) } catch (error) {
    if (!(error instanceof Error)) throw error
    return resolve(path)
  }
}
export function declarationDigest(info: SkillMcpClientInfo, config: ClaudeCodeMcpServer): string {
  return policyHash({
    sourcePath: canonicalPath(info.sourcePath ?? info.provenance?.selectedRoot ?? info.directory ?? "."),
    sourceKind: info.sourceKind ?? "frontmatter",
    projectRoot: canonicalPath(info.provenance?.projectRoot ?? info.directory ?? "."),
    serverName: info.serverName, raw: config, cwdBase: canonicalPath(info.directory ?? info.provenance?.projectRoot ?? "."),
  })
}
export function usesProjectEnvironment(info: SkillMcpClientInfo): boolean {
  if (info.provenance?.kind === "project-auto") return true
  if (info.provenance?.kind === "host" || info.scope === "host") return !info.hostUserTrusted
  if (info.provenance?.kind === "user" || info.provenance?.kind === "builtin") return false
  return ["project", "opencode-project", "local"].includes(info.scope ?? "")
}

export function resolveProjectEnvironment(
  raw: ClaudeCodeMcpServer, grantedNames: readonly string[],
  explicit: Readonly<Record<string, string>> = {},
  ambient: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): { config: ClaudeCodeMcpServer; env: Record<string, string>; withheld: string[] } {
  const windows = platform === "win32"
  const key = (name: string) => windows ? name.toUpperCase() : name
  const ambientValues = new Map<string, { name: string; value: string }>()
  for (const [name, value] of Object.entries(ambient)) {
    if (value === undefined) continue
    const normalized = key(name)
    if (!ambientValues.has(normalized) || name === normalized) ambientValues.set(normalized, { name, value })
  }
  const grants = new Set(grantedNames.map(key))
  const withheld = new Set<string>()
  const expand = (value: string) => value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (literal, name: string, fallback?: string) => {
    if (!isAllowedMcpEnvVar(name) && !grants.has(key(name))) { withheld.add(name); return literal }
    return ambientValues.get(key(name))?.value ?? fallback ?? ""
  })
  const expandMap = (values: Record<string, string> | undefined) => values === undefined ? undefined :
    Object.fromEntries(Object.entries(values).map(([name, value]) => [name, expand(value)]))
  const config: ClaudeCodeMcpServer = {
    ...raw, command: raw.command === undefined ? undefined : expand(raw.command),
    args: raw.args?.map(expand), url: raw.url === undefined ? undefined : expand(raw.url),
    env: expandMap(raw.env), headers: expandMap(raw.headers),
    oauth: raw.oauth === undefined ? undefined : {
      ...raw.oauth, clientId: raw.oauth.clientId === undefined ? undefined : expand(raw.oauth.clientId),
      scopes: raw.oauth.scopes?.map(expand),
    },
  }
  const env: Record<string, string> = {}
  for (const { name, value } of ambientValues.values()) {
    if (packageExclusion.test(name)) continue
    if (safe.has(key(name)) || grants.has(key(name))) env[name] = value
  }
  for (const [name, value] of Object.entries({ ...explicit, ...config.env })) {
    if (windows) for (const existing of Object.keys(env)) if (key(existing) === key(name)) delete env[existing]
    env[name] = value
  }
  const passed = new Set(Object.keys(env).map(key))
  if (raw.type === "stdio" || (!raw.type && !raw.url && raw.command)) {
    for (const name of Object.keys(createCleanMcpEnvironment({}, ambient))) {
      if (!passed.has(key(name))) withheld.add(name)
    }
  }
  return { config, env, withheld: [...withheld].sort() }
}
