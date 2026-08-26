import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { canonicalAgentDir } from "./agent-dir.js"

export const KNOWN_AUTH_SCHEMA_VERSIONS = new Set([4, 7])

function sorted(values) {
  return [...new Set(values)].sort()
}

function harness(id, installed, providers = [], credentialTypes = [], modelHint = "none") {
  return {
    id,
    installed,
    providers: sorted(providers),
    credentialTypes: sorted(credentialTypes),
    entryCount: providers.length,
    importableCount: 0,
    modelHint,
    notices: [],
  }
}

function readAuthJson(id, path) {
  if (!existsSync(path)) return harness(id, false)
  const result = harness(id, true)
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected an object")
    }
    for (const [provider, entry] of Object.entries(parsed)) {
      result.providers.push(provider)
      const type = entry !== null && typeof entry === "object" && typeof entry.type === "string"
        ? entry.type
        : "unknown"
      result.credentialTypes.push(type)
      if (id === "opencode" && type === "api") result.importableCount += 1
    }
    result.providers = sorted(result.providers)
    result.credentialTypes = sorted(result.credentialTypes)
    result.entryCount = result.providers.length
  } catch (error) {
    result.notices.push(`could not parse auth.json: ${error.message}`)
  }
  return result
}

function readSenpiModels(path, result) {
  if (!existsSync(path)) return
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    const providers = parsed?.providers
    if (providers !== null && typeof providers === "object" && !Array.isArray(providers)) {
      const ids = sorted(Object.keys(providers))
      result.modelHint = ids.length > 0 ? `providers: ${ids.join(", ")}` : "providers: none"
    }
  } catch (error) {
    result.notices.push(`could not parse models.json: ${error.message}`)
  }
}

function readGajaeModels(path) {
  if (!existsSync(path)) return "none"
  try {
    const lines = readFileSync(path, "utf8").split(/\r?\n/)
    const enabledModels = []
    const modelRoles = []
    let section
    for (const line of lines) {
      if (/^enabledModels\s*:/.test(line)) {
        section = "enabledModels"
        continue
      }
      if (/^modelRoles\s*:/.test(line)) {
        section = "modelRoles"
        continue
      }
      if (/^[^\s#][^:]*\s*:/.test(line)) {
        section = undefined
        continue
      }
      if (section === "enabledModels") {
        const match = line.match(/^\s+-\s+(.+?)\s*$/)
        if (match) enabledModels.push(match[1].replace(/^['"]|['"]$/g, ""))
      } else if (section === "modelRoles") {
        const match = line.match(/^\s+([^#][^:]*?)\s*:/)
        if (match) modelRoles.push(match[1].trim())
      }
    }
    const hints = []
    if (enabledModels.length > 0) hints.push(`enabledModels: ${sorted(enabledModels).join(", ")}`)
    if (modelRoles.length > 0) hints.push(`modelRoles: ${sorted(modelRoles).join(", ")}`)
    return hints.length > 0 ? hints.join("; ") : "none"
  } catch {
    return "none"
  }
}

function inspectSqlite(id, path, DatabaseSync, modelHint) {
  const result = harness(id, existsSync(path), [], [], modelHint)
  if (!result.installed) return result
  let database
  try {
    database = new DatabaseSync(path, { readOnly: true })
    const schema = database.prepare("SELECT version FROM auth_schema_version").get()
    const version = schema?.version
    if (!KNOWN_AUTH_SCHEMA_VERSIONS.has(version)) {
      result.notices.push(`auth schema version ${String(version)} is unknown; credentials not inspected`)
      return result
    }
    const rows = database.prepare(
      "SELECT provider, credential_type, disabled_cause FROM auth_credentials",
    ).all()
    result.providers = sorted(rows.map((row) => row.provider))
    result.credentialTypes = sorted(rows.map((row) => row.credential_type))
    result.entryCount = rows.length
    result.importableCount = rows.filter((row) =>
      row.disabled_cause === null && row.credential_type === "api_key",
    ).length
  } catch (error) {
    result.notices.push(`could not inspect agent.db: ${error.message}`)
  } finally {
    database?.close()
  }
  return result
}

/**
 * Every filesystem input detection reads, in a stable order, so a cache can fingerprint exactly
 * what the answer depends on. `detectHarnesses` resolves its own paths through this list, which
 * keeps the cache key and the live detection from ever drifting apart.
 */
export function detectedFilePaths(home = homedir(), env = process.env) {
  const agentDir = canonicalAgentDir(env, home)
  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share")
  return [
    join(agentDir, "auth.json"),
    join(agentDir, "models.json"),
    join(dataHome, "opencode", "auth.json"),
    join(home, ".omp", "agent", "agent.db"),
    join(home, ".omp", "agent", "models.db"),
    join(home, ".gjc", "agent", "agent.db"),
    join(home, ".gjc", "agent", "config.yml"),
  ]
}

export async function detectHarnesses(options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const [senpiAuthPath, senpiModelsPath, opencodeAuthPath, ompPath, ompModelsPath, gjcPath, gjcConfigPath] =
    detectedFilePaths(home, env)
  const senpi = readAuthJson("senpi", senpiAuthPath)
  readSenpiModels(senpiModelsPath, senpi)
  const opencode = readAuthJson("opencode", opencodeAuthPath)
  const ompModels = existsSync(ompModelsPath) ? "models.db: yes" : "models.db: no"
  const gjcModels = readGajaeModels(gjcConfigPath)
  let DatabaseSync
  try {
    const sqlite = await (options.loadSqlite ?? (() => import("node:sqlite")))()
    DatabaseSync = sqlite.DatabaseSync
  } catch {
    const omp = harness("oh-my-pi", existsSync(ompPath), [], [], ompModels)
    const gjc = harness("gajae-code", existsSync(gjcPath), [], [], gjcModels)
    for (const item of [omp, gjc]) {
      if (item.installed) item.notices.push("node:sqlite unavailable; file presence only")
    }
    return { harnesses: [senpi, opencode, omp, gjc] }
  }
  return {
    harnesses: [
      senpi,
      opencode,
      inspectSqlite("oh-my-pi", ompPath, DatabaseSync, ompModels),
      inspectSqlite("gajae-code", gjcPath, DatabaseSync, gjcModels),
    ],
  }
}

export function needsSetupSuggestion(inventory) {
  const senpi = inventory.harnesses.find((item) => item.id === "senpi")
  const siblingInstalled = inventory.harnesses.some((item) => item.id !== "senpi" && item.installed)
  return (senpi?.entryCount ?? 0) === 0 && siblingInstalled
}
