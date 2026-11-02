// Space binding keys (sync-design §3): what a project IS, computed identically on every
// device, so two devices that enable sync while offline land in one space. `named:` for a
// named agent profile, `repo:` + the canonical remote URL for a project with a git remote,
// `local:` + 128 random bits (stored in `omo.sync.binding`) for a remote-less project. The
// space id is the binding key's sha-256 truncated to 128 bits; it only ever travels inside
// the encrypted payload.

import { createHash, getRandomValues } from "node:crypto"

export type BindingKey = string

export interface Remote {
  readonly name: string
  readonly url: string
}

export type BindingKind = "named" | "repo" | "local"

const LOCAL_HEX_RE = /^[0-9a-f]{32}$/
const SPACE_ID_HEX = 32
const DEFAULT_PORTS: Readonly<Record<string, string>> = { http: "80", https: "443", ssh: "22", git: "9418" }
const SCP_LIKE_RE = /^([^\s@/:]+@)?([^\s@/:]+):(\S.*)?$/

export function canonicalRemoteUrl(url: string): string {
  const trimmed = url.trim()
  let host = ""
  let path = ""
  let port = ""
  if (!trimmed.includes("://")) {
    const scp = SCP_LIKE_RE.exec(trimmed)
    if (scp !== null) {
      host = scp[2] ?? ""
      path = scp[3] ?? ""
    } else {
      const slash = trimmed.indexOf("/")
      host = slash < 0 ? trimmed : trimmed.slice(0, slash)
      path = slash < 0 ? "" : trimmed.slice(slash + 1)
    }
  } else {
    const parsed = new URL(trimmed)
    host = parsed.hostname
    port = parsed.port
    if (port !== "" && DEFAULT_PORTS[parsed.protocol.replace(/:$/, "")] === port) port = ""
    path = parsed.pathname.replace(/^\/+/, "")
  }
  path = path.replace(/^\/+|\/+$/g, "")
  if (/\.git$/i.test(path)) path = path.slice(0, -".git".length)
  path = path.replace(/\/+$/, "")
  const authority = port === "" ? host.toLowerCase() : `${host.toLowerCase()}:${port}`
  return path === "" ? authority : `${authority}/${path}`
}

export function namedBinding(profile: string): BindingKey {
  const value = profile.trim().normalize("NFC")
  if (value === "") throw new TypeError("namedBinding: profile value is empty after trimming")
  return `named:${value}`
}

export function repoBinding(remotes: readonly Remote[]): BindingKey | null {
  const ordered = [...remotes].sort((a, b) =>
    a.name === b.name ? 0 : a.name === "origin" ? -1 : b.name === "origin" ? 1 : a.name < b.name ? -1 : 1,
  )
  for (const remote of ordered) {
    try {
      return `repo:${canonicalRemoteUrl(remote.url)}`
    } catch (error) {
      // A malformed remote is not a project identity; try the next one or local:.
      if (!(error instanceof TypeError)) throw error
    }
  }
  return null
}

export function localBinding(randomHex128: string): BindingKey {
  if (!LOCAL_HEX_RE.test(randomHex128)) {
    throw new TypeError("localBinding: entropy must be 128 bits as 32 lowercase hex characters")
  }
  return `local:${randomHex128}`
}

export function mintLocalBinding(): BindingKey {
  return localBinding(Buffer.from(getRandomValues(new Uint8Array(16))).toString("hex"))
}

export function parseBinding(raw: string): { readonly kind: BindingKind; readonly value: string } | null {
  for (const kind of ["named", "repo"] as const) {
    const prefix = `${kind}:`
    if (raw.startsWith(prefix) && raw.length > prefix.length) return { kind, value: raw.slice(prefix.length) }
  }
  if (raw.startsWith("local:")) {
    const value = raw.slice("local:".length)
    return LOCAL_HEX_RE.test(value) ? { kind: "local", value } : null
  }
  return null
}

export function spaceIdForBinding(binding: BindingKey): string {
  return createHash("sha256").update(binding, "utf8").digest("hex").slice(0, SPACE_ID_HEX)
}

export function syncedAgentDirName(spaceId: string): string {
  return `synced-${spaceId.slice(0, 8)}`
}
