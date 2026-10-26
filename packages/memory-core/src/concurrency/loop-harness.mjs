// Harness for loop-crash-consistency.mjs (omo #10177 loop driver): child process control,
// fixture repos, git/fsck oracles and the two iteration protocols. Kept apart from the CLI
// orchestration so both stay small enough to read in one sitting.

import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const concurrencyDir = fileURLToPath(new URL(".", import.meta.url))
export const writerChildPath = join(concurrencyDir, "writer-child.ts")
export const crashChildPath = join(concurrencyDir, "crash-commit-child.ts")

export const STAGE_BOUND_MS = 120_000
export const DEATH_PROOF_BOUND_MS = 5_000

export function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`stage timed out after ${STAGE_BOUND_MS}ms: ${executable} ${args.join(" ")}\nstdout=${stdout}\nstderr=${stderr}`))
    }, options.timeoutMs ?? STAGE_BOUND_MS)
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, pid: child.pid })
    })
  })
}

export function spawnChild(script, args) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ["pipe", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  const lines = []
  const waiters = []
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  let buffered = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
    buffered += chunk
    for (;;) {
      const newline = buffered.indexOf("\n")
      if (newline < 0) return
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      lines.push(line)
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index].predicate(line)) {
          const waiter = waiters.splice(index, 1)[0]
          waiter.resolve(line)
        }
      }
    }
  })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })))
  return {
    child,
    exit,
    send: (message) => child.stdin.write(`${message}\n`),
    output: () => `stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
    waitFor(expected, boundMs = STAGE_BOUND_MS) {
      const existing = lines.find((line) => line === expected)
      if (existing !== undefined) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`never saw "${expected}": stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`)), boundMs)
        waiters.push({
          predicate: (line) => line === expected,
          resolve: (line) => { clearTimeout(timer); resolve(line) },
        })
      })
    },
  }
}

export async function git(repoPath, args) {
  const result = await run("git", ["-C", repoPath, ...args])
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed (${result.code}): ${result.stderr}`)
  return result
}

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "memory-crash-loop-"))
  const repo = join(root, "repo")
  const locks = join(root, "runtime", "locks")
  await mkdir(repo, { recursive: true })
  await git(repo, ["init", "-b", "main"])
  await git(repo, ["config", "commit.gpgsign", "false"])
  const contentionPath = join(root, "contention-attempts.log")
  await writeFile(contentionPath, "")
  return { root, repo, locks, contentionPath }
}

function pidGone(pid) {
  if (process.platform === "linux") {
    try {
      const statLine = readFileSync(`/proc/${pid}/stat`, "utf8")
      const stateIndex = statLine.lastIndexOf(")") + 2
      if (statLine.slice(stateIndex, stateIndex + 1) === "Z") return true
    } catch (error) {
      if (error && error.code === "ENOENT") return true
    }
  }
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return Boolean(error && error.code === "ESRCH")
  }
}

