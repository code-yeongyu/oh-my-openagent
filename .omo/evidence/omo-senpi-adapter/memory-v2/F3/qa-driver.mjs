#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const worktree = "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning"
const evidenceDir = join(worktree, ".omo/evidence/omo-senpi-adapter/memory-v2/F3")
const pluginRoot = join(worktree, "packages/omo-senpi/plugin")
const realSenpi = join(worktree, "node_modules/.bin/senpi")
const sourceProvider = join(worktree, "packages/omo-senpi/scripts/qa/task-e2e-mock-provider.ts")
const root = mkdtempSync(join(tmpdir(), "omo-memory-f3-"))
const project = join(root, "project")
const home = join(root, "home")
const agentDir = join(root, "senpi-agent")
const sessionDir = join(agentDir, "sessions")
const xdgConfigHome = join(root, "xdg")
const memoryHome = join(root, "memory")
const promptLog = join(root, "system-prompts.txt")
const providerPath = join(root, "f3-provider.ts")
const wrapperPath = join(root, "senpi-with-provider")
const scriptPath = join(project, "mock-script.json")
const sessionId = "omo-memory-f3-session"
const agentSetting = "f3-qa-agent"
let identity = `${agentSetting}-${createHash("sha256").update(agentSetting).digest("hex").slice(0, 8)}`
let identityRoot = join(memoryHome, "agents", identity)
let repoDir = join(identityRoot, "repo")
const transcript = []
const checks = []
const childPids = new Set()
const activeTuis = new Set()
let turn = 0
let tempRemoved = false

function line(text = "") {
  transcript.push(text)
  console.log(text)
}

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail })
  line(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function listFiles(path) {
  if (!existsSync(path)) return []
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) walk(child)
      else out.push(child)
    }
  }
  walk(path)
  return out.sort()
}

function git(args, cwd = repoDir) {
  return runProcess("git", args, { cwd, timeoutMs: 30_000 })
}

function runProcess(command, args, { cwd = project, env = {}, timeoutMs = 180_000 } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    childPids.add(child.pid)
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    let timedOut = false
    child.on("error", (error) => {
      clearTimeout(timer)
      childPids.delete(child.pid)
      resolveRun({ code: null, signal: null, stdout, stderr: `${stderr}${error.stack ?? error}\n`, timedOut: false })
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      childPids.delete(child.pid)
      resolveRun({ code, signal, stdout, stderr, timedOut })
    })
  })
}

function promptDelta(start) {
  return existsSync(promptLog) ? readFileSync(promptLog, "utf8").slice(start) : ""
}

async function waitForContent(path, expected, timeoutMs, label) {
  const matches = () => existsSync(path) && readFileSync(path, "utf8").includes(expected)
  if (matches()) return readFileSync(path, "utf8")
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) writeFileSync(path, "")
  return await new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const watcher = watch(path, () => {
      if (!matches()) return
      clearTimeout(timer)
      watcher.close()
      resolveWait(readFileSync(path, "utf8"))
    })
  })
}

function launchTuiCommand(label, commandText, expectedText) {
  const socket = `f3-${label.replaceAll(/[^a-zA-Z0-9]/g, "-")}`
  const session = socket
  const rawPath = join(root, `${socket}.terminal.raw.txt`)
  writeFileSync(rawPath, "")
  const inlineEnv = Object.entries({ ...isolatedEnv(), TERM: "xterm-256color" })
    .map(([key, value]) => `${key}=${value}`)
  const args = [
    "-e", providerPath,
    "--provider", "omo-mock", "--model", "mock-1",
    "--session-dir", sessionDir,
    "--session-id", sessionId,
    "--offline", "--approve", "--no-context-files",
  ]
  const shellCommand = ["env", ...inlineEnv, realSenpi, ...args].map(shellQuote).join(" ")
  const launched = spawnSync("tmux", ["-L", socket, "new-session", "-d", "-s", session, "-x", "220", "-y", "60", shellCommand], {
    cwd: project,
    env: { ...process.env, ...isolatedEnv(), TERM: "xterm-256color" },
    encoding: "utf8",
  })
  if (launched.status !== 0) throw new Error(`tmux launch failed: ${launched.stderr}`)
  spawnSync("tmux", ["-L", socket, "pipe-pane", "-O", "-t", session, `cat >> ${shellQuote(rawPath)}`])
  const observed = waitForContent(rawPath, expectedText, 15_000, `${label} terminal output`)
  spawnSync("tmux", ["-L", socket, "send-keys", "-t", session, "-l", commandText])
  spawnSync("tmux", ["-L", socket, "send-keys", "-t", session, "Enter"])
  const cleanup = () => {
    spawnSync("tmux", ["-L", socket, "kill-session", "-t", session])
    spawnSync("tmux", ["-L", socket, "kill-server"])
    activeTuis.delete(cleanup)
  }
  activeTuis.add(cleanup)
  return { rawPath, observed, cleanup }
}

