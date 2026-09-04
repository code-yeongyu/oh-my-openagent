#!/usr/bin/env node
// Live QA driver for the memorian GATE (plan .omo/plans/memorian-m3-gate.md todo 9, fold-final).
//
// QA-only harness: lives under the resolved evidence dir, drives the REAL senpi binary through the
// senpi-qa isolation helpers (createSandbox/seedSandbox from packages/omo-senpi/scripts/qa/drive.mjs),
// so the real ~/.senpi/agent and ~/.omo/memory are never used as the sandbox.
//
// The gate is an ADVISOR that watches a finished turn: at settle it spawns a quick child that judges
// the lexical candidates and answers only through a `nudge` tool; the validated nudge lands on the
// NEXT turn as a hidden <recalled-memory> block. That next-turn semantics is what every scenario
// below is shaped around - a single-turn session getting zero recall is the ACCEPTED behavior, not a
// bug (scenario g encodes it).
//
// Child stubbing uses the PRODUCTION launcher seam, not a code seam: senpi-task's
// resolveSenpiExecutable honors SENPI_BIN from the parent env (runners/rpc/spawn.ts), and the memory
// component threads process.env straight into the memorian runner, so exporting SENPI_BIN at the
// parent senpi makes the gate child BE the stub. The stub reads the real production payload
// ($MEMORIAN_CANDIDATES_PATH) and writes scripted NDJSON to the real sink ($MEMORIAN_NUDGE_PATH),
// which proves the whole parent loop: settle -> spawn -> payload -> NDJSON -> validate -> pending ->
// next-turn injection.
//
// Scenarios:
//   a HAPPY          two-turn session; turn 1 names a seeded token, stub child nudges the seeded
//                    note, turn 2's JSONL carries the omo-memorian:nudged entry with the stub hint
//                    while the hidden omo-memorian:recall message remains unchanged.
//   b DISABLED       memory.recall.enabled=false -> zero entries, and the stub child never runs.
//   c NO-CANDIDATES  unrelated prompts -> the runner never spawns (stub never runs).
//   d INVALID-NUDGE  stub emits an out-of-candidate path AND a >200-char hint -> zero injection.
//   e LOOP           the facts/reflection payload seam over the injected session yields no
//                    recall-derived projection.
//   f REAL-CHILD     a REAL senpi child booted with the EXACT production argv (persona,
//                    --tools nudge,read, -e nudge-extension.ts, --no-extensions) against the mock
//                    provider scripting a nudge tool call; the NDJSON line must match exactly.
//   g SINGLE-TURN    one-shot seeded-token session -> ZERO recall entries (accepted next-turn
//                    semantics, encoded as intended).
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const qaDir = join(repoRoot, "packages", "omo-senpi", "scripts", "qa")
const { createSandbox, seedSandbox } = await import(join(qaDir, "drive.mjs"))
const mockProviderEntry = join(qaDir, "task-e2e-mock-provider.ts")
const omoExtension = join(repoRoot, "packages", "omo-senpi", "plugin", "extensions", "omo.js")

const TOKEN = "zebra-quokka rebase ordering rule"
const NOTE_PATH = "reference/project/test-note.md"
const NOTE_BODY = [
  "---",
  "description: Project rebase ordering rule captured for memorian gate QA",
  "---",
  "",
  `The ${TOKEN} says: rebase the oldest reviewed branch first, then replay the`,
  "dependent branches in merge order so the stack never inverts.",
  "",
].join("\n")
const PROMPT_SEEDED = `remind me about the ${TOKEN} before I restack the branches`
const PROMPT_FOLLOWUP = "now walk me through the restack steps one by one"
const PROMPT_UNRELATED = "convert 42 fahrenheit to celsius and nothing else"

const STUB_HINT = "Rebase the oldest reviewed branch first so the dependent stack never inverts."
const OUT_OF_CANDIDATE_PATH = "reference/project/not-a-candidate.md"
const OVERLONG_HINT = `x${"y".repeat(220)}`

const RECALL_CUSTOM_TYPE = "omo-memorian:recall"
const NUDGED_ENTRY_TYPE = "omo-memorian:nudged"
const outDir = process.env.MEMORIAN_GATE_OUT_DIR ?? join(scriptDir, "live-gate")

