import { existsSync, writeFileSync } from "../fs/resilient"
import { dirname } from "node:path"
import { spawn } from "node:child_process"

import { GitMemoryRepo } from "../git"
import { createNodeGitExec, type GitExec, type GitExecResult } from "../git/exec"
import {
  acquireLock,
  createLockRecord,
  memoryWriterLockPath,
  releaseLock,
} from "../locks"
import { runMemoryTool } from "../tools/memory"

// Subprocess fixture for omo #10177 crash-consistency coverage. Unlike writer-child.ts (which
// parks BETWEEN commits before the parent SIGKILLs it), the kill-mid-commit mode SIGKILLs itself
// while its own `git commit` process is mid-flight - the interleaving the issue's missing-object
// failure needs: object writes, index update, and ref update sampled at a random point. The peer
// mode then takes the lock over through the normal dead-owner protocol and lands follow-up
// commits. Neither mode reads stdin: the kill is self-timed, so the parent only awaits exit.
//
// kill-at-git-lock goes one level deeper: it spawns its `git commit` directly, waits for git's own
// lock file (index.lock, or refs/heads/main.lock) to appear - proof the commit is mid-flight - and
// SIGKILLs the git process at that exact instant. A killed git process can never remove the lock
// files it created; the peer's takeover then faces that debris. The peer's sweep runs under the
// memory-write lock and requires the takeover's recorded dead-owner proof, which lives in the
// killer's process - so the killer stays alive until the parent observes the debris, sends
// "swept", and only then does the killer die (the memory-write lock record names the killer).

const SETTLE_ENV_VAR = "OMO_TEST_GIT_LOCK_SETTLE_MS"
// Read by ../git/repo-lock-sweep at module init in THIS child process; the harness passes the
// value through the child's environment. Kept here as a named constant so the fixture and the
// test share one spelling.
void SETTLE_ENV_VAR

type Mode = "kill-mid-commit" | "kill-at-git-lock" | "peer"

const [modeValue, repoPath, locksPath, writerId, first, second] = process.argv.slice(2)
if (
  (modeValue !== "kill-mid-commit" && modeValue !== "kill-at-git-lock" && modeValue !== "peer") ||
  repoPath === undefined ||
  locksPath === undefined ||
  writerId === undefined ||
  first === undefined
) {
  throw new Error("missing crash commit child arguments")
}
const mode: Mode = modeValue
const lockPath = memoryWriterLockPath(locksPath)

// The kill arms only once the `git commit` process exists, so the writer always dies with its
// commit in flight; the orphan's pid goes to `<repo>/../killer-git.pid` so the parent can wait for
// the orphan to finish before the peer's takeover, instead of racing it.
export function orphanPidPath(repo: string): string {
  return `${dirname(repo)}/killer-git.pid`
}

function createInCommitKillExec(minDelayMs: number, maxDelayMs: number): GitExec {
  const real = createNodeGitExec()
  return {
    run(argv, options) {
      // authorFlags prefix the command (`-c user.name=... commit -m ...`), so the literal
      // argument "commit" marks exactly the commit invocation; no other path command carries it.
      if (!argv.includes("commit")) return real.run(argv, options)
      return new Promise<GitExecResult>((resolve, reject) => {
        const child = spawn("git", [...argv], { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8") })
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
        child.once("error", reject)
        let killTimer: ReturnType<typeof setTimeout> | undefined
        child.once("spawn", () => {
          writeFileSync(orphanPidPath(repoPath), String(child.pid))
          const delayMs = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1))
          killTimer = setTimeout(() => process.kill(process.pid, "SIGKILL"), delayMs)
        })
        child.once("exit", (code) => {
          // Disarm before resolving: the kill is only the interleaving under test while the
          // commit is in flight. A timer that survives git's exit can SIGKILL this child after
          // it already released the memory-write lock, and the parent then reads a missing lock
          // record (ENOENT) even though the owner died cleanly past the commit window.
          if (killTimer !== undefined) clearTimeout(killTimer)
          resolve({ code: code ?? 1, stdout, stderr })
        })
      })
    },
  }
}

async function gitStdout(args: readonly string[]): Promise<string> {
  const child = spawn("git", ["-C", repoPath, ...args], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true })
  let out = ""
  child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8") })
  await new Promise((resolve) => child.once("exit", resolve))
  return out.trim()
}

async function waitExit(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise((resolve) => child.once("exit", resolve))
}

// On Windows `git` is a launcher whose child is the real git.exe. Killing only the launcher lets the
// real git see stdin close and remove its own lock, so kill the whole tree, as SIGKILL does on POSIX.
async function killGitTree(git: ReturnType<typeof spawn>): Promise<void> {
  const exited = git.exitCode !== null || git.signalCode !== null ? Promise.resolve() : waitExit(git)
  if (process.platform === "win32") {
    const taskkill = spawn("taskkill", ["/F", "/T", "/PID", String(git.pid)], { stdio: "ignore", windowsHide: true })
    await waitExit(taskkill)
  } else git.kill("SIGKILL")
  await exited
}

function unreachable(message: string): never {
  throw new Error(message)
}

