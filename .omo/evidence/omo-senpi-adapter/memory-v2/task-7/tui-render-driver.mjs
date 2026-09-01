#!/usr/bin/env node
// Task 7 interactive/TUI leg: print mode never invokes entry renderers, so this driver runs the
// REAL interactive senpi inside tmux (a PTY) with the mock provider and asserts the renderer PATH:
// exactly one omo-memory:soul-updated entry reaches the registered renderer for a soul commit
// (the rendered component carries the commit sha7 + affected path), and none renders for a
// non-soul commit. Assertions key on machine values (sha7, repo path, persisted entry), never on
// prose sentences. Isolation: fresh OMO_MEMORY_HOME + SENPI_CODING_AGENT_DIR per scenario.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createSandbox, seedSandbox } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning/packages/omo-senpi/scripts/qa/drive.mjs"

const mockProviderEntry =
  "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning/packages/omo-senpi/scripts/qa/task-e2e-mock-provider.ts"
const senpiBin = process.env.SENPI_BIN
if (senpiBin === undefined) throw new Error("SENPI_BIN is required")

const results = []
function record(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

function waitFor(predicate, { timeoutMs = 120_000, intervalMs = 400, description } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const start = Date.now()
    const poll = () => {
      let value
      try {
        value = predicate()
      } catch {
        value = undefined
      }
      if (value) {
        resolvePromise(value)
        return
      }
      if (Date.now() - start > timeoutMs) {
        rejectPromise(new Error(`timeout waiting for ${description}`))
        return
      }
      setTimeout(poll, intervalMs)
    }
    poll()
  })
}

function* sessionFiles(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name)
    if (name.isDirectory()) yield* sessionFiles(path)
    else if (name.name.endsWith(".jsonl")) yield path
  }
}

function readSessions(dir) {
  let text = ""
  for (const file of sessionFiles(dir)) text += readFileSync(file, "utf8")
  return text
}