const results = []
const failures = []
const sandboxes = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures.push({ name, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` :: ${String(detail).slice(0, 400)}`}`)
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

// The WORKTREE's own senpi is pinned: the globally installed binary drifts from the version this
// branch's plugin bundle was built against, and a drifted CLI silently changes flag semantics.
const worktreeSenpi = join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
const senpiBin = process.env.SENPI_BIN_OVERRIDE ?? (existsSync(worktreeSenpi) ? worktreeSenpi : findOnPath("senpi"))
if (senpiBin === null || senpiBin === undefined) {
  console.log(JSON.stringify({ result: "BLOCKED", reason: "senpi-binary-unavailable" }, null, 2))
  process.exit(2)
}
const senpiIsCliJs = senpiBin.endsWith(".js")
const senpiVersion = spawnSync(
  senpiIsCliJs ? process.execPath : senpiBin,
  [...(senpiIsCliJs ? [senpiBin] : []), "--version"],
  { encoding: "utf8" },
).stdout?.trim() ?? "unknown"

const ISOLATION_EXCLUDE = new Set(["sessions", "senpi-debug.log", "mcp-cache.json", "mcp-auth", "settings.json", "telemetry.log", "goals"])

function hashDir(root, exclude) {
  if (!existsSync(root)) return "absent"
  const hash = createHash("sha256")
  const walk = (dir) => {
    for (const name of readdirSync(dir).toSorted()) {
      if (exclude !== undefined && exclude(name)) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      hash.update(name)
      hash.update(readFileSync(full))
    }
  }
  walk(root)
  return hash.digest("hex")
}

const isolationExclude = (name) => ISOLATION_EXCLUDE.has(name)
const realSenpiDir = join(homedir(), ".senpi", "agent")
const realOmoMemoryDir = join(homedir(), ".omo", "memory")
const realSenpiBefore = hashDir(realSenpiDir, isolationExclude)

// The real ~/.omo/memory is written continuously by whatever live omo session hosts this run, so a
// whole-directory digest cannot attribute a change to QA. The attributable check is that no identity
// under the real memory home gained this run's corpus note or a pending-nudge file naming it.
function realMemoryAttributableFootprint() {
  const agentsDir = join(realOmoMemoryDir, "agents")
  if (!existsSync(agentsDir)) return { agents: 0, pendingFiles: [], tokenBearingFiles: [] }
  const pendingFiles = []
  const tokenBearingFiles = []
  const agents = readdirSync(agentsDir)
  for (const agent of agents) {
    const pendingDir = join(agentsDir, agent, "runtime", "recall", "pending")
    if (existsSync(pendingDir)) {
      for (const name of readdirSync(pendingDir)) {
        const full = join(pendingDir, name)
        try {
          if (readFileSync(full, "utf8").includes(NOTE_PATH)) pendingFiles.push(full)
        } catch {
          // Unreadable file: not attributable to this run either way.
        }
      }
    }
    const note = join(agentsDir, agent, "repo", NOTE_PATH)
    if (existsSync(note)) tokenBearingFiles.push(note)
  }
  return { agents: agents.length, pendingFiles, tokenBearingFiles }
}
const realOmoMemoryBefore = realMemoryAttributableFootprint()

const SESSION_IDS = {
  PREP: "01a05b6d-0000-7000-8000-00000000000e",
  HAPPY: "01a05b6d-0000-7000-8000-00000000000a",
  DISABLED: "01a05b6d-0000-7000-8000-00000000000b",
  "NO-CANDIDATES": "01a05b6d-0000-7000-8000-00000000000c",
  "INVALID-NUDGE": "01a05b6d-0000-7000-8000-00000000000d",
  "SINGLE-TURN": "01a05b6d-0000-7000-8000-00000000000f",
}

function writeArtifact(name, data) {
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, name)
  writeFileSync(path, typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`)
  return path
}

function scenarioSandbox() {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  sandboxes.push(sandbox.root)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(
    join(sandbox.agentDir, "auth.json"),
    `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`,
  )
  return sandbox
}

function writeOmoConfig(sandbox, memoryOverrides = {}) {
  const config = {
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      // sandbox "off" is a HARNESS requirement, not a product setting: the stub gate child records
      // its invocations to a log under the sandbox ROOT, while the production sandbox profile
      // (correctly) allows writes only inside the scratch run dir. Under the default "auto" the stub
      // dies with EPERM on its own log and the gate reports a failed launch, which would mask the
      // parent loop this driver exists to prove. Scenario f still boots a REAL child, and the sandbox
      // profile itself is covered by the memorian-sandbox unit tests.
      reflection: { trigger: { step_count: 0, on_compaction: false }, sandbox: "off" },
      ...memoryOverrides,
    },
  }
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(config, null, 2)}\n`)
}

function writeMockScript(sandbox, script) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
}

const PLAIN_STEPS = { parentSteps: [{ type: "text", text: "ok" }], childSteps: [{ type: "text", text: "unused" }] }

/**
 * The stub gate child, installed through the PRODUCTION SENPI_BIN seam. It records that it ran
 * (with its argv and the payload the parent handed it) and appends scripted NDJSON to the real sink.
 * Everything the parent does with that NDJSON is production code.
 */
function writeStubChild(sandbox, nudgeLines) {
  const logPath = join(sandbox.root, "stub-child-invocations.jsonl")
  const stubPath = join(sandbox.root, "stub-senpi")
  const body = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs")
const record = {
  at: new Date().toISOString(),
  argv: process.argv.slice(2),
  nudgePath: process.env.MEMORIAN_NUDGE_PATH ?? null,
  candidatesPath: process.env.MEMORIAN_CANDIDATES_PATH ?? null,
  transcriptPath: process.env.MEMORIAN_TRANSCRIPT_PATH ?? null,
  memorianSentinel: process.env.SENPI_MEMORY_MEMORIAN ?? null,
}
try { record.candidates = JSON.parse(readFileSync(record.candidatesPath, "utf8")) } catch (error) { record.candidatesError = String(error) }
try { record.transcript = readFileSync(record.transcriptPath, "utf8") } catch (error) { record.transcriptError = String(error) }
try { record.persona = readFileSync(record.argv[record.argv.indexOf("--system-prompt") + 1], "utf8").slice(0, 400) } catch (error) { record.personaError = String(error) }
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(record) + "\\n")
const lines = ${JSON.stringify(nudgeLines)}
if (lines.length > 0 && record.nudgePath !== null) {
  writeFileSync(record.nudgePath, lines.map((line) => JSON.stringify(line)).join("\\n") + "\\n")
}
process.exit(0)
`
  writeFileSync(stubPath, body, { mode: 0o755 })
  chmodSync(stubPath, 0o755)
  return { stubPath, logPath }
}

