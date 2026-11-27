import { accessSync, constants } from "node:fs"
import { relative } from "node:path"

export interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

const ENVIRONMENT_SCHEMA = "omo-conformance-environment/1"

export interface Environment {
  readonly schema: typeof ENVIRONMENT_SCHEMA
  readonly driver: string
  readonly os: string
  readonly session: string
  readonly sourceSha: string
  readonly bun: string
  readonly platform: string
  readonly arch: string
  readonly checks: readonly Check[]
  readonly status: "ready" | "ENVIRONMENT_ERROR"
}

export type Probe = () => Promise<Check>

/** A repo-relative path with forward slashes: runs are compared across OSes, so the text must not depend on the host's separator. */
export function repoPath(repo: string, file: string): string {
  return relative(repo, file).replaceAll("\\", "/")
}

const HANG_GUARD_MS = 10_000

export function executable(path: string): Probe {
  return async () => {
    try {
      accessSync(path, constants.X_OK)
      return { name: "engine-binary", ok: true, detail: path }
    } catch {
      return { name: "engine-binary", ok: false, detail: `${path} is missing or not executable` }
    }
  }
}

function spawnStdio(
  path: string,
): { readonly child: Bun.Subprocess<"pipe", "pipe", "pipe"> } | { readonly error: string } {
  try {
    const child = Bun.spawn([path, "--stdio"], {
      env: { ...process.env, OMO_COMPUTER_BACKEND: "fake" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    return { child }
  } catch (error) {
    return { error: `cannot start ${path} --stdio: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The engine answers `engine.hello` over `--stdio` on the fake backend; the deadline is a hang guard only. */
export function fakeStdio(path: string): Probe {
  return async () => {
    const spawned = spawnStdio(path)
    if ("error" in spawned) return { name: "engine-stdio", ok: false, detail: spawned.error }
    const child = spawned.child
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "engine.hello", params: {} })}\n`)
    child.stdin.end()
    const guard = setTimeout(() => child.kill(), HANG_GUARD_MS)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(guard)
    const [reply = ""] = stdout.split("\n")
    if (reply.includes('"id":1') && reply.includes('"result"')) return { name: "engine-stdio", ok: true, detail: reply }
    const said = (stderr.trim().split("\n")[0] ?? "") || reply || "no output"
    return { name: "engine-stdio", ok: false, detail: `--stdio on the fake backend exited ${code}: ${said}` }
  }
}

function sourceSha(): string {
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir })
  return head.exitCode === 0 ? head.stdout.toString().trim() : "unknown"
}

/** Runs every probe once, before any cell; one failed prerequisite makes the whole run an ENVIRONMENT_ERROR. */
export async function preflight(
  where: { readonly driver: string; readonly os: string; readonly session: string },
  probes: readonly Probe[],
): Promise<Environment> {
  const checks: Check[] = []
  for (const probe of probes) checks.push(await probe())
  return {
    schema: ENVIRONMENT_SCHEMA,
    ...where,
    sourceSha: sourceSha(),
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
    checks,
    status: checks.every((check) => check.ok) ? "ready" : "ENVIRONMENT_ERROR",
  }
}
