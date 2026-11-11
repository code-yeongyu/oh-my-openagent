import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, rmSync, type Stats, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { DenyLivePlan } from "./plan"
import { probeScript, type ProbeCheck } from "./preflight-script"
import { wrapDenyLive } from "./wrap"

export type PreflightResult =
  | { readonly ok: true; readonly checks: number }
  | { readonly ok: false; readonly reason: string }

const PROBE_TIMEOUT_MS = 15_000
const SENTINEL = "sentinel\n"
const PROBE_PREFIX = ".omo-sandbox-probe-"

/**
 * Proves the plan before any child runs (senpi#6287), inside the exact wrapper and filter the child
 * gets. Every write the child must be refused (a live sentinel, one through a view link, $HOME, a
 * project control dir, a hard link to a live file) has to fail with the sentinel unchanged; every
 * write the child needs (state dir, cwd, report dir) has to succeed; a unix socket connect must
 * fail, and on Linux the parent's pid must not be visible. A broken wrapper therefore cannot pass as a deny.
 */
export function preflightDenyLive(plan: DenyLivePlan, seccompFile: string | undefined, home: string): PreflightResult {
  const nonce = `${process.pid}-${randomBytes(6).toString("hex")}`
  const created: string[] = []
  const sentinel = (dir: string, name: string): string => {
    const path = join(dir, `${PROBE_PREFIX}${nonce}-${name}`)
    writeFileSync(path, SENTINEL, { flag: "wx", mode: 0o600 })
    created.push(path)
    return path
  }
  const listener = openProbeListener(nonce)
  try {
    for (const dir of [plan.liveRoot, home, ...plan.projectControl]) sweepStaleProbes(dir)
    const live = sentinel(plan.liveRoot, "live")
    const linked = join(plan.viewDir, `${PROBE_PREFIX}${nonce}-link`)
    symlinkSync(live, linked)
    created.push(linked)
    const hardLink = join(plan.cwd, `${PROBE_PREFIX}${nonce}-hardlink`)
    created.push(hardLink)
    const checks: ProbeCheck[] = [
      { kind: "deny-append", id: "live root", target: live },
      { kind: "deny-append", id: "view link", target: linked },
      { kind: "deny-append", id: "home", target: sentinel(home, "home") },
      ...plan.projectControl.filter(isDir).map((dir): ProbeCheck => ({ kind: "deny-append", id: `project ${dir}`, target: sentinel(dir, "ctl") })),
      { kind: "deny-hardlink", id: "hard link", target: live, link: hardLink },
      ...[plan.stateDir, plan.cwd, plan.artifactDir].map((dir): ProbeCheck => {
        const target = join(dir, `${PROBE_PREFIX}${nonce}-w`)
        created.push(target)
        return { kind: "allow-write", id: `writable ${dir}`, target }
      }),
      { kind: "deny-unix-socket", id: "unix socket", socketPath: listener.path },
      ...(plan.platform === "linux" ? [{ kind: "pid-hidden", id: "pid namespace", pid: process.pid } as const] : []),
    ]
    const script = probeScript(checks)
    if (script === undefined) return { ok: false, reason: "no perl or python3 to probe socket creation with" }
    const wrapped = wrapDenyLive(plan, "/bin/sh", ["-c", script], seccompFile)
    const fd = wrapped.seccompFile === undefined ? undefined : openSync(wrapped.seccompFile, "r")
    const run = (() => {
      try {
        return spawnSync(wrapped.command, [...wrapped.args], {
          encoding: "utf8", timeout: PROBE_TIMEOUT_MS, cwd: plan.cwd,
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C", TMPDIR: plan.tmpDir },
          stdio: fd === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", fd],
        })
      } finally {
        if (fd !== undefined) closeSync(fd)
      }
    })()
    if (run.status !== 0) return { ok: false, reason: `the sandbox wrapper failed to run the probe (exit ${run.status ?? run.signal}): ${(run.stderr ?? "").trim().slice(0, 300)}` }
    return verdict(checks, run.stdout ?? "")
  } catch (error) {
    return { ok: false, reason: `preflight failed: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    listener.close()
    for (const path of created.reverse()) rmSync(path, { force: true })
  }
}

// A parent-owned listening socket at a short path (sun_path holds 104 bytes on macOS). The kernel
// queues a connect without the event loop, so a connect the sandbox lets through succeeds.
function openProbeListener(nonce: string): { readonly path: string; readonly close: () => void } {
  const path = join("/tmp", `omo-sbx-${nonce}.sock`)
  const server = Bun.listen({ unix: path, socket: { data: () => undefined } })
  return {
    path,
    close: () => {
      server.stop(true)
      rmSync(path, { force: true })
    },
  }
}

function verdict(checks: readonly ProbeCheck[], stdout: string): PreflightResult {
  const lines = new Map(stdout.trim().split("\n").map((line) => {
    const [index, word] = line.split(" ")
    return [Number(index), word] as const
  }))
  for (const [index, check] of checks.entries()) {
    const word = lines.get(index)
    if (word === undefined) return { ok: false, reason: `the probe printed nothing for ${check.id}` }
    if (word !== "pass") return { ok: false, reason: `${check.id}: ${failure(check)}` }
    if ((check.kind === "deny-append" || check.kind === "deny-hardlink") && readFileSync(check.target, "utf8") !== SENTINEL) {
      return { ok: false, reason: `${check.id}: the sentinel changed` }
    }
  }
  return { ok: true, checks: checks.length }
}

function failure(check: ProbeCheck): string {
  switch (check.kind) {
    case "allow-write": return "a write the child needs was denied"
    case "deny-unix-socket": return "a unix socket could be created"
    case "pid-hidden": return "the parent process is visible"
    case "deny-append": case "deny-hardlink": return "a write that must be denied succeeded"
  }
}

// A parent killed mid-probe leaves sentinels behind. A probe finishes within PROBE_TIMEOUT_MS, so a
// probe file older than a minute belongs to no live preflight.
const STALE_PROBE_MS = 60_000

function sweepStaleProbes(dir: string): void {
  if (!isDir(dir)) return
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(PROBE_PREFIX)) continue
    const path = join(dir, name)
    // Another preflight may remove its own probe between the listing and this read.
    const mtimeMs = statOrUndefined(path)?.mtimeMs
    if (mtimeMs !== undefined && Date.now() - mtimeMs > STALE_PROBE_MS) rmSync(path, { force: true })
  }
}

function statOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function isDir(path: string): boolean {
  return existsSync(path) && lstatSync(path).isDirectory()
}