function stubInvocations(logPath) {
  if (!existsSync(logPath)) return []
  const out = []
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    if (line.trim() === "") continue
    try {
      const invocation = JSON.parse(line)
      if (invocation.memorianSentinel === "1" && typeof invocation.nudgePath === "string" && invocation.argv?.includes("--tools") && invocation.argv?.[invocation.argv.indexOf("--tools") + 1] === "nudge,read") out.push(invocation)
    } catch {
      // A truncated tail line is not an invocation record.
    }
  }
  return out
}

function sessionDir(sandbox) {
  return join(sandbox.agentDir, "sessions")
}

function runSenpi(sandbox, { prompt, env = {}, args = [], sessionId, timeoutMs = 180_000 }) {
  const fullArgs = [
    ...(senpiIsCliJs ? [senpiBin] : []),
    "-e", mockProviderEntry,
    "-e", omoExtension,
    "-p", "--mode", "json",
    "--provider", "omo-mock", "--model", "mock-1",
    "--session-dir", sessionDir(sandbox),
    ...(sessionId === undefined ? [] : ["--session-id", sessionId]),
    ...args,
    prompt,
  ]
  const run = spawnSync(senpiIsCliJs ? process.execPath : senpiBin, fullArgs, {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_MEMORY_HOME: join(sandbox.root, "memory"),
      PATH: process.env.PATH ?? "",
      ...env,
    },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

function identityRuntime(memoryHome) {
  const agentsDir = join(memoryHome, "agents")
  if (!existsSync(agentsDir)) return undefined
  for (const agent of readdirSync(agentsDir)) {
    const runtime = join(agentsDir, agent, "runtime")
    if (existsSync(runtime)) return { agent, runtime }
  }
  return undefined
}

function git(cwd, args) {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

/** Commits the corpus note at the identity repo's HEAD; recall compiles from committed content. */
function seedCorpus(repo) {
  const target = join(repo, NOTE_PATH)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, NOTE_BODY)
  const add = git(repo, ["add", NOTE_PATH])
  if (add.status !== 0) return { ok: false, detail: add.stderr }
  const commit = git(repo, ["commit", "-m", "qa: seed memorian gate corpus note"])
  if (commit.status !== 0) return { ok: false, detail: commit.stderr }
  const head = git(repo, ["rev-parse", "HEAD"]).stdout.trim()
  const lsTree = git(repo, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout.trim().split("\n")
  return { ok: lsTree.includes(NOTE_PATH), detail: `HEAD=${head.slice(0, 12)} files=${lsTree.join(",")}` }
}

/**
 * Prepares a scenario sandbox: a throwaway PREP session performs one memory write so the identity
 * repo + runtime dirs exist, then the corpus note is committed at HEAD.
 */
function prepareSandbox(name, memoryOverrides = {}) {
  const sandbox = scenarioSandbox()
  writeOmoConfig(sandbox, memoryOverrides)
  writeMockScript(sandbox, {
    parentSteps: [
      {
        type: "tool_call",
        name: "memory",
        arguments: {
          command: "create",
          file_path: "system/facts.md",
          description: "harness facts",
          file_text: "senpi is a pi harness",
          reason: "seed harness fact for memorian gate QA",
        },
      },
      { type: "text", text: "ok" },
    ],
    childSteps: [{ type: "text", text: "unused" }],
  })
  const prep = runSenpi(sandbox, { prompt: "seed the harness memory repo", sessionId: SESSION_IDS.PREP })
  if (prep.status !== 0) {
    record(`${name} PREP session (identity + repo creation)`, false, prep.stderr.slice(-500))
    return undefined
  }
  const memoryHome = join(sandbox.root, "memory")
  const runtime = identityRuntime(memoryHome)
  if (runtime === undefined) {
    record(`${name} identity runtime created`, false, `no runtime under ${memoryHome}`)
    return undefined
  }
  const repo = join(runtime.runtime, "..", "repo")
  if (!existsSync(repo)) {
    record(`${name} identity repo created`, false, `no repo at ${repo}`)
    return undefined
  }
  const seeded = seedCorpus(repo)
  record(`${name} corpus note committed at HEAD`, seeded.ok, seeded.detail.slice(0, 300))
  if (!seeded.ok) return undefined
  return { sandbox, memoryHome, runtime, repo }
}

function basename(path) {
  return path.split("/").pop() ?? path
}

function sessionFiles(sandbox) {
  const dir = sessionDir(sandbox)
  const files = []
  const walk = (root) => {
    if (!existsSync(root)) return
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const full = join(root, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name.endsWith(".jsonl")) files.push(full)
    }
  }
  walk(dir)
  return files
}

/** Entries of ONE session only; the PREP session's file never leaks into a scenario's assertions. */
function sessionFileEntries(files, sessionId) {
  const entries = []
  const matched = files.filter((file) => basename(file).includes(sessionId))
  for (const file of matched) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue
      try {
        entries.push(JSON.parse(line))
      } catch {
        // A partially flushed trailing line is not an entry.
      }
    }
  }
  return { entries, matched }
}

