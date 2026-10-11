import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { stopSandboxProcesses } from "./task-runtime-fallback-process"
import { fallbackRedactor, readFallbackEvidence, recoverFallbackEvidence, retainFallbackEvidence, type ExpectedScenario } from "./task-runtime-fallback-evidence"

const OUTPUT_TAIL_CHARS = 8_000
const TERMINATION_TIMEOUT_MS = 10_000

type DriverOptions = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly outDir: string
  readonly evidenceRoot: string
  readonly expected: readonly ExpectedScenario[]
  readonly timeoutMs: number
}

type ScenarioVerdict = ExpectedScenario & {
  readonly result: string
  readonly checks: Readonly<Record<string, string>>
}

type DriverExit = {
  code: number | null
  signal: NodeJS.Signals | null
  error?: string
  deadline: boolean
  terminationError?: string
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return
  if (process.platform !== "win32") {
    // The group can outlive its leader when a descendant still holds the driver's pipes open.
    try { process.kill(-child.pid, "SIGKILL") }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    return
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  const result = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
    stdio: "ignore", windowsHide: true, timeout: 5_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`taskkill exited ${result.status}`)
}

function readEvidence(outDir: string, path: string): string {
  try { return readFallbackEvidence(outDir, path, OUTPUT_TAIL_CHARS) }
  catch (error) { return `[unavailable: ${String(error)}]` }
}

function parseVerdict(outDir: string, expected: readonly ExpectedScenario[]): ScenarioVerdict[] {
  let value: unknown
  try { value = JSON.parse(readFallbackEvidence(outDir, "verdict.json")) }
  catch (error) { throw new Error(`aggregate verdict missing or malformed: ${String(error)}`) }
  if (value === null || typeof value !== "object" || !("result" in value) || !("scenarios" in value)
    || !Array.isArray(value.scenarios)) throw new Error("aggregate verdict invalid: expected result and scenarios")
  const scenarios: ScenarioVerdict[] = []
  for (const row of value.scenarios) {
    if (row === null || typeof row !== "object" || typeof row.runner !== "string" || typeof row.scenario !== "string"
      || typeof row.result !== "string" || row.checks === null || typeof row.checks !== "object" || Array.isArray(row.checks)
      || Object.keys(row.checks).length === 0 || Object.values(row.checks).some((check) => typeof check !== "string")) {
      throw new Error("aggregate verdict invalid: malformed scenario")
    }
    scenarios.push(row)
  }
  const identity = (row: ExpectedScenario) => `${row.runner}/${row.scenario}`
  if (JSON.stringify(scenarios.map(identity).sort()) !== JSON.stringify(expected.map(identity).sort())) {
    throw new Error(`aggregate verdict invalid: expected scenarios ${expected.map(identity).join(", ")}`)
  }
  const failing = scenarios.filter((row) => row.result !== "PASS" || Object.values(row.checks).some((check) => check !== "PASS"))
  if (value.result !== "PASS" || failing.length > 0) {
    throw new Error(`fallback scenario failure: ${JSON.stringify(failing).slice(-OUTPUT_TAIL_CHARS)}`)
  }
  return scenarios
}

