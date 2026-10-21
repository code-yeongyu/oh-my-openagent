/**
 * The per-server consent layer of `omo setup`. The setup stream plans every server
 * (MCP servers, custom providers) at once and asks the user to consent in bulk;
 * `omo setup` now asks per server instead, so a user can keep one MCP server out
 * of `~/.omo/agent/mcp.json` while carrying the rest, and a custom-provider key
 * without sharing every key in `~/.omo/agent/auth.json`. `--yes` keeps the
 * legacy batch prompt for script callers; opt-out config (`setup.opt_out.<scope>`)
 * short-circuits the prompt and records the reason in `accept=false`.
 *
 *   - `setup.opt_out.<server-name>`   — exact name of an MCP server or provider id
 *   - `setup.opt_out.kind.<kind>`     — `mcp` | `provider` (`mcp` covers built-in and skill-embedded kinds)
 *   - `setup.opt_out.source.<glob>`   — POSIX glob over the canonical file refs the server's
 *                                        headers / keys reference; `*` matches any path under the
 *                                        secret's directory, `?` matches a single path segment.
 *                                        When PR-A lands, the file-ref text is the resolved canonical
 *                                        path; until then, it is the raw `{file:...}` body.
 *
 * Three scopes compose: a server is skipped if any of the three matches.
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { parseJsonc } from "./jsonc.js"

const FILE_REF_PLACEHOLDER = /\{file:([^}]+)\}/g

export const SKIP_REASONS = {
  SERVER: "opt-out:server",
  KIND: "opt-out:kind",
  SOURCE: "opt-out:source",
}

const KINDS = new Set(["mcp", "provider"])

// Anything `~`-prefixed lands at the home of the same env that resolved the path. The user-level
// `setup.opt_out` lives under `~/.omo/omo.jsonc`; the project level under `<project>/.omo/omo.jsonc`.
// Only the user-level copy is honored here — the opt-out is a safety, not a project-config knob.
function userOmoConfigPath(env, home) {
  const dir = join(env.OMO_HOME ?? join(home, ".omo"))
  if (!existsSync(dir)) return null
  const jsonc = join(dir, "omo.jsonc")
  if (existsSync(jsonc)) return jsonc
  const json = join(dir, "omo.json")
  return existsSync(json) ? json : null
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readUserConfig(path) {
  try {
    const parsed = parseJsonc(readFileSync(path, "utf8"))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    // A malformed user config must not crash the consent layer; the consent prompt falls back to
    // asking per server with no opt-out applied, exactly like a missing file.
    return null
  }
}

// A small literal glob walker for `setup.opt_out.source.<glob>` entries: a `*` matches any
// run of characters, a `?` matches one non-`/` character. Built char-by-char so the source
// file never constructs an engine-side `RegExp` and is safe against adversarial input.
function globMatch(needle, value) {
  let needleIndex = 0
  let valueIndex = 0
  let starNeedle = -1
  let starValue = 0
  while (valueIndex < value.length) {
    if (needleIndex < needle.length && (needle[needleIndex] === "?" || needle[needleIndex] === value[valueIndex])) {
      needleIndex += 1
      valueIndex += 1
      continue
    }
    if (needleIndex < needle.length && needle[needleIndex] === "*") {
      starNeedle = needleIndex
      starValue = valueIndex
      needleIndex += 1
      continue
    }
    if (starNeedle !== -1) {
      needleIndex = starNeedle + 1
      starValue += 1
      valueIndex = starValue
      continue
    }
    return false
  }
  while (needleIndex < needle.length && needle[needleIndex] === "*") needleIndex += 1
  return needleIndex === needle.length
}

function buildOptOutFromConfig(optOutBlock) {
  const byName = new Map()
  const byKind = new Map()
  const bySource = []
  if (!isPlainObject(optOutBlock)) return { byName, byKind, bySource }
  for (const [key, value] of Object.entries(optOutBlock)) {
    if (value === true) {
      byName.set(key, SKIP_REASONS.SERVER)
    } else if (isPlainObject(value)) {
      if (key === "kind") {
        for (const [kind, enabled] of Object.entries(value)) {
          if (enabled === true) byKind.set(kind, SKIP_REASONS.KIND)
        }
      } else if (key === "source") {
        for (const [pattern, enabled] of Object.entries(value)) {
          if (enabled === true) bySource.push({ pattern, match: (value) => globMatch(pattern, value), reason: SKIP_REASONS.SOURCE })
        }
      } else {
        byName.set(key, SKIP_REASONS.SERVER)
      }
    }
  }
  return { byName, byKind, bySource }
}

/**
 * Read `~/.omo/omo.json[c]` (or the OMO_HOME override) and return the three opt-out scopes
 * the consent layer matches against. A missing, malformed or empty config returns empty maps.
 */