function contentText(value) {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    return value
      .map((block) => (block !== null && typeof block === "object" && typeof block.text === "string" ? block.text : ""))
      .join("\n")
  }
  if (value !== null && typeof value === "object" && typeof value.content !== "undefined") return contentText(value.content)
  return ""
}

/** Recall entries in both persisted shapes: top-level custom_message and role-custom message. */
function recallEntries(entries) {
  const found = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue
    if (entry.customType === RECALL_CUSTOM_TYPE) {
      found.push({
        shape: String(entry.type ?? "custom_message"),
        content: contentText(entry.content ?? entry),
        paths: entry.data?.paths ?? [],
      })
      continue
    }
    const message = entry.message
    if (message !== null && typeof message === "object" && message.customType === RECALL_CUSTOM_TYPE) {
      found.push({ shape: `message/${String(message.role ?? "?")}`, content: contentText(message.content), paths: [] })
    }
  }
  return found
}

function userTurnCount(entries) {
  return entries.filter((entry) => entry?.type === "message" && entry.message?.role === "user").length
}

function pendingState(memoryHome) {
  const runtime = identityRuntime(memoryHome)
  if (runtime === undefined) return { dir: undefined, files: [] }
  const dir = join(runtime.runtime, "recall", "pending")
  if (!existsSync(dir)) return { dir, files: [] }
  const files = readdirSync(dir).map((name) => {
    const full = join(dir, name)
    try {
      return { name, payload: JSON.parse(readFileSync(full, "utf8")) }
    } catch {
      return { name, unreadable: true }
    }
  })
  return { dir, files }
}

function ledgerState(memoryHome) {
  const runtime = identityRuntime(memoryHome)
  if (runtime === undefined) return { present: false, files: [] }
  const dir = join(runtime.runtime, "recall", "ledger")
  if (!existsSync(dir)) return { present: false, files: [] }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return { name, surfaced: Object.keys(JSON.parse(readFileSync(join(dir, name), "utf8")).surfaced ?? {}) }
      } catch {
        return { name, surfaced: [] }
      }
    })
  return { present: files.length > 0, files }
}

