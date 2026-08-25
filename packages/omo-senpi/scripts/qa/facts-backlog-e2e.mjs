#!/usr/bin/env bun
// Live end-to-end QA for the byte-capped facts pipeline (plan todo 12).
//
// Shape: an ISOLATED identity (OMO_MEMORY_HOME + scratch agent dir + isolated omo.json) is seeded
// with a LEGACY-shaped backlog - several queue entry files whose combined payload exceeds 2x
// the 131072-byte cap, plus one individually oversize entry - and the REAL FactsExtractorRunner is
// driven once. The facts children are REAL detached `senpi -p` processes going through the real
// sandbox/supervisor/payload path; only the MODEL is mocked (facts-backlog-e2e-mock-provider.ts),
// which is this suite's convention for deterministic child runs.
//
// Asserted end to end:
//   A the post-success drain splits the backlog into MULTIPLE capped runs from ONE launch call
//   B every run commits with a `Generated-By: facts-extractor` trailer in the memory git repo
//   C losslessness: every seeded entry is either consumed by a committed run or explicitly PARKED
//   D no payload survives a terminal run; no `skipped_overflow` anywhere
//   E the oversize entry is parked ONCE (not looped) and never truncated or consumed
//   F the real ~/.omo and ~/.senpi/agent are byte-identical before/after (shasum proof)
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const mockProviderEntry = join(scriptDir, "facts-backlog-e2e-mock-provider.ts")
const IDENTITY = "facts-backlog-qa"
const CAP = 131_072
const results = []
const failures = []
const cleanup = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures.push({ name, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` :: ${detail}`}`)
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Digest of a real user directory: the isolation proof. Volatile session/log paths a live host
 * rewrites on its own are excluded, exactly as memory-e2e.mjs does. */
const VOLATILE = new Set([
  "sessions",
  "senpi-debug.log",
  "mcp-cache.json",
  "mcp-auth",
  "settings.json",
  "telemetry.log",
  "goals",
  "logs",
  "omo-debug.log",
  "OmO-debug.log",
  "OmO-crash.log",
  "last-payloads.json",
])
function hashFiles(root, excludePrefix = undefined) {
  const files = new Map()
  if (!existsSync(root)) return files
  const walk = (dir) => {
    for (const name of readdirSync(dir).toSorted()) {
      if (VOLATILE.has(name)) continue
      const full = join(dir, name)
      const stats = statSync(full, { throwIfNoEntry: false })
      if (stats === undefined) continue
      if (stats.isDirectory()) { walk(full); continue }
      if (!stats.isFile()) continue
      const rel = full.slice(root.length + 1)
      if (excludePrefix !== undefined && rel.startsWith(excludePrefix)) continue
      files.set(rel, createHash("sha256").update(readFileSync(full)).digest("hex"))
    }
  }
  walk(root)
  return files
}

function hashDir(root, excludePrefix = undefined) {
  const hash = createHash("sha256")
  for (const [name, digest] of [...hashFiles(root, excludePrefix)].toSorted()) {
    hash.update(name)
    hash.update(digest)
  }
  return hash.digest("hex")
}


function transcriptEntry(messageId, text) {
  return {
    kind: "user",
    text,
    captured_at: "2026-08-16T00:00:00.000Z",
    source_line_id: `${messageId}:user`,
    source_message_id: messageId,
  }
}

function gitLines(repo, format) {
  const run = spawnSync("git", ["log", `--format=${format}`, "HEAD"], { cwd: repo, encoding: "utf8" })
  return run.status === 0 ? run.stdout.trim().split("\n").filter((line) => line.length > 0) : []
}

async function main() {
  const senpiBin = process.env.SENPI_BIN ?? findOnPath("senpi")
  if (senpiBin === null) throw new Error("senpi binary not found (set SENPI_BIN)")
  // Scoped isolation proof (memory-e2e.mjs philosophy): a busy host rewrites unrelated ~/.omo
  // paths (codegraph stamps, backups, concurrent sessions' memory repos) throughout any run, so
  // whole-home equality is unattainable. What the facts pipeline could ever touch is the
  // credential/settings surface and the memory root - those must stay byte-identical, and the
  // driver's own identity must never appear under the real home.
  const CREDENTIALS = ["auth.json", "settings.json", "models.json", "trust.json"]
  // drive.mjs's credentialDigest philosophy: settings.json is compared after dropping the volatile
  // interactive-session stamps a concurrent host TUI rewrites on its own lifecycle.
  const credentialBytes = (path, name) => {
    const content = readFileSync(path)
    if (name !== "settings.json") return content
    try {
      const settings = JSON.parse(content.toString("utf8"))
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return content
      delete settings.tipsHistory
      delete settings.lastChangelogVersion
      return JSON.stringify(settings)
    } catch {
      return content
    }
  }
  const credentialSnapshot = (dir) => new Map(CREDENTIALS.map((name) => {
    const path = join(dir, name)
    return [path, existsSync(path) ? createHash("sha256").update(credentialBytes(path, name)).digest("hex") : "absent"]
  }))
  const omoAgentCredentialsBefore = credentialSnapshot(join(homedir(), ".omo", "agent"))
  const senpiCredentialsBefore = credentialSnapshot(join(homedir(), ".senpi", "agent"))
  const realMemoryBefore = hashDir(join(homedir(), ".omo", "memory"), "agents")
  const realAgentBefore = hashDir(join(homedir(), ".senpi", "agent"))

  const root = mkdtempSync(join(tmpdir(), "omo-facts-backlog-qa-"))
  cleanup.push(root)
  const memoryHome = join(root, "memory")
  const agentDir = join(root, "agent")
  const cwd = join(root, "project")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  // Scratch agent dir stubs: the category resolver drops providers without configured auth.
  writeFileSync(join(agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({ theme: "dark" }, null, 2)}\n`)
  writeFileSync(join(cwd, ".omo", "omo.json"), `${JSON.stringify({
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: { enabled: true, facts: { enabled: true } },
  }, null, 2)}\n`)

  process.env.OMO_MEMORY_HOME = memoryHome
  process.env.SENPI_CODING_AGENT_DIR = agentDir
  process.env.XDG_CONFIG_HOME = join(root, "xdg")

  const core = await import("@oh-my-opencode/memory-core")
  const { FactsExtractorRunner } = await import(join(packageRoot, "src", "components", "memory", "facts-runner.ts"))
  const identity = {
    id: IDENTITY,
    safeSlug: IDENTITY,
    paths: core.buildIdentityPaths(memoryHome, IDENTITY),
  }
  const queue = new core.FactsQueue({ identityPaths: identity.paths })

  // LEGACY-SHAPED BACKLOG: three ordinary conversations whose combined payload is well past 2x the
  // cap, plus one conversation carrying a single entry larger than the cap on its own.
  const bulk = "y".repeat(Math.floor(CAP * 0.8))
  const seeded = []
  for (const conversationId of ["legacy-1", "legacy-2", "legacy-3"]) {
    await queue.enqueue({
      identity: IDENTITY,
      sessionId: conversationId,
      conversationId,
      entries: [transcriptEntry(`${conversationId}-m1`, bulk)],
    })
    seeded.push(`${conversationId}:${conversationId}-m1`)
  }
  await queue.enqueue({
    identity: IDENTITY,
    sessionId: "legacy-oversize",
    conversationId: "legacy-oversize",
    entries: [transcriptEntry("legacy-oversize-m1", "z".repeat(CAP * 2))],
  })
  seeded.push("legacy-oversize:legacy-oversize-m1")
  const seededFiles = readdirSync(identity.paths.factsQueue).filter((name) => name.endsWith(".json") && name !== "consumed.json")
  record("seeded legacy backlog (4 queue entry files, one oversize)", seededFiles.length === 4, `${seededFiles.length} files`)

  const warnings = []
  const runner = new FactsExtractorRunner({
    identity,
    queue,
    cwd,
    loadConfig: () => ({
      config: { categories: { quick: { model: "omo-mock/mock-1" } } },
      diagnostics: [],
      layers: [],
      sources: [],
    }),
    resolveModelRegistry: () => ({
      getAvailable: () => [{ provider: "omo-mock", id: "mock-1" }],
      find: (provider, modelId) => (provider === "omo-mock" && modelId === "mock-1"
        ? { provider: "omo-mock", id: "mock-1" }
        : undefined),
    }),
    logger: {
      info: () => undefined,
      warn: (message, fields) => warnings.push({ message, fields }),
      error: (message, fields) => warnings.push({ message, fields }),
    },
    env: { ...process.env, OMO_MEMORY_HOME: memoryHome, SENPI_CODING_AGENT_DIR: agentDir },
    deadlineMs: 120_000,
    terminationGraceMs: 2_000,
    // REAL `senpi -p` child; the mock provider is injected as an explicit extension.
    senpiCommand: senpiBin,
    senpiPrefixArgs: ["-e", mockProviderEntry],
  })

  // ONE launch call: the post-success drain must clear the whole backlog by itself.
  const launched = await runner.launchPending()
  record("A first launch committed", launched.status === "committed", JSON.stringify(launched))

  const runsDir = join(identity.paths.facts, "runs")
  const runNames = existsSync(runsDir) ? readdirSync(runsDir).filter((name) => name.startsWith("facts-")) : []
  record("A drain produced multiple capped runs from one launch", runNames.length >= 2, `runs=${runNames.length}`)

  const repo = join(identity.paths.repo)
  const subjects = gitLines(repo, "%s")
  const trailers = gitLines(repo, "%(trailers:key=Generated-By,valueonly)").map((line) => line.trim()).filter((line) => line.length > 0)
  const factsCommits = subjects.filter((subject) => subject.startsWith("feat(facts)") || subject.includes("facts"))
  record("B commits carry Generated-By: facts-extractor", trailers.length >= 2 && trailers.every((value) => value === "facts-extractor"), `${trailers.length} trailers: ${[...new Set(trailers)].join(",")}`)
  record("B facts commits landed in the memory repo", factsCommits.length >= 2, `${factsCommits.length}: ${factsCommits.slice(0, 3).join(" | ")}`)

  const consumed = JSON.parse(readFileSync(core.factsQueuePaths(identity.paths).consumedPath, "utf8"))
  const consumedKeys = Object.entries(consumed.consumed).map(([conversationId, value]) => `${conversationId}:${value.end_message_id}`)
  const failuresFile = JSON.parse(readFileSync(core.factsQueuePaths(identity.paths).failuresPath, "utf8"))
  const parked = failuresFile.entries.filter((entryRecord) => entryRecord.state === "parked")
  const parkedKeys = parked.map((entryRecord) => `${entryRecord.conversationId}:${entryRecord.end_message_id}`)
  const accounted = new Set([...consumedKeys, ...parkedKeys])
  record("C losslessness: every seeded entry is committed or parked", seeded.every((key) => accounted.has(key)), `seeded=${seeded.join(",")} consumed=${consumedKeys.join(",")} parked=${parkedKeys.join(",")}`)
  record("C backlog drained: only parked entries remain pending", (await queue.listPending()).every((entry) => parkedKeys.includes(`${entry.conversationId}:${entry.range.end_message_id}`)), `pending=${(await queue.listPending()).map((entry) => entry.conversationId).join(",")}`)

  const payloadsLeft = runNames.filter((name) => existsSync(join(runsDir, name, "facts-payload.json")))
  const terminal = runNames.filter((name) => existsSync(join(runsDir, name, "final.json")))
  record("D every run is terminal", terminal.length === runNames.length, `${terminal.length}/${runNames.length}`)
  record("D no payload survives a terminal run", payloadsLeft.length === 0, payloadsLeft.join(",") || "none")
  const skipped = warnings.filter((entry) => JSON.stringify(entry).includes("skipped_overflow"))
  record("D no skipped_overflow anywhere", skipped.length === 0, `${skipped.length}`)

  record("E oversize entry parked exactly once, not looped", parked.length === 1 && parked[0].lastReason === "payload_entry_oversize" && parked[0].streak === 1, JSON.stringify(parked))
  const oversizeFile = readdirSync(identity.paths.factsQueue).find((name) =>
    name.endsWith(".json") && name !== "consumed.json" && name !== "failures.json" && statSync(join(identity.paths.factsQueue, name)).size > CAP)
  record("E oversize queue file retained untruncated", oversizeFile !== undefined, oversizeFile ?? "missing")

  // A second launch must NOT relaunch the parked entry (no run-dir growth).
  const second = await runner.launchPending()
  const runNamesAfter = readdirSync(runsDir).filter((name) => name.startsWith("facts-"))
  record("E parked entry never relaunches", second.status === "empty" && runNamesAfter.length === runNames.length, `${second.status} runs=${runNamesAfter.length}`)

  // G mid-drain failure: enqueue good-A, fail-B, good-C. Selection is newest-first, so good-C
  // commits, the FAILCHILD batch then fails (real child exit 7), the drain STOPS there, and
  // good-A is never attempted - the backoff contract owns pacing from the failure on.
  const failIdentity = {
    id: `${IDENTITY}-failure`,
    safeSlug: `${IDENTITY}-failure`,
    paths: core.buildIdentityPaths(memoryHome, `${IDENTITY}-failure`),
  }
  const failQueue = new core.FactsQueue({ identityPaths: failIdentity.paths })
  // Sizing forces one batch per run: good-c (0.8cap) ships alone first, fail-b (0.5cap) cannot
  // join it and fails alone second, and good-a (0.8cap) would be the third run - which a
  // non-stopping drain would launch.
  await failQueue.enqueue({ identity: failIdentity.id, sessionId: "good-a", conversationId: "good-a", entries: [transcriptEntry("good-a-m1", bulk)] })
  await failQueue.enqueue({ identity: failIdentity.id, sessionId: "fail-b", conversationId: "fail-b", entries: [transcriptEntry("fail-b-m1", `FAILCHILD ${"f".repeat(Math.floor(CAP * 0.5))}`)] })
  await failQueue.enqueue({ identity: failIdentity.id, sessionId: "good-c", conversationId: "good-c", entries: [transcriptEntry("good-c-m1", bulk)] })
  const failRunner = new FactsExtractorRunner({
    identity: failIdentity,
    queue: failQueue,
    cwd,
    loadConfig: () => ({ config: { categories: { quick: { model: "omo-mock/mock-1" } } }, diagnostics: [], layers: [], sources: [] }),
    resolveModelRegistry: () => ({
      getAvailable: () => [{ provider: "omo-mock", id: "mock-1" }],
      find: (provider, modelId) => (provider === "omo-mock" && modelId === "mock-1" ? { provider: "omo-mock", id: "mock-1" } : undefined),
    }),
    logger: { info: () => undefined, warn: (message, fields) => warnings.push({ message, fields }), error: (message, fields) => warnings.push({ message, fields }) },
    env: { ...process.env, OMO_MEMORY_HOME: memoryHome, SENPI_CODING_AGENT_DIR: agentDir },
    deadlineMs: 120_000,
    terminationGraceMs: 2_000,
    senpiCommand: senpiBin,
    senpiPrefixArgs: ["-e", mockProviderEntry],
  })
  const failResult = await failRunner.launchPending()
  const failRunsDir = join(failIdentity.paths.facts, "runs")
  const failRunNames = existsSync(failRunsDir) ? readdirSync(failRunsDir).filter((name) => name.startsWith("facts-")) : []
  const failOutcomes = failRunNames.map((name) => JSON.parse(readFileSync(join(failRunsDir, name, "final.json"), "utf8")).outcome)
  record("G mid-drain failure: newest batch commits, failing batch fails", failResult.status === "committed" && failOutcomes.includes("failed"), `${failResult.status} outcomes=${failOutcomes.join(",")}`)
  record("G drain stopped at the failure: no third run launched", failRunNames.length === 2, `runs=${failRunNames.length}`)
  const failPending = (await failQueue.listPending()).map((entry) => entry.conversationId).toSorted()
  record("G older good entry never attempted", failPending.includes("good-a") && failPending.includes("fail-b") && !failPending.includes("good-c"), `pending=${failPending.join(",")}`)
  const failLedger = JSON.parse(readFileSync(core.factsQueuePaths(failIdentity.paths).failuresPath, "utf8"))
  const streakRecords = failLedger.entries.filter((entryRecord) => entryRecord.conversationId === "fail-b")
  const goodARecords = failLedger.entries.filter((entryRecord) => entryRecord.conversationId === "good-a")
  record("G failure recorded exactly one streak increment", streakRecords.length === 1 && streakRecords[0].streak === 1 && streakRecords[0].state === "backoff" && streakRecords[0].lastReason === "child_exit" && goodARecords.length === 0, `${JSON.stringify(streakRecords)} good-a=${goodARecords.length}`)

  console.log("\n--- memory repo log ---")
  console.log(gitLines(repo, "%h %s [Generated-By: %(trailers:key=Generated-By,valueonly)]").join("\n"))
  console.log(`--- runs (${runNames.length}) ---`)
  for (const name of runNames.toSorted()) {
    const ledger = JSON.parse(readFileSync(join(runsDir, name, "ledger.json"), "utf8"))
    const final = JSON.parse(readFileSync(join(runsDir, name, "final.json"), "utf8"))
    console.log(`${name} outcome=${final.outcome} queued=${ledger.queued.map((key) => `${key.conversationId}:${key.end_message_id}`).join(",")}`)
  }

  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  record("cleanup: temp dirs removed", cleanup.length === 0 && !existsSync(root), root)

  const credentialsIntact = (before, dir) => {
    const after = credentialSnapshot(dir)
    return [...before].every(([path, digest]) => after.get(path) === digest)
  }
  record("F real ~/.omo/agent credentials byte-identical", credentialsIntact(omoAgentCredentialsBefore, join(homedir(), ".omo", "agent")), CREDENTIALS.join(","))
  record("F real ~/.senpi/agent credentials byte-identical", credentialsIntact(senpiCredentialsBefore, join(homedir(), ".senpi", "agent")), CREDENTIALS.join(","))
  const realMemoryAfter = hashDir(join(homedir(), ".omo", "memory"), "agents")
  record("F real ~/.omo/memory root untouched (live per-session repos excluded)", realMemoryBefore === realMemoryAfter, `${realMemoryBefore.slice(0, 16)} vs ${realMemoryAfter.slice(0, 16)}`)
  const leakedIdentity = join(homedir(), ".omo", "memory", "agents", IDENTITY)
  record("F driver identity never leaked into the real home", !existsSync(leakedIdentity), leakedIdentity)
  const realAgentAfter = hashDir(join(homedir(), ".senpi", "agent"))
  record("F real ~/.senpi/agent untouched", realAgentBefore === realAgentAfter, `${realAgentBefore.slice(0, 16)} vs ${realAgentAfter.slice(0, 16)}`)

  console.log(JSON.stringify({ ok: failures.length === 0, total: results.length, failures }, null, 2))
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
  console.error(error)
  process.exit(1)
})
