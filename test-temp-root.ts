/// <reference types="bun-types" />
import { type ChildProcess, spawn } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { removeTestRootBestEffort, skippedTestRoots } from "./test-support/held-test-root.mjs"
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
// A run root renamed aside for a detached remover; it keeps the prefix, so the abandoned-root sweep still finds it.
const ASIDE_SUFFIX = ".removing"

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
export function removeAbandonedRunRoots(
  osTempDir: string,
  removeRoot?: (root: string) => void,
  spawnRemover?: (path: string) => ChildProcess,
): void {
  for (const entry of readdirSync(osTempDir)) {
    if (!entry.startsWith(RUN_ROOT_PREFIX)) continue
    const root = join(osTempDir, entry)
    if (!isAbandoned(root)) continue
    // Without an injected remover the sweep is as non-blocking as the run's own teardown: an abandoned root
    // can be as large as a live one, and a remover still deleting one is simply joined by a second.
    if (removeRoot) removeTestRootBestEffort(root, { remove: removeRoot })
    else removeRunRootAside(root, spawnRemover)
  }
}

const osTempDir = tmpdir()
const tempEnvironment = ["TMPDIR", "TEMP", "TMP"].map((name) => [name, process.env[name]] as const)
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
      .filter((entry) => !infrastructureEntries.has(entry) && !isOsCreatedTempEntry(entry)
        && !skippedTestRoots.has(join(runRoot, entry)) && !isRootBeingRemoved(entry))
      .sort()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

// A nested test run (a test that starts `bun test`) puts its own run root in this one and renames it aside
// at its end; its detached remover may still be deleting it here, and this root's removal takes it anyway.
function isRootBeingRemoved(entry: string): boolean {
  return entry.startsWith(RUN_ROOT_PREFIX) && entry.endsWith(ASIDE_SUFFIX)
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

/**
 * Removes a run root without holding the caller for as long as the tree takes to delete (#11630, #12209).
 *
 * The root collects everything the run's processes wrote under the OS temp dir, child bun caches included,
 * and a synchronous recursive remove of a large one overran the end-of-run hook budget (43 s for 1.2 GB on a
 * loaded machine, 95 s for a full shard's root on a windows-latest runner) as an unnamed hook failure. The
 * root is renamed aside in one step, which empties its path at once, and a detached remover deletes the
 * renamed tree after this process has gone. The aside name keeps the run-root prefix and the owner pid file,
 * so a remover that dies is swept by the next run like any abandoned root. Only this run's own root is
 * touched; nothing else in the OS temp dir is read or removed.
 *
 * A root that cannot be renamed (a held handle) goes to the remover where it stands, so the run never waits
 * for the handle to close: the remover retries for as long as that takes.
 */
export function removeRunRootAside(
  root: string,
  spawnRemover: (path: string) => ChildProcess = spawnDetachedRemover,
): ChildProcess | undefined {
  if (root.endsWith(ASIDE_SUFFIX)) return spawnRemover(root)
  const aside = `${root}${ASIDE_SUFFIX}`
  try {
    renameSync(root, aside)
  } catch {
    // Windows kept the synchronous best-effort removal here, and that walk is the hook failure above.
    if (process.platform !== "win32") {
      removeTestRootBestEffort(root)
      return undefined
    }
    return spawnRemover(root)
  }
  return spawnRemover(aside)
}

const DETACHED_STDIO = { detached: true, stdio: "ignore" } as const

function spawnDetachedRemover(path: string): ChildProcess {
  // Windows has no /bin/rm, and fs.rmSync's own maxRetries never retries under bun (oven-sh/bun#41480, see
  // test-support/remove-tree.ts), so the remover retries the lock window itself in a bounded loop. `detached`
  // keeps it out of this process's kill-on-close job so it outlives the run, the executable's own directory
  // as its cwd means its working directory can never be the tree it is deleting, and windowsHide keeps a
  // console from flashing for a background remover that has no window to show.
  const remover = process.platform === "win32"
    ? spawn(process.execPath, ["-e", windowsRemoverSource(path)], {
      ...DETACHED_STDIO,
      windowsHide: true,
      cwd: dirname(process.execPath),
    })
    : spawn("/bin/rm", ["-rf", path], DETACHED_STDIO)
  remover.unref()
  return remover
}

/** Deleting a tree a just-killed child or the runner's scanner still holds: 120 attempts, 250 ms apart. */
function windowsRemoverSource(path: string): string {
  return `const fs = require("node:fs")
const target = ${JSON.stringify(path)}
let attempt = 0
;(function remove() {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (error) {
    if (++attempt >= 120) throw error
    setTimeout(remove, 250)
  }
})()`
}

// A recorded held child directory can also keep its containing run root locked.
// Keep that removal best-effort too; neither record establishes why the handle remains open.
function removeRunRoot(): void {
  // A reused test worker must not hand the next child a temp directory this teardown removes.
  for (const [name, value] of tempEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  removeRunRootAside(runRoot)
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