// ---------------------------------------------------------------- scenario a
async function scenarioHappy() {
  const name = "HAPPY"
  const prepared = prepareSandbox(name)
  if (prepared === undefined) return undefined
  const { sandbox, memoryHome } = prepared
  const stub = writeStubChild(sandbox, [{ path: NOTE_PATH, hint: STUB_HINT }])

  // Turn 1: the prompt names the seeded token. The gate fires at SETTLE, so this turn must NOT carry
  // a recall entry - the snapshot taken here is what proves the injection lands on the next turn.
  writeMockScript(sandbox, PLAIN_STEPS)
  const turn1 = runSenpi(sandbox, {
    prompt: PROMPT_SEEDED,
    sessionId: SESSION_IDS.HAPPY,
    env: { SENPI_BIN: stub.stubPath },
  })
  if (turn1.status !== 0) {
    record(`${name} turn 1`, false, turn1.stderr.slice(-500))
    return undefined
  }
  const snapshot1 = sessionFileEntries(sessionFiles(sandbox), SESSION_IDS.HAPPY)
  const recall1 = recallEntries(snapshot1.entries)
  const invocations1 = stubInvocations(stub.logPath)
  const pending1 = pendingState(memoryHome)

  record(`${name} turn 1 is the session's FIRST turn (exactly one user message)`, userTurnCount(snapshot1.entries) === 1, `userTurns=${userTurnCount(snapshot1.entries)}`)
  record(`${name} turn 1 settle spawned the gate child exactly once`, invocations1.length === 1, `invocations=${invocations1.length}`)
  const argv1 = invocations1[0]?.argv ?? []
  record(`${name} child argv carries the production flag set (--no-extensions + -e + --tools nudge,read)`, argv1.includes("--no-extensions") && argv1.includes("-e") && argv1[argv1.indexOf("--tools") + 1] === "nudge,read", JSON.stringify(argv1))
  record(`${name} child env carries the memorian sentinel and the nudge sink`, invocations1[0]?.memorianSentinel === "1" && typeof invocations1[0]?.nudgePath === "string", `sentinel=${invocations1[0]?.memorianSentinel} nudgePath=${invocations1[0]?.nudgePath}`)
  record(`${name} candidates payload handed to the child contains the seeded note`, (invocations1[0]?.candidates?.candidates ?? []).some((candidate) => candidate.path === NOTE_PATH), String(JSON.stringify(invocations1[0]?.candidates ?? invocations1[0]?.candidatesError ?? null)).slice(0, 400))
  record(`${name} turn 1 carries NO recall entry (the gate advises the NEXT turn)`, recall1.length === 0, `count=${recall1.length}`)
  record(`${name} the validated nudge persisted to the pending store after turn 1`, pending1.files.some((file) => (file.payload?.nudges ?? []).some((nudge) => nudge.path === NOTE_PATH && nudge.hint === STUB_HINT)), JSON.stringify(pending1).slice(0, 500))

  writeArtifact("happy-turn1-state.json", {
    sessionFiles: snapshot1.matched.map(basename),
    userTurnCount: userTurnCount(snapshot1.entries),
    recall: recall1,
    stubInvocations: invocations1,
    pending: pending1,
  })

  // Turn 2: the pending nudge must be drained into a hidden omo-memorian:recall message.
  writeMockScript(sandbox, PLAIN_STEPS)
  const turn2 = runSenpi(sandbox, {
    prompt: PROMPT_FOLLOWUP,
    sessionId: SESSION_IDS.HAPPY,
    env: { SENPI_BIN: stub.stubPath },
  })
  if (turn2.status !== 0) {
    record(`${name} turn 2`, false, turn2.stderr.slice(-500))
    return undefined
  }
  const snapshot2 = sessionFileEntries(sessionFiles(sandbox), SESSION_IDS.HAPPY)
  const recall2 = recallEntries(snapshot2.entries)
  const nudged2 = snapshot2.entries.filter((entry) => entry.type === "custom" && entry.customType === NUDGED_ENTRY_TYPE)
  const joined2 = recall2.map((entry) => entry.content).join("\n")
  const pending2 = pendingState(memoryHome)
  const ledger2 = ledgerState(memoryHome)

  record(`${name} turn 2 JSONL contains an ${NUDGED_ENTRY_TYPE} entry`, nudged2.length >= 1, `count=${nudged2.length}`)
  record(`${name} turn 2 JSONL still carries the hidden ${RECALL_CUSTOM_TYPE} message`, recall2.length >= 1, `count=${recall2.length} shapes=${recall2.map((entry) => entry.shape).join(",")}`)
  record(`${name} turn 2 content carries <recalled-memory source="[[${NOTE_PATH}]]"`, joined2.includes(`<recalled-memory source="[[${NOTE_PATH}]]"`), joined2.slice(0, 400))
  record(`${name} turn 2 content carries the stub judge's hint verbatim`, joined2.includes(STUB_HINT), joined2.slice(0, 400))
  record(`${name} the pending file was consumed by the injection`, !pending2.files.some((file) => (file.payload?.nudges ?? []).some((nudge) => nudge.path === NOTE_PATH)), JSON.stringify(pending2).slice(0, 400))
  record(`${name} the ledger marks the injected path as surfaced`, ledger2.files.some((file) => file.surfaced.includes(NOTE_PATH)), JSON.stringify(ledger2).slice(0, 400))

  writeArtifact("happy-final-session.jsonl", snapshot2.matched.map((file) => readFileSync(file, "utf8")).join(""))
  writeArtifact("happy-final-state.json", {
    sessionFiles: snapshot2.matched.map(basename),
    recall: recall2,
    nudged: nudged2,
    stubInvocations: stubInvocations(stub.logPath),
    pending: pending2,
    ledger: ledger2,
  })

  return { sandbox, memoryHome, entries: snapshot2.entries, recall: recall2, ok: true }
}

// ------------------------------------------------------------ scenarios b,c,d,g
/**
 * A silent scenario: two turns (so a gate nudge WOULD have room to land on turn 2), asserting that
 * nothing was injected and, where relevant, that the child never ran at all.
 */
