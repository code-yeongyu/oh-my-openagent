import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "../fs/resilient"
import { join } from "node:path"

// Opt-in evidence for a git that outlives its timeout (omo #10821): on Windows CI one `git add` stalls
// past 30 s and its repository stays locked long after the kill, and no run has reproduced it on
// demand. When this variable names a directory, the timeout records the live process table (with
// the stalled git's thread wait states on Windows) before git is signalled. Unset, nothing runs.
export const GIT_TIMEOUT_DIAGNOSTICS_ENV = "OMO_GIT_TIMEOUT_DIAGNOSTICS_DIR"

// The snapshot is synchronous and blocks this process for at most this long before git is signalled.
// That cost exists only in diagnostics mode and only on an actual timeout, where the evidence matters more.
const SNAPSHOT_TIMEOUT_MS = 15_000

function snapshotCommand(pid: number): readonly [string, readonly string[]] {
  return process.platform === "win32"
    ? [
        "powershell",
        [
          "-NoProfile",
          "-Command",
          [
            "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine | Format-Table -AutoSize -Wrap | Out-String -Width 400",
            // Thread states for the git and every child it started, in case the stalled work runs in a child.
            `@(${pid}) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | ForEach-Object { $_.ProcessId }) | ForEach-Object { "threads of $_"; (Get-Process -Id $_ -ErrorAction SilentlyContinue).Threads | Group-Object ThreadState,WaitReason -NoElement | Format-Table -AutoSize | Out-String }`,
          ].join("; "),
        ],
      ]
    : ["ps", ["-axo", "pid,ppid,stat,wchan,etime,command"]]
}

// The table goes to a temp file, never a pipe: spawnSync caps a pipe at maxBuffer (1 MiB by default),
// and a host running thousands of processes overflows any fixed cap, which lost the whole table to
// ENOBUFS (omo #12801). A file has no such cap, so both platforms write their output to one.
function processSnapshot(pid: number): string {
  const [file, args] = snapshotCommand(pid)
  const output = join(tmpdir(), `omo-git-timeout-snapshot-${process.pid}-${randomUUID()}.txt`)
  let fd: number | undefined
  try {
    fd = openSync(output, "wx", 0o600)
    const command = spawnSync(file, args, {
      stdio: ["ignore", fd, fd],
      timeout: SNAPSHOT_TIMEOUT_MS,
      windowsHide: true,
    })
    if (command.error) return `process snapshot failed: ${command.error.message}`
    return readFileSync(output, "utf8")
  } catch (error) {
    return `process snapshot failed: ${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
      unlinkSync(output)
    }
  }
}

export function recordGitTimeout(
  environment: NodeJS.ProcessEnv,
  pid: number | undefined,
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  snapshot: (pid: number) => string = processSnapshot,
): void {
  const directory = environment[GIT_TIMEOUT_DIAGNOSTICS_ENV]
  if (!directory || pid === undefined) return
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, `git-timeout-${pid}-${Date.now()}.json`),
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          pid,
          cwd,
          timeoutMs,
          argv: argv.slice(0, 12),
          argCount: argv.length,
          processes: snapshot(pid),
        },
        null,
        2,
      )}\n`,
    )
  } catch (error) {
    process.stderr.write(`git timeout diagnostics could not be written to ${directory}: ${String(error)}\n`)
  }
}