export async function loadSetupOptOut(options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const path = userOmoConfigPath(env, home)
  if (path === null) return { byName: new Map(), byKind: new Map(), bySource: [] }
  const config = readUserConfig(path)
  if (config === null) return { byName: new Map(), byKind: new Map(), bySource: [] }
  const optOut = config.setup?.opt_out
  return buildOptOutFromConfig(optOut)
}

// Every `{file:...}` substring of a string leaf inside a server config. Files only flow through
// header values and api keys; command args, urls, and the env block are already concrete text.
function collectFileRefs(node, refs = []) {
  if (typeof node === "string") {
    for (const match of node.matchAll(FILE_REF_PLACEHOLDER)) refs.push(match[1])
    return refs
  }
  if (Array.isArray(node)) {
    for (const entry of node) collectFileRefs(entry, refs)
    return refs
  }
  if (node !== null && typeof node === "object") {
    for (const value of Object.values(node)) collectFileRefs(value, refs)
  }
  return refs
}

// An MCP server's provenance: kind, url, the file refs its headers reference, and the keys
// the engine will write for it. The header values the renderer prints are the raw bytes; keys
// are summarized by source so the prompt stays short and never echoes a secret.
function buildMcpConsent(server) {
  const refs = collectFileRefs(server.config)
  const url = typeof server.config?.url === "string" ? server.config.url : undefined
  const command = Array.isArray(server.config?.command) ? server.config.command.join(" ") : undefined
  const provenance = url ?? command ?? ""
  return {
    id: server.name,
    kind: "mcp",
    label: server.name,
    detail: provenance,
    url: provenance,
    fileRefs: [...new Set(refs)].sort(),
    keys: [],
  }
}

function buildProviderConsent(provider, keySource) {
  const baseUrl = typeof provider.config?.baseUrl === "string" ? provider.config.baseUrl : undefined
  const fileRefs = collectFileRefs(provider.config)
  if (provider.key !== undefined) fileRefs.push(...collectFileRefs(provider.key.key))
  const keys = provider.key === undefined ? [] : [keySource ?? provider.key.source ?? "key source unknown"]
  return {
    id: provider.id,
    kind: "provider",
    label: provider.id,
    detail: baseUrl ?? "",
    url: baseUrl,
    fileRefs: [...new Set(fileRefs)].sort(),
    keys,
  }
}

/**
 * The full list of server consents, in stream order: providers first (the credential stage
 * depends on it), then MCP servers. Rows are the user's per-server decision space; `accept` is
 * `null` until the user (or `--yes`, or the opt-out config) answers.
 */
export function perServerPlan(plans) {
  const rows = []
  const providers = plans.providers?.result ?? plans.providers
  if (providers !== undefined) {
    const added = plans.providers?.result?.added ?? plans.providers?.added ?? []
    for (const provider of added) {
      const keySource = provider.key === undefined ? undefined : provider.key.source
      rows.push({ ...buildProviderConsent(provider, keySource), accept: null })
    }
  }
  const assets = plans.assets?.result ?? plans.assets
  if (assets !== undefined) {
    const added = plans.assets?.result?.servers?.added ?? plans.assets?.servers?.added ?? []
    for (const server of added) rows.push({ ...buildMcpConsent(server), accept: null })
  }
  return rows
}