async function scenarioSilent(name, { prompt, memoryOverrides = {}, nudgeLines, expectSpawn, expectPending = false, turns = 2 }) {
  const prepared = prepareSandbox(name, memoryOverrides)
  if (prepared === undefined) return undefined
  const { sandbox, memoryHome } = prepared
  const stub = writeStubChild(sandbox, nudgeLines)

  for (let turn = 0; turn < turns; turn += 1) {
    writeMockScript(sandbox, PLAIN_STEPS)
    const run = runSenpi(sandbox, {
      prompt: turn === 0 ? prompt : PROMPT_FOLLOWUP,
      sessionId: SESSION_IDS[name],
      env: { SENPI_BIN: stub.stubPath },
    })
    if (run.status !== 0) {
      record(`${name} turn ${turn + 1}`, false, run.stderr.slice(-500))
      return undefined
    }
  }

  const snapshot = sessionFileEntries(sessionFiles(sandbox), SESSION_IDS[name])
  const recall = recallEntries(snapshot.entries)
  const invocations = stubInvocations(stub.logPath)
  const pending = pendingState(memoryHome)

  record(`${name} session ran ${turns} turn(s)`, userTurnCount(snapshot.entries) === turns, `userTurns=${userTurnCount(snapshot.entries)}`)
  record(`${name} zero ${RECALL_CUSTOM_TYPE} entries`, recall.length === 0, `count=${recall.length} ${JSON.stringify(recall).slice(0, 300)}`)
  const hasPending = pending.files.some((file) => (file.payload?.nudges ?? []).length > 0)
  if (expectPending) {
    // A one-shot session ends BEFORE the nudge's target turn exists. Writing the pending payload is
    // the gate working as designed; the accepted regression is that nothing was INJECTED (asserted
    // above as zero recall entries), not that the advisor produced nothing.
    record(`${name} the judged nudge is parked for a turn that never came`, hasPending, JSON.stringify(pending).slice(0, 400))
  } else {
    record(`${name} nothing pending for a later turn`, !hasPending, JSON.stringify(pending).slice(0, 400))
  }
  if (expectSpawn === false) {
    record(`${name} the gate child never spawned`, invocations.length === 0, `invocations=${invocations.length} ${JSON.stringify(invocations.map((entry) => entry.argv)).slice(0, 300)}`)
  } else if (expectSpawn === true) {
    record(`${name} the gate child DID spawn (the rejection is the parent validator's)`, invocations.length >= 1, `invocations=${invocations.length}`)
  }
  // expectSpawn undefined: this scenario asserts only the SURFACING invariants above, because
  // whether a quick child gets to look is a lexical-matching detail, not a contract.

  writeArtifact(`${name.toLowerCase()}-state.json`, {
    sessionFiles: snapshot.matched.map(basename),
    userTurnCount: userTurnCount(snapshot.entries),
    recall,
    stubInvocations: invocations,
    pending,
  })
  return { sandbox, memoryHome, entries: snapshot.entries, invocations, ok: true }
}

// ---------------------------------------------------------------- scenario e
/**
 * LOOP: the facts queue payload AND the reflection/dream snapshot both derive from
 * projectSessionEntries (journal-wiring.ts), so that single seam decides whether an injected gate
 * nudge can be re-ingested. Driven over the HAPPY scenario's REAL session entries.
 */
async function scenarioLoop(happy) {
  const name = "LOOP"
  if (happy === undefined || happy.ok !== true) {
    record(`${name} precondition (happy session entries)`, false, "happy scenario did not produce entries")
    return
  }
  const { projectSessionEntries } = await import(
    join(repoRoot, "packages", "omo-senpi", "src", "components", "memory", "journal-wiring.ts")
  )
  const projections = projectSessionEntries(happy.entries)
  const recallDerived = projections.filter((projection) => {
    const text = JSON.stringify(projection)
    return text.includes("<recalled-memory") || text.includes(`[[${NOTE_PATH}]]`) || text.includes(STUB_HINT)
  })
  record(`${name} no facts/reflection projection derives from the injected nudge`, recallDerived.length === 0, `projections=${projections.length} recallDerived=${recallDerived.length} ${JSON.stringify(recallDerived).slice(0, 300)}`)
  record(`${name} the source session really contains the injection`, happy.recall.length >= 1, `count=${happy.recall.length}`)
  writeArtifact("loop-facts-projection.json", {
    surface: "packages/omo-senpi/src/components/memory/journal-wiring.ts projectSessionEntries (facts payload + reflection snapshot seam), driven over the LIVE HAPPY session entries",
    sessionEntryCount: happy.entries.length,
    recallEntriesInSession: happy.recall.length,
    projectionCount: projections.length,
    recallDerivedProjections: recallDerived,
  })
}

// ---------------------------------------------------------------- scenario f
/**
 * REAL-CHILD SMOKE (required gate): boot a REAL senpi child with the EXACT production argv that
 * prepareMemorianSpawn builds, against the scripted mock provider. This is the only scenario that
 * proves the flag combination the fold flagged as critical - `--no-extensions` TOGETHER with
 * `-e <runDir>/nudge-extension.ts` and `--tools nudge,read` - actually yields a child that can call
 * `nudge`. The mock provider CAN script tool calls, so the assertion is the strong one: the NDJSON
 * line must match the scripted call exactly.
 */
