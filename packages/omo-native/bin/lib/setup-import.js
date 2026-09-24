import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline/promises"
import { canonicalAgentDir } from "./agent-dir.js"
import { detectHarnesses } from "./setup-detect.js"
import { readRow, readRows } from "./sqlite-rows.js"
import { printModelReport } from "./setup-models.js"
import { printSetupReport } from "./setup-report.js"
import { formatCredentialGuidance } from "./setup-guidance.js"
import { importOpencodeAssets } from "./setup-assets-import.js"

export const API_KEY_TYPE_ACCEPTLIST = new Set(["api_key"])
const SQLITE_STORES = [
  ["oh-my-pi", ".omp", 7],
  ["gajae-code", ".gjc", 4],
]

function sorted(values) {
  return [...new Set(values)].sort()
}

function readProviderMap() {
  return JSON.parse(readFileSync(new URL("./provider-map.json", import.meta.url), "utf8"))
}

function targetProvider(provider, providerMap) {
  if (providerMap.builtinProviderIds.includes(provider)) return provider
  return providerMap.providers[provider]
}

function candidate(provider, key, source, providerMap) {
  const target = targetProvider(provider, providerMap)
  return target ? { provider: target, key, source } : { provider, source, unmapped: true }
}

// opencode keeps a pasted key verbatim and never interprets it, but the engine resolves every stored
// key as a config value: a leading `!` runs a shell command and `$NAME` / `${NAME}` interpolate the
// environment. `$$` and `$!` are the engine's literal escapes, so the engine reads back the exact
// bytes opencode held.
function literalConfigValue(value) {
  return value.replace(/[$!]/g, "$$$&")
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

async function buildPlan(options, providerMap) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share")
  const plan = { candidates: [], oauth: [], notices: [] }
  readOpencode(join(dataHome, "opencode", "auth.json"), providerMap, plan)
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

function readTarget(path) {
  if (!existsSync(path)) return { entries: {}, bytes: undefined }
  const bytes = readFileSync(path, "utf8")
  try {
    const entries = JSON.parse(bytes)
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) throw new Error("expected object")
    return { entries, bytes }
  } catch {
    return { malformed: true, bytes }
  }
}

function classify(plan, existing) {
  const additions = []
  const skippedExisting = []
  const skippedUnmapped = []
  const reserved = new Set(Object.keys(existing))
  for (const item of plan.candidates) {
    if (item.unmapped) {
      skippedUnmapped.push(item.provider)
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
    skippedOauth: sorted(plan.oauth),
    skippedUnmapped: sorted(skippedUnmapped),
  }
}

function list(label, ids) {
  return `${label}: ${ids.length > 0 ? ids.join(", ") : "none"}`
}

function printPlan(result, dryRun, providerMap, existing) {
  if (dryRun) process.stdout.write("DRY RUN: no files will be written\n")
  process.stdout.write(`${[
    list("planned-add", result.additions.map((item) => item.provider)),
    list("skipped-existing", result.skippedExisting),
    list("skipped-oauth", result.skippedOauth),
    list("skipped-unmapped", result.skippedUnmapped),
  ].join("\n")}\n`)
  process.stdout.write(formatCredentialGuidance(result, providerMap, existing))
}

// The plan (printed on every run, dry or not) already carries the per-credential guidance, so the
// closing counts stay counts - printing the sign-in steps twice reads as two different instructions.
function printCounts(result) {
  process.stdout.write([
    `imported: ${result.additions.length}`,
    `skipped-existing: ${result.skippedExisting.length}`,
    `skipped-oauth: ${result.skippedOauth.length}`,
    `skipped-unmapped: ${result.skippedUnmapped.length}`,
  ].join("\n") + "\n")
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "")
}

function writeTarget(path, current, additions) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (current.bytes !== undefined) copyFileSync(path, `${path}.bak-${timestamp()}`)
  const next = { ...current.entries }
  for (const item of additions) next[item.provider] = { type: "api_key", key: item.key }
  const temporary = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, path)
    chmodSync(path, 0o600)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

async function ask(question, options) {
  if (options.yes) return true
  if (options.stdin?.isTTY !== true || options.stdout?.isTTY !== true) {
    process.stdout.write("Non-interactive setup did not import. Re-run with `omo setup --yes`.\n")
    return false
  }
  process.stdout.write(question)
  const readline = createInterface({ input: options.stdin, output: options.stdout })
  try {
    return (await readline.question("")).trim().toLowerCase() === "y"
  } finally {
    readline.close()
  }
}

function consent(result, target, options) {
  const providers = result.additions.map((item) => item.provider).join(", ")
  return ask(`Import API credentials for ${providers} into ${target}? [y/N] `, options)
}

async function importCredentials(runtime, target, args) {
  const providerMap = readProviderMap()
  const plan = await buildPlan(runtime, providerMap)
  for (const notice of plan.notices) process.stdout.write(`${notice}\n`)
  const current = readTarget(target)
  if (current.malformed) {
    process.stdout.write("WARN senpi: malformed auth.json; credentials were not imported\n")
    return
  }
  const result = classify(plan, current.entries)
  const dryRun = args.includes("--dry-run")
  printPlan(result, dryRun, providerMap, current.entries)
  if (dryRun) return
  if (result.additions.length === 0) {
    printCounts(result)
    return
  }
  if (!await consent(result, target, { ...runtime, yes: args.includes("--yes") })) {
    if (runtime.stdin.isTTY === true) process.stdout.write("Import cancelled\n")
    return
  }
  writeTarget(target, current, result.additions)
  printCounts(result)
}

export async function runSetup(args = process.argv.slice(2), options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const agentDir = canonicalAgentDir(env, home)
  const runtime = { stdin: process.stdin, stdout: process.stdout, ...options, home, env }
  const inventory = await detectHarnesses(runtime)
  printSetupReport(inventory)
  printModelReport(inventory)
  await importCredentials(runtime, join(agentDir, "auth.json"), args)
  await importOpencodeAssets({
    runtime,
    agentDir,
    args,
    confirm: async (question) => {
      const accepted = await ask(question, { ...runtime, yes: args.includes("--yes") })
      if (!accepted && runtime.stdin.isTTY === true) process.stdout.write("Import cancelled\n")
      return accepted
    },
  })
}
