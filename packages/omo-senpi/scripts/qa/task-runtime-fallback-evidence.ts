import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"

export type ExpectedScenario = { readonly runner: string; readonly scenario: string }
const MAX_ARTIFACT_BYTES = 1024 * 1024
const SCENARIO_FILES = ["verdict.json", "task.json", "task.jsonl.log", "stdout.json.log", "stderr.log"]

/** Read only bounded regular fixture files; a symlink must never enter diagnostics or artifacts. */
function evidencePath(outDir: string, file: string): string {
  const segments = file.split(/[\\/]/)
  if (isAbsolute(file) || segments.some((part) => part === ".." || part === "." || part === "")) {
    throw new Error("unsafe evidence path")
  }
  if (lstatSync(outDir).isSymbolicLink()) throw new Error("symlink evidence root excluded")
  let source = outDir
  for (const part of segments) {
    source = join(source, part)
    if (lstatSync(source).isSymbolicLink()) throw new Error("symlink evidence path excluded")
  }
  return source
}

export function readFallbackEvidence(outDir: string, file: string, maxBytes = MAX_ARTIFACT_BYTES): string {
  const source = evidencePath(outDir, file)
  if (!lstatSync(source).isFile()) throw new Error("non-file evidence excluded")
  const fd = openSync(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error("non-file evidence excluded")
    if (file.endsWith(".json") && stat.size > maxBytes) throw new Error("oversized JSON evidence excluded")
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes))
    const bytesRead = readSync(fd, buffer, 0, buffer.length, Math.max(0, stat.size - buffer.length))
    return buffer.subarray(0, bytesRead).toString("utf8")
  } finally { closeSync(fd) }
}

/** Recover only task records/events from this wrapper's private sandbox after an interrupted driver. */
export function recoverFallbackEvidence(outDir: string, sandboxRoot: string, expected: readonly ExpectedScenario[]): void {
  let progress: unknown
  try { progress = JSON.parse(readFallbackEvidence(outDir, "progress.json")) }
  catch { return }
  if (progress === null || typeof progress !== "object" || !("scenarios" in progress) || !Array.isArray(progress.scenarios)) return
  for (const { runner, scenario } of expected) {
    const row = progress.scenarios.find((entry) => entry?.runner === runner && entry?.scenario === scenario)
    const stateDir = row?.stateDir
    if (typeof stateDir !== "string") continue
    const scoped = relative(sandboxRoot, stateDir)
    if (isAbsolute(scoped) || scoped === ".." || scoped.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) continue
    try {
      const tasks = relative(outDir, join(stateDir, "tasks"))
      const names = readdirSync(evidencePath(outDir, tasks)).filter((name) => name.endsWith(".json"))
      if (names[0] === undefined) continue
      const target = join(runner, scenario)
      // The driver's completed artifacts take precedence. Recovery never copies a sandbox tree.
      for (const [source, destination] of [
        [join(tasks, names[0]), join(target, "task.json")],
        [relative(outDir, join(stateDir, "logs", `${names[0].slice(0, -5)}.jsonl`)), join(target, "task.jsonl.log")],
      ]) {
        try {
          const text = readFallbackEvidence(outDir, source!)
          try { evidencePath(outDir, target) }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
            mkdirSync(join(outDir, target), { recursive: true })
            evidencePath(outDir, target)
          }
          writeFileSync(join(outDir, destination!), text, { flag: "wx" })
        } catch (error) {
          if (!["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error
        }
      }
    } catch (error) {
      // Best effort recovery must not replace the driver's original error.
      console.error(`Fallback task evidence recovery failed: ${String(error)}`)
    }
  }
}

/** Only copy this driver's controlled fixture outputs, never the sandbox, auth files or environment. */
export function retainFallbackEvidence(
  outDir: string,
  evidenceRoot: string,
  expected: readonly ExpectedScenario[],
  diagnostics: string,
  redact: (text: string) => string,
): string {
  mkdirSync(evidenceRoot, { recursive: true })
  const retained = mkdtempSync(join(evidenceRoot, "run-"))
  writeFileSync(join(retained, "driver-diagnostics.txt"), redact(diagnostics))
  const files = ["progress.json", "verdict.json", ...expected.flatMap(({ runner, scenario }) =>
    SCENARIO_FILES.map((file) => join(runner, scenario, file)))]
  const skipped: string[] = []
  for (const file of files) {
    try {
      let text = readFallbackEvidence(outDir, file)
      if (file.endsWith(".json")) {
        try {
          text = JSON.stringify(JSON.parse(text), (key, value) =>
            /credential_digest|token|password|secret|api[_-]?key|authorization/i.test(key) ? "[REDACTED]" : value, 2)
        } catch {
          // A malformed verdict is evidence too; it is redacted as text below.
          skipped.push(`${file}: malformed JSON retained as redacted text`)
        }
      }
      const target = join(retained, file)
      mkdirSync(join(target, ".."), { recursive: true })
      writeFileSync(target, redact(text))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") skipped.push(`${file}: ${String(error)}`)
    }
  }
  if (skipped.length > 0) writeFileSync(join(retained, "evidence-warnings.txt"), redact(skipped.join("\n")))
  return retained
}

export function fallbackRedactor(env: NodeJS.ProcessEnv): (text: string) => string {
  const values = Object.entries(env)
    .filter(([key, value]) => /TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY|AUTHORIZATION/i.test(key) && value)
    .map(([, value]) => value!)
    .sort((left, right) => right.length - left.length)
  return (text) => {
    for (const value of values) text = text.split(value).join("[REDACTED]")
    return text.replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
      .replace(/("[^"\n]*(?:credential_digest|token|password|secret|api[_-]?key|authorization)[^"\n]*"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
  }
}