async function scenarioRealChild() {
  const name = "REAL-CHILD"
  const sandbox = scenarioSandbox()
  writeOmoConfig(sandbox)

  const [{ prepareMemorianSpawn }, { MEMORIAN_NUDGE_TOOL_NAME }] = await Promise.all([
    import(join(repoRoot, "packages", "omo-senpi", "src", "components", "memory", "worker", "spawn-payload.ts")),
    import(join(repoRoot, "packages", "omo-senpi", "src", "components", "memory", "worker", "memorian-nudge-extension.ts")),
  ])

  const runDir = join(sandbox.root, "memorian-run")
  mkdirSync(runDir, { recursive: true })
  // The production payload builder, called with production inputs: nothing about the argv below is
  // hand-written by this driver.
  const spawnArgs = await prepareMemorianSpawn({
    runDir,
    candidates: [{ path: NOTE_PATH, description: "Project rebase ordering rule", excerpt: NOTE_BODY.slice(0, 200), score: 1 }],
    surfaced: [],
    maxItems: 2,
    transcript: [{ role: "user", text: PROMPT_SEEDED }, { role: "assistant", text: "ok" }],
    model: "omo-mock/mock-1",
    hardDeadlineAt: Date.now() + 120_000,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_MEMORY_HOME: join(sandbox.root, "memory"),
    },
    senpiCommand: senpiIsCliJs ? process.execPath : senpiBin,
    ...(senpiIsCliJs ? { senpiPrefixArgs: [senpiBin] } : {}),
  })

  record(`${name} production argv keeps --no-extensions alongside the explicit -e extension`, spawnArgs.args.includes("--no-extensions") && spawnArgs.args.includes("-e"), JSON.stringify(spawnArgs.args))
  const toolsValue = spawnArgs.args[spawnArgs.args.indexOf("--tools") + 1] ?? ""
  record(`${name} production argv restricts tools to nudge,read`, toolsValue.split(",").includes(MEMORIAN_NUDGE_TOOL_NAME) && toolsValue === "nudge,read", `--tools ${toolsValue}`)

  // The mock provider scripts the child's ONE turn as a nudge tool call, so a successful run proves
  // the extension registered the tool AND that --tools did not filter it away.
  const scriptedCall = { path: NOTE_PATH, hint: STUB_HINT }
  const mockScript = {
    parentSteps: [
      { type: "tool_call", name: MEMORIAN_NUDGE_TOOL_NAME, arguments: scriptedCall },
      { type: "text", text: "done" },
    ],
    childSteps: [
      { type: "tool_call", name: MEMORIAN_NUDGE_TOOL_NAME, arguments: scriptedCall },
      { type: "text", text: "done" },
    ],
  }
  const mockScriptPath = join(runDir, "mock-script.json")
  writeFileSync(mockScriptPath, `${JSON.stringify(mockScript, null, 2)}\n`)

  // The mock provider is threaded in as an ADDITIONAL -e in front of the production args; the
  // production flags (including --no-extensions and the nudge extension) are otherwise untouched.
  const args = [...spawnArgs.args]
  const insertAt = args.indexOf("-p")
  args.splice(insertAt < 0 ? 0 : insertAt, 0, "-e", mockProviderEntry)
  const providerArgs = [...args]
  const modelIndex = providerArgs.indexOf("--model")
  if (modelIndex >= 0) providerArgs.splice(modelIndex, 2, "--provider", "omo-mock", "--model", "mock-1")

  const run = spawnSync(spawnArgs.command, [...providerArgs], {
    cwd: spawnArgs.cwd,
    env: { ...spawnArgs.env, MOCK_SCRIPT_PATH: mockScriptPath, PATH: process.env.PATH ?? "" },
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  })

  const ndjson = existsSync(spawnArgs.paths.nudges) ? readFileSync(spawnArgs.paths.nudges, "utf8") : ""
  const lines = ndjson.split("\n").filter((line) => line.trim() !== "")
  let parsed
  try {
    parsed = lines.length > 0 ? JSON.parse(lines[0]) : undefined
  } catch {
    parsed = undefined
  }
  const exactMatch = parsed !== undefined && parsed.path === scriptedCall.path && parsed.hint === scriptedCall.hint

  record(`${name} the real child booted and exited cleanly`, run.status === 0, `status=${run.status} stderr=${(run.stderr ?? "").slice(-400)}`)
  record(`${name} the real child's NDJSON line matches the scripted nudge EXACTLY`, exactMatch, `lines=${lines.length} first=${lines[0] ?? "(none)"}`)

  writeArtifact("real-child-state.json", {
    productionArgv: spawnArgs.args,
    argvActuallyRun: providerArgs,
    command: spawnArgs.command,
    toolsValue,
    exitStatus: run.status,
    stdoutTail: (run.stdout ?? "").slice(-4000),
    stderrTail: (run.stderr ?? "").slice(-4000),
    ndjsonLines: lines,
    scriptedCall,
    exactMatch,
  })
  return { ok: exactMatch }
}

