#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"

const MOCK_PROVIDER = resolve("packages/omo-senpi/scripts/qa/mock-provider/index.ts")
const POINTER = "Read the init-deep skill at"

export function createFixture(pluginPath) {
  const root = mkdtempSync(join(tmpdir(), "omo-init-deep-rpc-"))
  const sandbox = join(root, "agent")
  const repo = join(root, "repo")
  const home = join(root, "home")
  const xdg = join(root, "xdg")
  for (const dir of [sandbox, repo, home, xdg]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(sandbox, "settings.json"), `${JSON.stringify({ extensions: [pluginPath] })}\n`)
  writeFileSync(join(sandbox, "trust.json"), `${JSON.stringify({ [realpathSync(repo)]: true })}\n`)
  const marker = join(sandbox, "omo-senpi", "omo-native", "onboarding-completed")
  mkdirSync(resolve(marker, ".."), { recursive: true })
  writeFileSync(marker, JSON.stringify({ completedAt: new Date(0).toISOString(), version: 1 }))
  const old = new Date(Date.now() - 60_000)
  utimesSync(marker, old, old)
  git(repo, ["init"])
  mkdirSync(join(repo, "src"), { recursive: true })
  for (let index = 0; index < 10; index += 1) {
    writeFileSync(join(repo, "src", `source-${index}.ts`), `export const value${index} = ${index}\n`)
  }
  git(repo, ["add", "-A"])
  commit(repo, "init")
  return { root, sandbox, repo, home, xdg }
}

export function git(repo, args) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

export function gitText(repo, args) {
  const result = git(repo, args)
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
  return result.stdout.trim()
}

export function commit(repo, message) {
  const result = git(repo, ["-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", message])
  if (result.status !== 0) throw new Error(`git commit failed: ${result.stderr}`)
}

export function repoHash(repo) {
  const common = gitText(repo, ["rev-parse", "--git-common-dir"])
  return createHash("sha256").update(realpathSync(resolve(repo, common))).digest("hex")
}

export function writeSnapshot(repo, sha) {
  mkdirSync(join(repo, ".omo"), { recursive: true })
  writeFileSync(join(repo, ".omo", "init-deep.json"), `${JSON.stringify({ commitSha: sha, fileCount: 10, loc: 10, timestamp: Date.now(), mode: "local" })}\n`)
}

export function writeFutureCooldown(fixture) {
  const dir = join(fixture.sandbox, "omo-senpi", "omo-native", "init-deep-advisor-state", "init-deep-advisor-cooldowns")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, repoHash(fixture.repo)), JSON.stringify({ until: Date.now() + 7 * 86_400_000 }))
}

export async function launchRpc(fixture, expectUi) {
  const before = new Set(sessionFiles(fixture.sandbox))
  const child = spawn("senpi", ["-e", MOCK_PROVIDER, "--mode", "rpc", "--provider", "omo-mock", "--model", "mock-1"], {
    cwd: fixture.repo,
    env: { ...process.env, HOME: fixture.home, USERPROFILE: fixture.home, XDG_CONFIG_HOME: fixture.xdg, SENPI_CODING_AGENT_DIR: fixture.sandbox, PI_CODING_AGENT_DIR: fixture.sandbox },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const events = createEventBus(child)
  const turnWait = events.waitFor((event) => event.type === "turn_start", 10_000, "turn_start")
  const uiWait = events.waitFor((event) => event.type === "extension_ui_request" && event.method === "select" && event.title === "Init-deep", 10_000, "extension_ui_request")
  const settledWait = events.waitFor((event) => event.type === "agent_settled", 30_000, "agent_settled")
  try {
    child.stdin.write(`${JSON.stringify({ id: "qa-prompt", type: "prompt", message: "test" })}\n`)
    const turn = await turnWait
    let request
    if (expectUi) {
      request = await uiWait
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: request.id, value: "Run now" })}\n`)
    } else {
      request = await uiWait.then((event) => event, () => undefined)
    }
    const settled = await settledWait
    if (settled.turnIndex !== events.latestTurnIndex()) throw new Error("agent_settled was not correlated to the latest captured turnIndex")
    if (turn.turnIndex > settled.turnIndex) throw new Error("agent_settled preceded the captured turn")
    if (!expectUi && request !== undefined) throw new Error(`unexpected Init-deep UI request ${request.id}`)
    await terminate(child)
    const created = sessionFiles(fixture.sandbox).filter((file) => !before.has(file))
    if (created.length !== 1) throw new Error(`expected one new session JSONL, found ${created.length}`)
    return { turnIndex: turn.turnIndex, settledTurnIndex: settled.turnIndex, requestId: request?.id, session: created[0], transcript: readFileSync(created[0], "utf8"), stderr: events.stderr() }
  } finally {
    await terminate(child)
  }
}

export function assertPointer(run) {
  if (!run.transcript.includes("omo-init-deep-advisor:run") || !run.transcript.includes(POINTER)) {
    throw new Error("session transcript is missing the init-deep bootstrap pointer")
  }
}

export function proposalPath(fixture) {
  return join(fixture.sandbox, "omo-senpi", "omo-native", "init-deep-advisor-state", "init-deep-advisor-proposals", repoHash(fixture.repo))
}

export function removeCooldown(fixture) {
  rmSync(join(fixture.sandbox, "omo-senpi", "omo-native", "init-deep-advisor-state", "init-deep-advisor-cooldowns", repoHash(fixture.repo)), { force: true })
}

export function cleanupFixture(fixture) {
  rmSync(fixture.root, { recursive: true, force: true })
  if (existsSync(fixture.root)) throw new Error(`sandbox cleanup failed: ${fixture.root}`)
}

function createEventBus(child) {
  const events = []
  const waiters = []
  let latestTurn = -1
  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
  createInterface({ input: child.stdout }).on("line", (line) => {
    let event
    try { event = JSON.parse(line) } catch { return }
    if (event.type === "turn_start") {
      latestTurn += 1
      event = { ...event, turnIndex: latestTurn }
    }
    if (event.type === "agent_settled") event = { ...event, turnIndex: latestTurn }
    events.push(event)
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue
      clearTimeout(waiter.timer)
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(event)
    }
  })
  return {
    waitFor(predicate, timeout, label) {
      const found = events.find(predicate)
      if (found) return Promise.resolve(found)
      return new Promise((resolvePromise, reject) => {
        const waiter = { predicate, resolve: resolvePromise, reject, timer: undefined }
        waiter.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1)
          const seen = events.map((event) => `${event.type}${event.method ? `:${event.method}` : ""}`).join(",")
          reject(new Error(`${label} timed out after ${timeout}ms; events=${seen}; stderr=${stderr.slice(-500)}`))
        }, timeout)
        waiters.push(waiter)
      })
    },
    latestTurnIndex: () => latestTurn,
    stderr: () => stderr,
  }
}

function sessionFiles(root) {
  const files = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path)
    }
  }
  walk(join(root, "sessions"))
  return files.sort()
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.stdin.end()
  if (await waitForExit(child, 5_000)) return
  child.kill("SIGTERM")
  if (await waitForExit(child, 5_000)) return
  child.kill("SIGKILL")
  if (!(await waitForExit(child, 5_000))) throw new Error(`RPC child ${child.pid} did not terminate`)
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", onExit)
      resolvePromise(false)
    }, timeout)
    const onExit = () => {
      clearTimeout(timer)
      resolvePromise(true)
    }
    child.once("exit", onExit)
  })
}
