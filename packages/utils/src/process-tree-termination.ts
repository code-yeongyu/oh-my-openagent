import { execFile } from "node:child_process"

export type ProcessTreeSignalTarget = "process" | "process-group" | "process-tree"
export type ProcessTreeSignalOutcome = "denied" | "failed" | "missing" | "sent"

export interface ProcessTreeSignalAttempt {
  readonly error?: string
  readonly outcome: ProcessTreeSignalOutcome
  readonly pid: number
  readonly signal: "SIGKILL" | "SIGTERM"
  readonly target: ProcessTreeSignalTarget
}

export interface ProcessTreeTerminationReport {
  readonly attempts: readonly ProcessTreeSignalAttempt[]
  readonly survivorPids: readonly number[]
}

interface TerminateProcessTreeOptions {
  readonly childClosed: Promise<void>
  readonly graceMs: number
  readonly platform: NodeJS.Platform
  readonly waitMs: number
}

interface ProcessRow {
  readonly pgid: number
  readonly pid: number
  readonly ppid: number
}

export async function terminateProcessTree(
  pid: number,
  options: TerminateProcessTreeOptions,
): Promise<ProcessTreeTerminationReport> {
  return options.platform === "win32"
    ? terminateWindowsProcessTree(pid, options)
    : terminatePosixProcessTree(pid, options)
}

async function terminatePosixProcessTree(
  pid: number,
  options: TerminateProcessTreeOptions,
): Promise<ProcessTreeTerminationReport> {
  const attempts: ProcessTreeSignalAttempt[] = []
  const knownPids = new Set(await listPosixTreePids(pid))
  attempts.push(attemptPosixSignal(pid, "SIGTERM", "process-group"))
  await waitForDirectChild(options.childClosed, options.graceMs)
  for (const treePid of await listPosixTreePids(pid)) knownPids.add(treePid)

  const gracefulSurvivors = [...knownPids].filter(isProcessAlive)
  if (gracefulSurvivors.length > 0) {
    attempts.push(attemptPosixSignal(pid, "SIGKILL", "process-group"))
    for (const survivorPid of gracefulSurvivors) {
      attempts.push(attemptPosixSignal(survivorPid, "SIGKILL", "process"))
    }
  }

  const [survivorPids] = await Promise.all([
    waitForSurvivors([...knownPids], options.waitMs),
    waitForDirectChild(options.childClosed, options.waitMs),
  ])
  return { attempts, survivorPids }
}

async function terminateWindowsProcessTree(
  pid: number,
  options: TerminateProcessTreeOptions,
): Promise<ProcessTreeTerminationReport> {
  const attempts: ProcessTreeSignalAttempt[] = []
  attempts.push(await attemptWindowsTreeSignal(pid, "SIGTERM"))
  await waitForDirectChild(options.childClosed, options.graceMs)
  if (isProcessAlive(pid)) attempts.push(await attemptWindowsTreeSignal(pid, "SIGKILL"))
  const [survivorPids] = await Promise.all([
    waitForSurvivors([pid], options.waitMs),
    waitForDirectChild(options.childClosed, options.waitMs),
  ])
  return { attempts, survivorPids }
}

function attemptPosixSignal(
  pid: number,
  signal: "SIGKILL" | "SIGTERM",
  target: "process" | "process-group",
): ProcessTreeSignalAttempt {
  try {
    process.kill(target === "process-group" ? -pid : pid, signal)
    return { outcome: "sent", pid, signal, target }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const code = "code" in error ? error.code : undefined
    if (code === "ESRCH") return { outcome: "missing", pid, signal, target }
    if (code === "EPERM") return { error: error.message, outcome: "denied", pid, signal, target }
    return { error: error.message, outcome: "failed", pid, signal, target }
  }
}

function attemptWindowsTreeSignal(
  pid: number,
  signal: "SIGKILL" | "SIGTERM",
): Promise<ProcessTreeSignalAttempt> {
  const args = ["/PID", String(pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])]
  return new Promise((resolvePromise) => {
    execFile("taskkill.exe", args, { timeout: 5_000, windowsHide: true }, (error) => {
      if (error === null) {
        resolvePromise({ outcome: "sent", pid, signal, target: "process-tree" })
        return
      }
      const code = "code" in error ? error.code : undefined
      const outcome = code === "EPERM" ? "denied" : code === "ESRCH" ? "missing" : "failed"
      resolvePromise({ error: error.message, outcome, pid, signal, target: "process-tree" })
    })
  })
}

async function listPosixTreePids(rootPid: number): Promise<readonly number[]> {
  try {
    const rows = parseProcessRows(await execFileText("ps", ["-eo", "pid=,ppid=,pgid="]))
    const selected = new Set([rootPid])
    let changed = true
    while (changed) {
      changed = false
      for (const row of rows) {
        if (selected.has(row.pid) || (row.pgid !== rootPid && !selected.has(row.ppid))) continue
        selected.add(row.pid)
        changed = true
      }
    }
    return [...selected]
  } catch (error) {
    if (error instanceof Error) return [rootPid]
    throw error
  }
}

function parseProcessRows(output: string): readonly ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
    const pidText = match?.[1]
    const ppidText = match?.[2]
    const pgidText = match?.[3]
    if (pidText === undefined || ppidText === undefined || pgidText === undefined) continue
    const pid = Number(pidText)
    const ppid = Number(ppidText)
    const pgid = Number(pgidText)
    if (![pid, ppid, pgid].every(Number.isSafeInteger)) continue
    rows.push({ pgid, pid, ppid })
  }
  return rows
}

function execFileText(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolvePromise(stdout)
    })
  })
}

async function waitForSurvivors(pids: readonly number[], waitMs: number): Promise<readonly number[]> {
  const deadline = Date.now() + waitMs
  let survivors = pids.filter(isProcessAlive)
  while (survivors.length > 0 && Date.now() < deadline) {
    await delay(Math.min(25, Math.max(0, deadline - Date.now())))
    survivors = survivors.filter(isProcessAlive)
  }
  return survivors
}

function waitForDirectChild(childClosed: Promise<void>, waitMs: number): Promise<void> {
  return Promise.race([childClosed, delay(waitMs)])
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const code = "code" in error ? error.code : undefined
    if (code === "ESRCH") return false
    return code === "EPERM"
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}