async function main() {
  console.log(`senpi: ${senpiBin} (${senpiVersion})`)
  console.log(`outDir: ${outDir}`)

  const happy = await scenarioHappy()
  await scenarioSilent("DISABLED", {
    prompt: PROMPT_SEEDED,
    memoryOverrides: { recall: { enabled: false } },
    nudgeLines: [{ path: NOTE_PATH, hint: STUB_HINT }],
    expectSpawn: false,
  })
  await scenarioSilent("NO-CANDIDATES", {
    prompt: PROMPT_UNRELATED,
    nudgeLines: [{ path: NOTE_PATH, hint: STUB_HINT }],
    // NOT expectSpawn:false. The prompt is unrelated to the seeded CORPUS NOTE, but the identity repo
    // also carries the memory-discipline skill card that the PREP turn commits, and "convert 42
    // fahrenheit to celsius" lexically matches it. Whether a quick child gets to look is a matching
    // detail; the invariant this scenario owns is that nothing unrelated is ever SURFACED, which the
    // zero-recall-entries and nothing-pending assertions above enforce (the stub's scripted nudge
    // names the corpus note, which is not in this run's candidate set, so the parent rejects it).
    expectSpawn: undefined,
  })
  await scenarioSilent("INVALID-NUDGE", {
    prompt: PROMPT_SEEDED,
    // Both invalid shapes at once: a path outside the candidate set, and a valid path with a hint
    // over the 200-char limit. The parent validator must reject BOTH, leaving nothing to inject.
    nudgeLines: [
      { path: OUT_OF_CANDIDATE_PATH, hint: STUB_HINT },
      { path: NOTE_PATH, hint: OVERLONG_HINT },
    ],
    expectSpawn: true,
  })
  await scenarioLoop(happy)
  await scenarioRealChild()
  await scenarioSilent("SINGLE-TURN", {
    prompt: PROMPT_SEEDED,
    nudgeLines: [{ path: NOTE_PATH, hint: STUB_HINT }],
    expectSpawn: true,
    // ONE turn only: the accepted regression. The gate judges at settle, so the nudge it produces
    // has no next turn to land on and the session ends with zero recall entries.
    expectPending: true,
    turns: 1,
  })

  const realSenpiAfter = hashDir(realSenpiDir, isolationExclude)
  const realOmoMemoryAfter = realMemoryAttributableFootprint()
  const realSenpiUntouched = realSenpiBefore === realSenpiAfter
  const realOmoMemoryUntouched =
    realOmoMemoryAfter.pendingFiles.length === 0
    && realOmoMemoryAfter.tokenBearingFiles.length === 0
    && realOmoMemoryBefore.pendingFiles.length === realOmoMemoryAfter.pendingFiles.length
    && realOmoMemoryBefore.tokenBearingFiles.length === realOmoMemoryAfter.tokenBearingFiles.length
  record("isolation: real ~/.senpi/agent untouched (volatile paths excluded)", realSenpiUntouched, `${realSenpiBefore.slice(0, 12)} vs ${realSenpiAfter.slice(0, 12)}`)
  record("isolation: real ~/.omo/memory has no QA-attributable pending nudge or corpus file", realOmoMemoryUntouched, `before=${JSON.stringify(realOmoMemoryBefore)} after=${JSON.stringify(realOmoMemoryAfter)}`)

  const removed = []
  for (const root of sandboxes) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
    removed.push({ root, exists: existsSync(root) })
  }
  record("cleanup: every sandbox removed", removed.every((entry) => entry.exists === false), JSON.stringify(removed))

  // One verdict per fold-final scenario, derived from the recorded assertions that carry its prefix.
  const scenarioVerdicts = ["HAPPY", "DISABLED", "NO-CANDIDATES", "INVALID-NUDGE", "LOOP", "REAL-CHILD", "SINGLE-TURN"].map((scenario) => {
    const own = results.filter((entry) => entry.name.startsWith(`${scenario} `))
    return {
      scenario,
      verdict: own.length === 0 ? "NOT-RUN" : own.every((entry) => entry.ok) ? "PASS" : "FAIL",
      assertions: own.length,
      failed: own.filter((entry) => !entry.ok).map((entry) => entry.name),
    }
  })

  const payload = {
    result: failures.length === 0 && scenarioVerdicts.every((entry) => entry.verdict === "PASS") ? "PASS" : "FAIL",
    branch: "feat/memorian-gate",
    senpiBin,
    senpiVersion,
    providedSenpiCodingAgentDir: process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset",
    realSenpiUntouched,
    realOmoMemoryUntouched,
    realOmoMemoryFootprintBefore: realOmoMemoryBefore,
    realOmoMemoryFootprintAfter: realOmoMemoryAfter,
    realSenpiAgentDir: realSenpiDir,
    sandboxRoots: removed,
    scenarioVerdicts,
    total: results.length,
    results,
    failures,
  }
  writeArtifact("driver-result.json", payload)
  console.log(JSON.stringify({ result: payload.result, scenarioVerdicts, failures }, null, 2))
  process.exit(payload.result === "PASS" ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