async function runTurn(label, message, parentSteps, { command = false } = {}) {
  turn += 1
  writeJson(scriptPath, { parentSteps, childSteps: [{ type: "text", text: "child complete" }], models: ["mock-1"] })
  const promptStart = existsSync(promptLog) ? statSync(promptLog).size : 0
  const args = [
    "-e", providerPath,
    "-p", "--mode", "json",
    "--provider", "omo-mock", "--model", "mock-1",
    "--session-dir", sessionDir,
    "--session-id", sessionId,
    message,
  ]
  const result = await runProcess(realSenpi, args, { env: isolatedEnv(), timeoutMs: 180_000 })
  const delta = promptDelta(promptStart)
  line(`\n===== TURN ${turn}: ${label} =====`)
  line(`COMMAND=${realSenpi} ${args.map(shellQuote).join(" ")}`)
  line(`EXIT=${result.code} SIGNAL=${result.signal ?? "none"} TIMED_OUT=${result.timedOut}`)
  line("--- STDOUT ---")
  line(result.stdout)
  line("--- STDERR ---")
  line(result.stderr)
  line("--- INJECTED SYSTEM PROMPT DELTA ---")
  line(delta)
  check(`${label}: senpi process exited cleanly`, result.code === 0 && !result.timedOut, `exit=${result.code}`)
  if (command) check(`${label}: slash command bypassed the model`, delta.length === 0, `promptBytes=${Buffer.byteLength(delta)}`)
  return { ...result, prompt: delta }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

function isolatedEnv() {
  return {
    HOME: home,
    XDG_CONFIG_HOME: xdgConfigHome,
    SENPI_CODING_AGENT_DIR: agentDir,
    OMO_MEMORY_HOME: memoryHome,
    OMO_SENPI_QA: "1",
    OMO_SENPI_DISABLE_POSTHOG: "1",
    SENPI_BIN: wrapperPath,
    MOCK_SCRIPT_PATH: scriptPath,
    MOCK_DUMP_SYSTEM: promptLog,
    PI_OFFLINE: "1",
  }
}

async function waitForFile(rootDir, predicate, timeoutMs, label) {
  const scan = () => listFiles(rootDir).find(predicate)
  const existing = scan()
  if (existing) return existing
  mkdirSync(rootDir, { recursive: true })
  return await new Promise((resolveWait, reject) => {
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const watcher = watch(rootDir, { recursive: true }, () => {
      const found = scan()
      if (!found) return
      clearTimeout(timer)
      watcher.close()
      resolveWait(found)
    })
  })
}

async function setup() {
  for (const path of [evidenceDir, project, home, agentDir, sessionDir, xdgConfigHome]) mkdirSync(path, { recursive: true })
  writeJson(join(agentDir, "settings.json"), { defaultProjectTrust: "allow", packages: [pluginRoot] })
  writeJson(join(agentDir, "trust.json"), { [resolve(project)]: true })
  writeJson(join(agentDir, "auth.json"), { "omo-mock": { type: "api_key", key: "mock" } })
  mkdirSync(join(project, ".omo"), { recursive: true })
  const omoConfig = {
    categories: { quick: { model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      agent: agentSetting,
      tool_exposure: "direct",
      reflection: {
        enabled: true,
        trigger: { step_count: 0, on_compaction: false },
        merge: "auto",
        category: "quick",
        timeout_minutes: 2,
      },
      nudge: { enabled: true, every_user_turns: 2 },
      facts: { enabled: true, debounce_settles: 4 },
      dream: {
        enabled: true,
        idle_minutes: 0,
        min_hours_between: 24,
        shutdown_launch: false,
        auto_select_max: 5,
        auto_select_max_chars: 150000,
      },
      people: { enabled: true, max_entries: 40, max_entry_chars: 200 },
      soul: { edit_notice: true },
      sync: { enabled: false },
      search: { enabled: true },
      compile_warn_tokens: 30000,
      agents: {},
    },
  }
  writeJson(join(project, ".omo", "omo.json"), omoConfig)
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeJson(join(home, ".omo", "omo.json"), omoConfig)

  let provider = readFileSync(sourceProvider, "utf8")
  provider = provider.replace(
    'const isChild = messagesContainChild(context) || process.argv.includes("rpc")',
    'const isChild = messagesContainChild(context) || process.argv.includes("rpc") || env.SENPI_MEMORY_FACTS === "1" || env.SENPI_MEMORY_REFLECTION === "1"',
  )
  provider = provider.replace(
    `  const steps = isChild ? script.childSteps : script.parentSteps\n  const index = isChild ? childCallCount : parentCallCount\n  const step = steps[Math.min(index, steps.length - 1)]\n  if (isChild) childCallCount += 1\n  else parentCallCount += 1`,
    `  const steps = isChild ? script.childSteps : script.parentSteps\n  const index = isChild ? childCallCount : parentCallCount\n  let step = steps[Math.min(index, steps.length - 1)]\n  if (env.SENPI_MEMORY_FACTS === "1") {\n    step = index === 0\n      ? { type: "tool_call", name: "write", arguments: { path: env.FACTS_EXTRACTION_PATH ?? "extraction.jsonl", content: JSON.stringify({ scope: "person", person: { name: "Mina Kim", aliases: ["Mina"] }, text: "Mina Kim is the release manager and prefers concise release checklists.", date: "2026-08-10" }) + "\\n" } }\n      : { type: "text", text: "facts extraction complete" }\n  } else if (env.SENPI_MEMORY_REFLECTION === "1") {\n    step = { type: "text", text: "Summary: reviewed the selected conversation; no consolidation changes were needed.\\n\\nConsolidation: none.\\nSkill audit: none.\\nPeople: none.\\nSkipped: no durable maintenance required.\\nCommit: no commit.\\nIssues: none." }\n  }\n  if (isChild) childCallCount += 1\n  else parentCallCount += 1`,
  )
  if (!provider.includes("env.SENPI_MEMORY_FACTS")) throw new Error("failed to patch QA provider child classification")
  writeFileSync(providerPath, provider)
  writeFileSync(wrapperPath, `#!/bin/sh\nexec ${shellQuote(realSenpi)} --extension ${shellQuote(providerPath)} "$@"\n`)
  chmodSync(wrapperPath, 0o700)

  line("# F3 live senpi QA transcript")
  line(`WORKTREE=${worktree}`)
  line(`ISOLATED_ROOT=${root}`)
  line(`HOME=${home}`)
  line(`XDG_CONFIG_HOME=${xdgConfigHome}`)
  line(`SENPI_CODING_AGENT_DIR=${agentDir}`)
  line(`SENPI_SESSION_DIR=${sessionDir}`)
  line(`OMO_MEMORY_HOME=${memoryHome}`)
  line(`IDENTITY=${identity}`)
}

async function scenario() {
  const ack = [{ type: "text", text: "ack" }]
  const initialSaveSteps = [
    {
      type: "tool_call",
      name: "memory",
      arguments: {
        command: "create",
        reason: "F3 initialize isolated memory",
        file_path: "notes/f3-initial.md",
        description: "F3 initial live QA memory sentinel",
        file_text: "Mina Kim is the release manager and prefers concise release checklists.",
      },
    },
    { type: "text", text: "initialized" },
  ]
  await runTurn(
    "fresh seed and accepted turn 1",
    "Remember this durable fact: Mina Kim is the release manager and prefers concise release checklists.",
    initialSaveSteps,
  )
  const agentNames = existsSync(join(memoryHome, "agents"))
    ? readdirSync(join(memoryHome, "agents"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : []
  if (agentNames.length === 1) {
    identity = agentNames[0]
    identityRoot = join(memoryHome, "agents", identity)
    repoDir = join(identityRoot, "repo")
  }
  line(`RESOLVED_LIVE_IDENTITY=${identity}`)
  check("fresh seed created the isolated identity repo", existsSync(join(repoDir, ".git")), repoDir)
  const seedLog = await git(["log", "--format=%H%x09%s", "--", "system/persona.md", "system/human.md"])
  const seedTree = await git(["ls-tree", "-r", "--name-only", "HEAD"])
  check(
    "fresh seed committed persona.md and human.md",
    seedLog.code === 0 && seedTree.stdout.includes("system/persona.md") && seedTree.stdout.includes("system/human.md"),
    seedLog.stdout.trim().replaceAll("\n", " | "),
  )

  const turn2 = await runTurn("accepted turn 2 without memory save", "Second accepted turn; do not save memory.", ack)
  check("nudge remains absent one turn after the initial save", !turn2.prompt.includes("user turns since your last memory save"))
  const turn3 = await runTurn("accepted turn 3 without memory save", "Third accepted turn; still do not save memory.", ack)
  check(
    "nudge appears at every_user_turns=2",
    turn3.prompt.includes("2 user turns since your last memory save"),
    "expected exact nudge count N=2",
  )

  const saveSteps = [
    {
      type: "tool_call",
      name: "memory",
      arguments: {
        command: "create",
        reason: "F3 nudge self-clear save",
        file_path: "notes/f3-save.md",
        description: "F3 live QA memory-tool save sentinel",
        file_text: "The F3 scripted QA exercised nudge self-clear.",
      },
    },
    { type: "text", text: "saved" },
  ]
  const factsFinalPromise = waitForFile(
    join(identityRoot, "runtime", "facts", "runs"),
    (path) => path.endsWith("/final.json"),
    5_000,
    "facts final.json",
  ).then((path) => ({ path })).catch((error) => ({ error }))
  const turn4 = await runTurn("accepted turn 4 with memory tool save", "Save the F3 QA sentinel to memory now.", saveSteps)
  check("memory tool save committed", turn4.stdout.includes("Memory create committed locally"))
  const turn5 = await runTurn("accepted turn 5 after memory save", "Next accepted turn after the save; answer briefly.", ack)
  check(
    "nudge self-clears on the turn after memory save",
    !turn5.prompt.includes("user turns since your last memory save"),
    "nudge token absent",
  )

  const factsObserved = await factsFinalPromise
  if (factsObserved.path !== undefined) {
    const factsFinal = json(factsObserved.path)
    check("facts run published final.json", true, `${factsObserved.path} ${JSON.stringify(factsFinal)}`)
    check("facts child committed extracted facts", factsFinal.outcome === "committed" && typeof factsFinal.sha === "string", JSON.stringify(factsFinal))
  } else {
    check("facts run published final.json", false, String(factsObserved.error))
    const queueFiles = listFiles(join(identityRoot, "runtime", "facts"))
    check("facts queue enqueue or launch attempt is durable", queueFiles.length > 0, queueFiles.join(", "))
  }

  const peopleCard = join(repoDir, "people", "mina-kim", "card.md")
  check("facts extraction produced Mina Kim person card", existsSync(peopleCard), peopleCard)

  const soulSteps = [
    {
      type: "tool_call",
      name: "memory",
      arguments: {
        command: "str_replace",
        reason: "F3 soul edit notice",
        file_path: "system/persona.md",
        old_string: "You are a coding agent that maintains its own memory.",
        new_string: "You are a coding agent that maintains its own memory. F3 verified this edit.",
      },
    },
    { type: "text", text: "persona updated" },
  ]
  const turn6 = await runTurn("soul edit through memory tool", "Edit your persona with the F3 sentinel.", soulSteps)
  check("soul edit tool result carries announcement discipline", turn6.stdout.includes("This was a soul edit: announce it to the user in your reply."))
  const turn7 = await runTurn("turn after soul edit", "Confirm the next-turn memory metadata.", ack)
  check("soul-edit notice is injected on the next turn", turn7.prompt.includes("Soul updated by reflection"), "Soul updated by token present")

  const dreamFinalPromise = waitForFile(
    join(identityRoot, "runtime", "reflection", "runs"),
    (path) => path.endsWith("/final.json"),
    5_000,
    "dream final.json",
  ).then((path) => ({ path })).catch((error) => ({ error }))
  const dreamTui = launchTuiCommand("dream", "/dream --recent 1", "ack")
  try {
    const dreamTerminal = await dreamTui.observed
    line("\n===== INTERACTIVE COMMAND: /dream --recent 1 =====")
    line(dreamTerminal)
    check("manual dream command reserved a run", /dream run/i.test(dreamTerminal), dreamTerminal.slice(-1000))
    const dreamObserved = await dreamFinalPromise
    if (dreamObserved.path === undefined) {
      check("dream fs.watch observed final.json", false, String(dreamObserved.error))
    } else {
      const dreamFinal = json(dreamObserved.path)
      check("dream fs.watch observed final.json", true, dreamObserved.path)
      check(
        "dream completed with an outcome sentinel",
        typeof dreamFinal.outcome === "string" && dreamFinal.outcome.length > 0,
        JSON.stringify(dreamFinal),
      )
    }
  } catch (error) {
    check("dream interactive command completed", false, String(error))
  } finally {
    dreamTui.cleanup()
  }

  const peopleTui = launchTuiCommand("people", "/people Mina", "ack")
  try {
    const peopleTerminal = await peopleTui.observed
    line("\n===== INTERACTIVE COMMAND: /people Mina =====")
    line(peopleTerminal)
    check(
      "/people renders the extracted Mina Kim card",
      peopleTerminal.includes("Mina Kim") && peopleTerminal.includes("release manager"),
      peopleTerminal.slice(-1500),
    )
  } catch (error) {
    check("/people renders the extracted Mina Kim card", false, String(error))
  } finally {
    peopleTui.cleanup()
  }

  const log = await git(["log", "--date=iso-strict", "--pretty=fuller", "--name-status", "--decorate", "-20"])
  writeFileSync(join(evidenceDir, "memory-git-log.txt"), log.stdout + log.stderr)
  line("\n===== ISOLATED MEMORY REPO GIT LOG =====")
  line(log.stdout)

  const sessions = listFiles(sessionDir).filter((path) => path.endsWith(".jsonl"))
  writeFileSync(join(evidenceDir, "session-files.txt"), `${sessions.join("\n")}\n`)
  let combined = ""
  for (const path of sessions) combined += `===== ${path} =====\n${readFileSync(path, "utf8")}\n`
  writeFileSync(join(evidenceDir, "session.jsonl.txt"), combined)
  if (existsSync(promptLog)) cpSync(promptLog, join(evidenceDir, "system-prompts.txt"))
  for (const finalPath of listFiles(identityRoot).filter((path) => /\/(final|ledger|outcome)\.json$/.test(path))) {
    line(`RUN_ARTIFACT ${finalPath.slice(identityRoot.length + 1)}=${readFileSync(finalPath, "utf8").trim()}`)
  }
}

async function teardown() {
  for (const cleanup of [...activeTuis]) cleanup()
  check("all isolated tmux command sessions exited", activeTuis.size === 0, `remaining=${activeTuis.size}`)
  for (const pid of [...childPids]) {
    try { process.kill(pid, "SIGTERM") } catch {}
  }
  check("all directly spawned child processes exited", childPids.size === 0, `remaining=${[...childPids].join(",")}`)
  rmSync(root, { recursive: true, force: true })
  tempRemoved = !existsSync(root)
  check("isolated HOME/SENPI/XDG/memory root removed", tempRemoved, root)
}

let fatal
try {
  await setup()
  await scenario()
} catch (error) {
  fatal = error
  line(`FATAL=${error?.stack ?? error}`)
} finally {
  await teardown()
  const failed = checks.filter((entry) => !entry.ok)
  const result = fatal || failed.length > 0 ? "FAIL" : "PASS"
  line(`F3_SCENARIO_RESULT=${result}`)
  line(`CHECKS_TOTAL=${checks.length} CHECKS_FAILED=${failed.length}`)
  for (const entry of failed) line(`FAILED_CHECK=${entry.name} :: ${entry.detail}`)
  line(`TEARDOWN_ROOT_REMOVED=${tempRemoved}`)
  writeFileSync(join(evidenceDir, "transcript.txt"), `${transcript.join("\n")}\n`)
  writeJson(join(evidenceDir, "results.json"), { result, fatal: fatal ? String(fatal) : null, checks })
  process.exitCode = result === "PASS" ? 0 : 1
}