export async function waitOwnerDead(lockPath, holderPid) {
  let raw
  try {
    raw = await readFile(lockPath, "utf8")
  } catch {
    return
  }
  let pid
  try {
    pid = JSON.parse(raw).pid
  } catch {
    return
  }
  if (pid !== holderPid) throw new Error(`unexpected lock owner: ${raw}`)
  const deadline = Date.now() + DEATH_PROOF_BOUND_MS
  while (!pidGone(pid)) {
    if (Date.now() >= deadline) throw new Error(`owner pid ${pid} still alive after ${DEATH_PROOF_BOUND_MS}ms`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

// The killed writer's in-flight `git commit` keeps running as an orphan; the takeover starts only
// after it exits, exactly as the takeover waits for the dead owner.
async function waitOrphanGone(pidPath) {
  let pid
  try {
    pid = Number.parseInt(await readFile(pidPath, "utf8"), 10)
  } catch {
    return
  }
  const deadline = Date.now() + DEATH_PROOF_BOUND_MS
  while (!pidGone(pid)) {
    if (Date.now() >= deadline) throw new Error(`orphan git ${pid} still alive after ${DEATH_PROOF_BOUND_MS}ms`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export async function fsckCheck(repoPath, stage) {
  const result = await run("git", ["-C", repoPath, "fsck", "--full", "--strict"])
  const report = `${result.stdout}\n${result.stderr}`
  const broken = report
    .split("\n")
    .filter((line) => /^(error|fatal):/.test(line) || /missing|corrupt/i.test(line))
  return {
    stage,
    ok: result.code === 0 && broken.length === 0,
    exitCode: result.code,
    broken,
    dangling: report.split("\n").filter((line) => line.startsWith("dangling")).length,
    report: report.trim().slice(0, 800),
  }
}

export async function sigkillIteration(fix) {
  const holder = spawnChild(writerChildPath, ["kill-holder", fix.repo, fix.locks, "holder", "10", fix.contentionPath])
  const survivor = spawnChild(writerChildPath, ["recovery", fix.repo, fix.locks, "survivor", "10", fix.contentionPath])
  await Promise.all([holder.waitFor("ready"), survivor.waitFor("ready")])
  holder.send("go")
  survivor.send("go")
  await holder.waitFor("kill-ready")
  holder.child.kill("SIGKILL")
  const holderExit = await holder.exit
  if (holderExit.signal !== "SIGKILL") throw new Error(`holder exit was ${JSON.stringify(holderExit)}, expected SIGKILL: ${holder.output()}`)
  await waitOwnerDead(join(fix.locks, "memory-write.lock"), holder.child.pid)
  const afterTakeover = await fsckCheck(fix.repo, "after-takeover")
  survivor.send("begin-recovery")
  const survivorExit = await survivor.exit
  if (survivorExit.code !== 0) throw new Error(`survivor failed: ${JSON.stringify(survivorExit)}: ${survivor.output()}`)
  const commits = await git(fix.repo, ["rev-list", "--count", "HEAD"])
  const merges = await git(fix.repo, ["rev-list", "--count", "--merges", "HEAD"])
  const afterCommits = await fsckCheck(fix.repo, "after-commits")
  return {
    commitCount: Number.parseInt(commits.stdout.trim(), 10),
    mergeCount: Number.parseInt(merges.stdout.trim(), 10),
    checks: [afterTakeover, afterCommits],
  }
}

export async function inCommitIteration(fix) {
  const killer = spawnChild(crashChildPath, ["kill-mid-commit", fix.repo, fix.locks, "killer", "0", "30"])
  await killer.waitFor("kill-ready")
  const killerExit = await killer.exit
  if (killerExit.signal !== "SIGKILL" && killerExit.code !== 0) {
    throw new Error(`killer exit was ${JSON.stringify(killerExit)}: ${killer.output()}`)
  }
  if (killerExit.code !== 0) await waitOwnerDead(join(fix.locks, "memory-write.lock"), killer.child.pid)
  await waitOrphanGone(join(fix.root, "killer-git.pid"))
  const afterTakeover = await fsckCheck(fix.repo, "after-takeover")
  const peer = spawnChild(crashChildPath, ["peer", fix.repo, fix.locks, "peer", "20"])
  const peerExit = await peer.exit
  if (peerExit.code !== 0) throw new Error(`peer failed: ${JSON.stringify(peerExit)}: ${peer.output()}`)
  const commits = await git(fix.repo, ["rev-list", "--count", "HEAD"])
  const merges = await git(fix.repo, ["rev-list", "--count", "--merges", "HEAD"])
  const afterCommits = await fsckCheck(fix.repo, "after-commits")
  return {
    commitCount: Number.parseInt(commits.stdout.trim(), 10),
    mergeCount: Number.parseInt(merges.stdout.trim(), 10),
    checks: [afterTakeover, afterCommits],
  }
}

export function expectedRange(caseKind) {
  // The in-commit killer's commit always lands (its orphan finishes before the takeover), so that
  // case has exactly 21 commits; the sigkill case kills a parked writer with no git child: 20.
  return caseKind === "in-commit" ? { min: 21, max: 21 } : { min: 20, max: 20 }
}