/** The Windows suite and deterministic real-child tests share this complete failure boundary. */
export async function runFallbackDriver(options: DriverOptions): Promise<readonly ScenarioVerdict[]> {
  const redact = fallbackRedactor(options.env)
  // The fixture provider needs no caller credentials. Never let them reach the driver or its logs.
  const env = { ...options.env }
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY|AUTHORIZATION/i.test(key)) delete env[key]
  }
  let stdout = ""
  let stderr = ""
  // This unique root also identifies detached scenario processes after the driver has exited.
  if (lstatSync(options.outDir).isSymbolicLink()) throw new Error("symlink evidence root excluded")
  const sandboxRoot = realpathSync.native(mkdtempSync(join(options.outDir, "driver-sandboxes-")))
  Object.assign(env, { TMPDIR: sandboxRoot, TEMP: sandboxRoot, TMP: sandboxRoot })
  const exit: DriverExit = { code: null, signal: null, deadline: false }
  let child: ChildProcess | undefined
  let termination: Promise<void> | undefined
  const terminate = () => {
    termination ??= (async () => {
      const errors: string[] = []
      try { if (child !== undefined) await terminateProcessTree(child) }
      catch (error) { errors.push(String(error)) }
      try {
        const cleanup = await stopSandboxProcesses({ root: sandboxRoot }, Date.now() + 20_000)
        if (cleanup.survivors.length > 0) errors.push(`sandbox processes survived: ${cleanup.survivors.join(", ")}`)
      } catch (error) { errors.push(String(error)) }
      if (errors.length > 0) throw new Error(errors.join("; "))
    })().catch((error) => { exit.terminationError = String(error) })
    return termination
  }
  try {
    child = spawn(options.command, [...options.args], {
      cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"],
      shell: false, windowsHide: true, detached: process.platform !== "win32",
    })
    child.once("exit", (code, signal) => { exit.code = code; exit.signal = signal })
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-OUTPUT_TAIL_CHARS) })
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-OUTPUT_TAIL_CHARS) })
    await new Promise<void>((resolve) => {
      let terminationTimer: ReturnType<typeof setTimeout> | undefined
      const timer = setTimeout(() => {
        exit.deadline = true
        terminationTimer = setTimeout(() => {
          exit.terminationError ??= "driver did not close after termination; cleanup unverified"
          child?.stdout?.destroy()
          child?.stderr?.destroy()
          child?.unref()
          resolve()
        }, TERMINATION_TIMEOUT_MS * 2)
        void terminate()
      }, options.timeoutMs)
      child!.once("error", (error) => { exit.error = String(error) })
      child!.once("close", (code, signal) => {
        exit.code = code
        exit.signal = signal
        clearTimeout(timer)
        clearTimeout(terminationTimer)
        resolve()
      })
    })
  } catch (error) {
    exit.error = String(error)
  } finally {
    await terminate()
  }

  recoverFallbackEvidence(options.outDir, sandboxRoot, options.expected)
  const failures: string[] = []
  if (exit.deadline) failures.push(`fallback driver deadline expired after ${options.timeoutMs}ms`)
  if (exit.error) failures.push(`fallback driver spawn/process error: ${exit.error}`)
  if (exit.code !== 0 || exit.signal !== null) failures.push(`fallback driver exit code=${exit.code} signal=${exit.signal}`)
  if (exit.terminationError) failures.push(`driver cleanup failed: ${exit.terminationError}`)
  let scenarios: ScenarioVerdict[] = []
  try { scenarios = parseVerdict(options.outDir, options.expected) }
  catch (error) { failures.push(String(error)) }
  if (failures.length === 0) {
    rmSync(options.outDir, { recursive: true, force: true })
    return scenarios
  }

  const diagnostics = redact([
    ...failures,
    `driver: ${JSON.stringify(exit)}`,
    `stdout tail:\n${stdout}`,
    `stderr tail:\n${stderr}`,
    `progress:\n${readEvidence(options.outDir, "progress.json").slice(-OUTPUT_TAIL_CHARS)}`,
    ...options.expected.map(({ runner, scenario }) => {
      const dir = join(runner, scenario)
      return [`--- ${runner}/${scenario}`, `task: ${readEvidence(options.outDir, join(dir, "task.json")).slice(-1500)}`,
        `events tail: ${readEvidence(options.outDir, join(dir, "task.jsonl.log")).slice(-1500)}`,
        `stderr tail: ${readEvidence(options.outDir, join(dir, "stderr.log")).slice(-1500)}`].join("\n")
    }),
  ].join("\n"))
  let evidence: string
  try {
    evidence = retainFallbackEvidence(options.outDir, options.evidenceRoot, options.expected, diagnostics, redact)
  } catch (error) {
    evidence = `could not stage evidence (${String(error)}); original directory preserved at ${options.outDir}`
  }
  throw new Error(`${diagnostics}\nRetained fallback evidence: ${evidence}`)
}
