import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync, spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const OMO_ROOT = new URL("../../../", import.meta.url).pathname
// Same override seam as the thread-tools harness: the defaults are this author's checkout
// layout, but every path a foreign machine cannot have is redirectable by env.
export const SENPI_ROOT = process.env.THREAD_QA_SENPI_ROOT ?? "/Users/yeongyu/local-workspaces/senpi-thread-tools"
export const EVIDENCE_ROOT = process.env.THREAD_QA_EVIDENCE_ROOT ?? "/Users/yeongyu/sisyphuslabs/.omo/evidence/thread-tools/task-14"

export function scratch(label) {
  const root = mkdtempSync(join(tmpdir(), `omo-thread-t14-${label}-`))
  const agentDir = join(root, "agent")
  const sessionDir = join(root, "sessions")
  const cwd = join(root, "work")
  for (const path of [agentDir, sessionDir, cwd]) mkdirSync(path, { recursive: true })
  return { root, agentDir, sessionDir, cwd, socket: join(root, "rpc.sock") }
}

export function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function killTree(pid) {
  const children = childPids(pid)
  for (const child of children) killTree(child)
  try { process.kill(pid, "SIGKILL") } catch {}
}

function childPids(pid) {
  try {
    return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
      .split(/\s+/).map(Number).filter((value) => Number.isInteger(value) && value > 0)
  } catch { return [] }
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

export async function waitGone(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`process ${pid} remained alive`)
}

export function writeJsonl(path, entries) {
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`)
}

export function cleanupScratch(value) {
  if (value?.root || value?.dir) rmSync(value.root ?? value.dir, { recursive: true, force: true })
}

/**
 * Pattern must catch every host shape this suite can leak, matched by CMDLINE:
 *  - rpc-host-fixture.mjs             (the unmanaged/wrong-version fixtures)
 *  - cli.ts|cli.js --mode rpc         (real senpi hosts, source or dist)
 *  - senpi-t14- and omo-thread-t14- prefixes (children living in our scratch dirs)
 *  - senpi-ensure-host-qa / t14*.sock (the ensure-host QA driver + stray /tmp sockets)
 * Verified against a live fixture, not assumed - see cleanup-receipt.txt.
 */
const STRAY_PATTERN = [
  "rpc-host-fixture",
  "host-lifecycle",
  "cli\\.(ts|js) --mode rpc",
  "--mode rpc --multi-session",
  "senpi-t14-",
  "omo-thread-t14-",
  "senpi-ensure-host-qa",
  "t14[^ ]*\\.sock",
].join("|")

export function processSnapshot() {
  try {
    return execFileSync("pgrep", ["-fal", STRAY_PATTERN], { encoding: "utf8" })
      .split("\n")
      // Never report the snapshotting process itself (its own argv contains the pattern).
      .filter((line) => line.trim().length > 0 && !line.includes("pgrep") && !line.includes(String(process.pid)))
      .join("\n")
      .trim()
  } catch { return "" }
}

export { STRAY_PATTERN }

export function cleanupReceipt(label, scratchPath, before, spawned = []) {
  const after = processSnapshot()
  mkdirSync(EVIDENCE_ROOT, { recursive: true })
  const receipt = [
    `scenario=${label}`,
    `scratch_removed=${!existsSync(scratchPath)}`,
    `spawned=${spawned.join(",") || "none"}`,
    `pgrep_before=${JSON.stringify(before)}`,
    `pgrep_after=${JSON.stringify(after)}`,
    `lsof_after=${lsofPath(scratchPath)}`,
  ].join("\n") + "\n"
  writeFileSync(join(EVIDENCE_ROOT, `${label}-cleanup-receipt.txt`), receipt)
  return receipt
}

function lsofPath(path) {
  try { return execFileSync("lsof", ["+c", "0", "--", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() } catch { return "" }
}

export function runChild(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] })
  return child
}

export function readJson(path) { return JSON.parse(readFileSync(path, "utf8")) }