function prepare(toolName, toolArgs) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
    memory: { enabled: true, reflection: { trigger: { step_count: 0, on_compaction: false } } },
  }, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({
    parentSteps: [
      { type: "tool_call", name: toolName, arguments: toolArgs },
      { type: "text", text: "done" },
    ],
    childSteps: [],
  }, null, 2)}\n`)
  return sandbox
}

// A private tmux socket guarantees a fresh server that inherits THIS process env; a session on
// the user's default server would run with that server's environment and silently leak the real
// home/agent dirs into the QA run. Env is also inlined into the session command as a second latch.
const TMUX_SOCKET = "task7-soul-qa"

function tmux(args, options = {}) {
  return spawnSync("tmux", ["-L", TMUX_SOCKET, ...args], { encoding: "utf8", ...options })
}

function launchTui(sandbox, sessionName) {
  const inlineEnv = [
    `SENPI_CODING_AGENT_DIR=${sandbox.agentDir}`,
    `XDG_CONFIG_HOME=${sandbox.xdgConfigHome}`,
    `OMO_MEMORY_HOME=${join(sandbox.root, "memory")}`,
    "OMO_SENPI_QA=1",
    "TERM=xterm-256color",
  ]
  const args = [
    "-e", mockProviderEntry,
    "--provider", "omo-mock", "--model", "mock-1",
    "--session-dir", join(sandbox.agentDir, "sessions"),
    "--offline", "--approve", "--no-context-files",
    "update your soul",
  ]
  const quoted = ["env", ...inlineEnv, senpiBin, ...args].map((part) => JSON.stringify(part)).join(" ")
  const env = {
    ...process.env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    OMO_MEMORY_HOME: join(sandbox.root, "memory"),
    TERM: "xterm-256color",
  }
  tmux(["new-session", "-d", "-s", sessionName, "-x", "220", "-y", "50", quoted], {
    cwd: sandbox.cwd,
    env,
    stdio: "ignore",
  })
}

function capturePane(sessionName) {
  const run = tmux(["capture-pane", "-p", "-J", "-t", sessionName])
  return run.status === 0 ? run.stdout : ""
}

function killSession(sessionName) {
  tmux(["kill-session", "-t", sessionName], { stdio: "ignore" })
  tmux(["kill-server"], { stdio: "ignore" })
}

async function scenarioSoul() {
  const name = "task7-soul"
  const sandbox = prepare("memory", {
    command: "str_replace",
    reason: "TUI soul rewrite",
    file_path: "system/persona.md",
    old_string: "It is your soul and they should know.",
    new_string: "It is your soul and they should know. TUI touched it.",
  })
  const sessionsDir = join(sandbox.agentDir, "sessions")
  try {
    launchTui(sandbox, name)
    const settled = await waitFor(
      () => readSessions(sessionsDir).includes("omo-memory:soul-updated"),
      { description: "persisted omo-memory:soul-updated entry" },
    ).then(() => true).catch(() => false)
    record("soul scenario: soul-updated entry persisted during the interactive session", settled)
    const repoDir = join(sandbox.root, "memory", "agents")
    const identityDir = existsSync(repoDir) ? readdirSync(repoDir)[0] : undefined
    const head = identityDir === undefined
      ? ""
      : spawnSync("git", ["rev-parse", "HEAD"], { cwd: join(repoDir, identityDir, "repo"), encoding: "utf8" }).stdout.trim()
    const pane = await waitFor(
      () => {
        const text = capturePane(name)
        return head !== "" && text.includes(head.slice(0, 7)) && text.includes("system/persona.md") ? text : undefined
      },
      { description: "renderer output carrying the commit sha7 and soul path" },
    ).catch(() => capturePane(name))
    if (process.env.QA_KEEP_SANDBOX === "1") console.log(`--- PANE ---\n${pane}\n--- END PANE ---`)
    const markerCount = pane.split(/memory soul updated [0-9a-f]{7}/).length - 1
    record(
      "soul scenario: renderer produced exactly one soul notice with the commit sha7",
      markerCount === 1 && pane.includes(`memory soul updated ${head.slice(0, 7)}`),
      `markerCount=${markerCount} sha7=${head.slice(0, 7)}`,
    )
    record(
      "soul scenario: tool result carries the unconditional discipline line",
      readSessions(sessionsDir).includes("soul edit"),
    )
  } finally {
    killSession(name)
    if (process.env.QA_KEEP_SANDBOX === "1") {
      console.log(`SOUL SANDBOX KEPT: ${sandbox.root}`)
    } else {
      rmSync(sandbox.root, { recursive: true, force: true })
      console.log(`TUI soul scenario teardown: ${existsSync(sandbox.root) ? "STILL PRESENT" : "absent"}`)
    }
  }
}

async function scenarioNonSoul() {
  const name = "task7-nonsoul"
  const sandbox = prepare("memory", {
    command: "create",
    reason: "TUI plain fact",
    file_path: "notes/facts/2026-08.md",
    description: "Facts",
    file_text: "- likes tea",
  })
  const sessionsDir = join(sandbox.agentDir, "sessions")
  try {
    launchTui(sandbox, name)
    // Settle signal: the commit itself is durable in the memory repo (the assistant's scripted
    // "done" follows in the same turn), so any entry emission would already have happened.
    const settled = await waitFor(
      () => {
        const agentsDir = join(sandbox.root, "memory", "agents")
        if (!existsSync(agentsDir)) return undefined
        const identityDir = readdirSync(agentsDir)[0]
        if (identityDir === undefined) return undefined
        const log = spawnSync("git", ["log", "--format=%s", "HEAD"], {
          cwd: join(agentsDir, identityDir, "repo"),
          encoding: "utf8",
        })
        return log.status === 0 && log.stdout.includes("TUI plain fact") ? true : undefined
      },
      { description: "committed non-soul memory write in the identity repo" },
    ).then(() => true).catch(() => false)
    const pane = capturePane(name)
    record("non-soul scenario: turn settled with the commit durable in git", settled)
    record(
      "non-soul scenario: the memory tool actually executed",
      !readSessions(sessionsDir).includes("Tool memory not found"),
    )
    record(
      "non-soul scenario: no soul-updated entry persisted",
      !readSessions(sessionsDir).includes("omo-memory:soul-updated"),
    )
    record(
      "non-soul scenario: renderer never produced a soul notice",
      !/memory soul updated/.test(pane),
    )
  } finally {
    killSession(name)
    if (process.env.QA_KEEP_SANDBOX === "1") {
      console.log(`NONSOUL SANDBOX KEPT: ${sandbox.root}`)
    } else {
      rmSync(sandbox.root, { recursive: true, force: true })
      console.log(`TUI non-soul scenario teardown: ${existsSync(sandbox.root) ? "STILL PRESENT" : "absent"}`)
    }
  }
}

await scenarioSoul()
await scenarioNonSoul()
const failed = results.filter((r) => !r.ok)
console.log(`TUI_RENDER_RESULT=${failed.length === 0 ? "PASS" : "FAIL"}`)
process.exitCode = failed.length === 0 ? 0 : 1
