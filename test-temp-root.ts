/// <reference types="bun-types" />
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import reportOnlyPrefixesByOwner from "./test-temp-leak-report-only.json"
import { isOsCreatedTempEntry, reportOnlyOwner as ownerIn } from "./test-temp-leak-match"

// Every test process gets its own temp root, and the OS temp dir variables point at it for the rest
// of the process (#9766). os.tmpdir() re-reads them on each call, so every mkdtemp a test makes, and
// every temp dir a child process makes after inheriting this environment, lands inside the root.
//
// Two jobs follow from that, both in installTestTempRootTeardown():
// - The run cleans up after itself even when a test leaks: the whole root is removed.
// - Leaks are still caught: any entry left in the root that is not one of the preloads' own
//   directories fails the run, naming the leftover, so every test keeps removing what it creates.
//   Owners whose tests still leak are listed in test-temp-leak-report-only.json: their leftovers are
//   printed instead of failing, and that list may only shrink (script/check-temp-leak-report-only.mjs).
const RUN_ROOT_PREFIX = "omo-test-run-"
const OWNER_PID_FILE = ".owner-pid"

function ownerIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}

// A root with no readable owner pid was killed between its creation and the pid write; once it is this old,
// no live run can still be starting in it.
const OWNERLESS_ROOT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function isAbandoned(root: string): boolean {
  let pid: number
  try {
    pid = Number.parseInt(readFileSync(join(root, OWNER_PID_FILE), "utf8"), 10)
  } catch {
    try {
      return Date.now() - statSync(root).mtimeMs > OWNERLESS_ROOT_MAX_AGE_MS
    } catch {
      return false
    }
  }
  return Number.isInteger(pid) && pid > 0 && !ownerIsAlive(pid)
}

// A run that is killed (SIGKILL, a CI timeout, a crash) never reaches its afterAll, so its root stays
// behind. Each root records its owner's pid; a later run removes the roots whose owner is gone. A live
// pid, including a reused one, keeps its root, so a concurrent suite's root is never touched.
function removeAbandonedRunRoots(osTempDir: string): void {
  for (const entry of readdirSync(osTempDir)) {
    if (!entry.startsWith(RUN_ROOT_PREFIX)) continue
    const root = join(osTempDir, entry)
    if (isAbandoned(root)) rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  }
}

const osTempDir = tmpdir()
removeAbandonedRunRoots(osTempDir)
const runRoot = mkdtempSync(join(osTempDir, RUN_ROOT_PREFIX))
writeFileSync(join(runRoot, OWNER_PID_FILE), String(process.pid))
for (const name of ["TMPDIR", "TEMP", "TMP"] as const) process.env[name] = runRoot

// Entries the code under test writes under the OS temp dir for the whole process rather than per test:
// the plugin logger's file (LOG_FILENAME in shared/plugin-identity.ts) and the module compile cache that
// Node children enable under os.tmpdir(), and jiti's transpile cache. No test owns them; they are
// removed with the root.
const infrastructureEntries = new Set<string>([OWNER_PID_FILE, "oh-my-opencode.log", "node-compile-cache", "jiti"])

// A directory that lives for the whole process (a module-level fixture shared by every test file the
// process runs) has no test or file to own its removal; it goes here and leaves with the root.
const processScopedDir = mkdtempSync(join(runRoot, "omo-test-process-"))
infrastructureEntries.add(basename(processScopedDir))
process.env.OMO_TEST_PROCESS_TMPDIR = processScopedDir

/** Marks a directory a preload creates for the whole process, so the leak check does not report it. */
export function markTestInfrastructureDir(path: string): void {
  infrastructureEntries.add(basename(path))
}

function leftoverEntries(): string[] {
  try {
    return readdirSync(runRoot)
      .filter((entry) => !infrastructureEntries.has(entry) && !isOsCreatedTempEntry(entry))
      .sort()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

function reportOnlyOwner(entry: string): string | undefined {
  return ownerIn(entry, reportOnlyPrefixesByOwner)
}

function reportKnownLeaks(entries: readonly string[]): void {
  const byOwner = new Map<string, string[]>()
  for (const entry of entries) {
    const owner = reportOnlyOwner(entry) ?? "unknown"
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), entry])
  }
  const lines = [...byOwner].map(([owner, names]) => `  ${owner} (${names.length}): ${names.join(" ")}`)
  console.warn(`Known temp leaks, report-only until their owners are fixed (#9766):\n${lines.join("\n")}`)
}

const WINDOWS_HELD_HANDLE_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY"])

// Windows releases a child's file handles asynchronously, so the root can still be held when the run ends.
// That is not a leak: the next run's removeAbandonedRunRoots() deletes it once this process is gone.
function removeRunRoot(): void {
  try {
    rmSync(runRoot, { recursive: true, force: true, maxRetries: 3 })
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (process.platform === "win32" && typeof code === "string" && WINDOWS_HELD_HANDLE_CODES.has(code)) {
      console.warn(`Test temp root ${runRoot} is still held (${code}); the next run removes it.`)
      return
    }
    throw error
  }
}

/**
 * The end-of-run leak check and root removal. bun test fires no process "exit" or "beforeExit" event, so
 * the hermetic home's afterAll calls this in its finally, after it has stopped (and waited out) the task
 * hosts that write under the root: it then runs even when the hermetic home's own check throws.
 */
export function runTestTempRootTeardown(): void {
  const leftovers = leftoverEntries()
  removeRunRoot()
  const known = leftovers.filter((entry) => reportOnlyOwner(entry) !== undefined)
  const unexpected = leftovers.filter((entry) => reportOnlyOwner(entry) === undefined)
  if (known.length > 0) reportKnownLeaks(known)
  if (unexpected.length === 0) return
  throw new Error(
    `Tests left ${unexpected.length} temp entr${unexpected.length === 1 ? "y" : "ies"} behind (#9766). `
      + "Remove every temp dir a test creates in afterEach/afterAll, onTestFinished, or a finally block:\n"
      + unexpected.map((entry) => `  ${entry}`).join("\n"),
  )
}