// Three scopes compose: a server is skipped when ANY of (server-name, kind, source) matches.
// Order matters — server-name wins so a specific opt-out does not get masked by a wider one.
function applyOptOut(row, optOut) {
  if (optOut.byName.has(row.id)) return { ...row, accept: false, skippedReason: SKIP_REASONS.SERVER }
  if (optOut.byKind.has(row.kind)) return { ...row, accept: false, skippedReason: SKIP_REASONS.KIND }
  for (const source of row.fileRefs) {
    for (const entry of optOut.bySource) {
      if (entry.match(source)) return { ...row, accept: false, skippedReason: SKIP_REASONS.SOURCE }
    }
  }
  return row
}

/**
 * `perServerPlan` enriched with three-scope opt-out. Rows keep their `accept: null` so the
 * caller can prompt the rest; an opted-out row carries `skippedReason` for the summary line.
 */
export function buildPerServerConsent(plans, options = {}) {
  const optOut = options.optOut ?? { byName: new Map(), byKind: new Map(), bySource: [] }
  return perServerPlan(plans).map((row) => applyOptOut(row, optOut))
}

/**
 * Walk the consent list; skip rows the opt-out already decided; ask the rest. The prompt
 * decision is per row and the deciding payload comes from `perServerConsentPrompt(row)`.
 * Returns a `Map<serverId, boolean>` the caller hands to `filterPlansByConsent`.
 */
export async function resolvePerServerConsent(consent, askOne) {
  const decisions = new Map()
  for (const row of consent) {
    if (row.accept === false) {
      decisions.set(row.id, false)
      continue
    }
    const accepted = await askOne(row)
    decisions.set(row.id, accepted === true)
  }
  return decisions
}

/**
 * Deep-clone of `plans` with `result.added` filtered to the consented rows per stage. Returned
 * shape matches what `applySetupStages` expects from `collectSetupPlans` — every other stage
 * (credentials, model-choices) is left intact because opt-out cannot name those servers yet.
 *
 * `pending` is recomputed from the filtered lists because the apply stage gates on it directly:
 * a stage whose only remaining work the consent filter dropped must skip, not write an empty stub.
 */
export function filterPlansByConsent(plans, decisions) {
  const filtered = { ...plans }
  if (plans.providers !== undefined) {
    const providers = { ...plans.providers }
    if (providers.result !== undefined) {
      const kept = providers.result.added.filter((provider) => decisions.get(provider.id) !== false)
      const keys = providers.result.keys?.filter((entry) => decisions.get(entry.provider) !== false) ?? []
      providers.result = { ...providers.result, added: kept, keys }
      // Provider stage uses `pending` directly as the per-stage apply gate.
      providers.pending = kept.length
    }
    filtered.providers = providers
  }
  if (plans.assets !== undefined) {
    const assets = { ...plans.assets }
    if (assets.result !== undefined) {
      const result = { ...assets.result }
      if (result.servers !== undefined) {
        result.servers = {
          ...result.servers,
          added: result.servers.added.filter((server) => decisions.get(server.name) !== false),
        }
      }
      assets.result = result
      // Asset stage's `pending` counts both servers and skills; a filtered mcp server list leaves
      // the skill side alone but must lower the gate.
      assets.pending = (result.servers?.added.length ?? 0) + (result.skills?.added.length ?? 0)
    }
    filtered.assets = assets
  }
  return filtered
}

function shorten(value, max = 80) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

// One render per row, plain text — used by the per-server prompt and the dry-run summary alike.
// The user explicitly opted into seeing file-ref paths in the consent line; secrets never ride
// in headers' value form here because we extracted the {file:...} placeholder, not the header value.
export function perServerConsentPrompt(row) {
  const parts = [`${row.id} (${row.kind}`]
  if (row.url !== undefined && row.url !== "") parts.push(`, ${shorten(row.url)}`)
  parts.push(")")
  if (row.fileRefs.length > 0) {
    const refs = row.fileRefs.map((ref) => shorten(ref, 60))
    parts.push(` headers: ${refs.join(", ")}`)
  } else if (row.keys.length > 0) {
    parts.push(` key: ${row.keys.join(", ")}`)
  }
  return `${parts.join("")} Import? [Y/n] `
}