// git's own lockfile protocol strands these files when its process dies mid-transaction; each
// stranding below uses a real git child, proven to hold its lock (the file exists, or the command
// acknowledged `prepare: ok`), before both processes take SIGKILL. Nothing is hand-crafted: the
// post-kill state is exactly what a crashed committer leaves.
async function strandIndexLockAndDie(): Promise<never> {
  // `git update-index --stdin` creates .git/index.lock at startup and holds it while it waits for
  // input, so the lock file's existence proves the git child is alive and holding it.
  const git = spawn("git", ["-C", repoPath, "update-index", "--stdin"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true })
  const deadline = Date.now() + 10_000
  while (!existsSync(`${repoPath}/.git/index.lock`)) {
    if (Date.now() >= deadline) {
      git.kill("SIGKILL")
      throw new Error("index.lock never appeared under update-index --stdin")
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  await killGitTree(git)
  // Keep this process (the memory-write lock owner) alive until the parent confirms the debris
  // state and releases us: the peer's sweep needs this process's takeover record, which dies
  // with this process's in-memory registry.
  await waitForParentRelease()
  process.kill(process.pid, "SIGKILL")
  return unreachable("survived self-SIGKILL")
}

async function strandRefLockAndDie(): Promise<never> {
  // `git update-ref --stdin` takes refs/heads/main.lock during `prepare` and keeps holding it while
  // it waits for `commit` or `abort`; `prepare: ok` on stdout is git's own acknowledgement.
  const head = await gitStdout(["rev-parse", "HEAD"])
  const git = spawn("git", ["-C", repoPath, "update-ref", "--stdin"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
  let out = ""
  git.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8") })
  git.stdin.write(`start\nupdate refs/heads/main ${head}\nprepare\n`)
  const deadline = Date.now() + 10_000
  while (!out.includes("prepare: ok")) {
    if (Date.now() >= deadline) {
      git.kill("SIGKILL")
      throw new Error(`update-ref never acknowledged prepare: ${JSON.stringify(out)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  if (!existsSync(`${repoPath}/.git/refs/heads/main.lock`)) {
    git.kill("SIGKILL")
    throw new Error("refs/heads/main.lock missing after prepare: ok")
  }
  await killGitTree(git)
  await waitForParentRelease()
  process.kill(process.pid, "SIGKILL")
  return unreachable("survived self-SIGKILL")
}

function waitForParentRelease(): Promise<void> {
  return new Promise((resolve) => {
    let buffer = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk
      if (buffer.includes("swept\n")) resolve()
    })
  })
}

async function createCommit(repo: GitMemoryRepo, writer: string, index: number): Promise<void> {
  await runMemoryTool({
    repo,
    lock: (_domain, operation) => operation(),
    params: {
      command: "create",
      reason: `crash-consistency: ${writer} ${index}`,
      author: { agentId: `crash-${writer}`, authorName: `Writer ${writer}` },
      file_path: `concurrency/${writer}-${index}.md`,
      description: `crash-consistency write ${writer} ${index}`,
      file_text: `${writer}:${index}\n`,
    },
  })
}

if (mode === "kill-mid-commit" || mode === "kill-at-git-lock") {
  let repo: GitMemoryRepo
  if (mode === "kill-mid-commit") {
    const minDelayMs = Number.parseInt(first, 10)
    const maxDelayMs = Number.parseInt(second ?? "", 10)
    if (!Number.isInteger(minDelayMs) || !Number.isInteger(maxDelayMs) || minDelayMs < 0 || maxDelayMs < minDelayMs) {
      throw new Error(`invalid kill delay window: ${first}..${String(second)}`)
    }
    repo = new GitMemoryRepo({
      dir: repoPath,
      agentId: `crash-${writerId}`,
      exec: createInCommitKillExec(minDelayMs, maxDelayMs),
    })
  } else {
    if (first !== "index-lock" && first !== "ref-lock") throw new Error(`invalid kill trigger: ${first}`)
    repo = new GitMemoryRepo({ dir: repoPath, agentId: `crash-${writerId}` })
  }
  const record = await createLockRecord("memory-write", { runId: `${writerId}-0` })
  await acquireLock(lockPath, record, { waitTimeoutMs: 15_000, retryDelayMs: 5 })
  process.stdout.write("kill-ready\n")
  if (mode === "kill-mid-commit") {
    try {
      await createCommit(repo, writerId, 0)
    } finally {
      await releaseLock(lockPath, record)
    }
    // Reaching here means the kill timer missed the commit window; the lock was released normally.
    process.stdout.write("done:missed\n")
  } else if (first === "index-lock") {
    await strandIndexLockAndDie()
  } else {
    // A killed committer has history under its belt, so strand the ref lock on top of a real root
    // commit before dying. The release never runs: SIGKILL is the point.
    await createCommit(repo, writerId, 0)
    await strandRefLockAndDie()
  }
} else {
  const count = Number.parseInt(first, 10)
  if (!Number.isInteger(count) || count < 1) throw new Error(`invalid peer count: ${first}`)
  const repo = new GitMemoryRepo({ dir: repoPath, agentId: `crash-${writerId}` })
  for (let index = 0; index < count; index += 1) {
    const record = await createLockRecord("memory-write", { runId: `${writerId}-${index}` })
    await acquireLock(lockPath, record, { waitTimeoutMs: 15_000, retryDelayMs: 5 })
    try {
      await createCommit(repo, writerId, index)
    } finally {
      await releaseLock(lockPath, record)
    }
  }
  process.stdout.write(`done:${count}\n`)
}
