/**
 * The credential stage of `omo setup`: API keys from opencode's auth.json and the oh-my-pi /
 * gajae-code agent databases, classified against the engine's `<agentDir>/auth.json`. `plan*` only
 * reads; `applyCredentials` is the one writer.
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { readRow, readRows } from "./sqlite-rows.js"
import { credentialGuidance } from "./setup-guidance.js"
import { literalConfigValue, readAuthStore, writeAuthStore } from "./auth-store.js"
import providerMap from "./provider-map.json" with { type: "json" }

export const API_KEY_TYPE_ACCEPTLIST = new Set(["api_key"])
const SQLITE_STORES = [
  ["oh-my-pi", ".omp", 7],
  ["gajae-code", ".gjc", 4],
]

function sorted(values) {
  return [...new Set(values)].sort()
}

function readProviderMap() {
  return providerMap
}

function targetProvider(provider, providerMap) {
  if (providerMap.builtinProviderIds.includes(provider)) return provider
  return providerMap.providers[provider]
}

function candidate(provider, key, source, providerMap) {
  const target = targetProvider(provider, providerMap)
  return target ? { provider: target, key, source } : { provider, source, unmapped: true }
}

function readOpencode(path, providerMap, plan) {
  if (!existsSync(path)) return
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return
    for (const [provider, entry] of Object.entries(parsed)) {
      if (entry === null || typeof entry !== "object") continue
      if (entry.type === "oauth") {
        plan.oauth.push(provider)
      } else if (entry.type === "api" && typeof entry.key === "string") {
        plan.candidates.push(candidate(provider, literalConfigValue(entry.key), "opencode", providerMap))
      }
    }
  } catch (error) {
    plan.notices.push(`WARN opencode: could not parse auth.json: ${error.message}`)
  }
}

function readSqliteStore(id, path, expectedVersion, DatabaseSync, providerMap, plan) {
  if (!existsSync(path)) return
  let database
  try {
    database = new DatabaseSync(path, { readOnly: true })
    const version = readRow(database, ["version"], "SELECT version FROM auth_schema_version")?.version
    if (version !== expectedVersion) {
      plan.notices.push(`NOTICE ${id}: auth schema version ${String(version)} is unknown; credentials not imported`)
      return
    }
    const rows = readRows(
      database,
      ["provider", "credential_type", "data"],
      "SELECT provider, credential_type, data FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY id ASC",
    )
    for (const row of rows) {
      if (row.credential_type === "oauth") {
        plan.oauth.push(row.provider)
        continue
      }
      if (!API_KEY_TYPE_ACCEPTLIST.has(row.credential_type)) continue
      try {
        const data = JSON.parse(row.data)
        if (typeof data?.key === "string") {
          plan.candidates.push(candidate(row.provider, data.key, id, providerMap))
        }
      } catch {
        plan.notices.push(`WARN ${id}: ignored malformed ${row.credential_type} row for ${row.provider}`)
      }
    }
  } catch (error) {
    plan.notices.push(`WARN ${id}: could not inspect agent.db: ${error.message}`)
  } finally {
    database?.close()
  }
}

function opencodeAuthPath(options) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode", "auth.json")
}

// The opencode providers signed in with OAuth, read by the same reader as the credential plan; the
// model-choice stage carries their models to the provider that plan tells the user to /login to.
export function opencodeOauthProviders(options) {
  const plan = { candidates: [], oauth: [], notices: [] }
  readOpencode(opencodeAuthPath(options), readProviderMap(), plan)
  return new Set(plan.oauth)
}

async function readSources(options, providerMap) {
  const home = options.home ?? homedir()
  const plan = { candidates: [], oauth: [], notices: [] }
  readOpencode(opencodeAuthPath(options), providerMap, plan)
  try {
    const { DatabaseSync } = await (options.loadSqlite ?? (() => import("node:sqlite")))()
    for (const [id, directory, version] of SQLITE_STORES) {
      readSqliteStore(id, join(home, directory, "agent", "agent.db"), version, DatabaseSync, providerMap, plan)
    }
  } catch {
    plan.notices.push("NOTICE setup: node:sqlite unavailable; database credentials not imported")
  }
  return plan
}

// An unmapped key whose provider the custom-provider stage carries over is imported there, with it.
function classify(sources, existing, customProviderIds) {
  const additions = []
  const skippedExisting = []
  const skippedUnmapped = []
  const reserved = new Set(Object.keys(existing))
  for (const item of sources.candidates) {
    if (item.unmapped) {
      if (!customProviderIds.has(item.provider)) skippedUnmapped.push(item.provider)
    } else if (reserved.has(item.provider)) {
      skippedExisting.push(item.provider)
    } else {
      reserved.add(item.provider)
      additions.push(item)
    }
  }
  return {
    additions,
    skippedExisting: sorted(skippedExisting),
    skippedOauth: sorted(sources.oauth),
    skippedUnmapped: sorted(skippedUnmapped),
  }
}

/** What the stage would write into `target`, and what it tells the user about the rest. Read-only. */
export async function planCredentials(runtime, target, customProviderIds) {
  const providerMap = readProviderMap()
  const sources = await readSources(runtime, providerMap)
  const current = readAuthStore(target)
  if (current.malformed) {
    const notices = [...sources.notices, "WARN senpi: malformed auth.json; credentials were not imported"]
    return { target, current, notices, malformed: true, pending: 0, found: sources.candidates.length + sources.oauth.length }
  }
  const result = classify(sources, current.entries, customProviderIds)
  return {
    target,
    current,
    notices: sources.notices,
    result,
    guidance: credentialGuidance(result, providerMap, current.entries),
    pending: result.additions.length,
    found: sources.candidates.length + sources.oauth.length,
  }
}

export function applyCredentials(plan) {
  writeAuthStore(plan.target, plan.current, plan.result.additions)
}

function list(label, ids) {
  return `${label}: ${ids.length > 0 ? ids.join(", ") : "none"}`
}

export function credentialPlanLines(plan) {
  if (plan.malformed) return []
  return [
    list("planned-add", plan.result.additions.map((item) => item.provider)),
    list("skipped-existing", plan.result.skippedExisting),
    list("skipped-oauth", plan.result.skippedOauth),
    list("skipped-unmapped", plan.result.skippedUnmapped),
  ]
}

export function credentialCounts(plan) {
  if (plan.malformed) return []
  return [
    `imported: ${plan.result.additions.length}`,
    `skipped-existing: ${plan.result.skippedExisting.length}`,
    `skipped-oauth: ${plan.result.skippedOauth.length}`,
    `skipped-unmapped: ${plan.result.skippedUnmapped.length}`,
  ]
}

export function credentialQuestion(plan) {
  return `Import API credentials for ${plan.result.additions.map((item) => item.provider).join(", ")} into ${plan.target}? [y/N] `
}
