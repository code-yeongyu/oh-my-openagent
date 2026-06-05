import { execSync } from "child_process"
import type { RunValidationArgs, ValidationResult } from "./types"

const MAX_TIMEOUT_SECONDS = 30

export async function runValidator(args: RunValidationArgs): Promise<ValidationResult> {
  const timeoutSeconds = Math.min(args.timeout_seconds ?? 10, MAX_TIMEOUT_SECONDS)
  const language = args.language ?? "python"
  const inputsStr = args.inputs ?? "{}"

  let inputData: Record<string, any> = {}
  try {
    inputData = JSON.parse(inputsStr)
  } catch {
    return {
      passed: false,
      errors: [`Invalid JSON in 'inputs': ${inputsStr.substring(0, 200)}`],
      duration_ms: 0,
    }
  }

  const script = buildScript(language, args.code)
  const startTime = Date.now()

  try {
    const stdout = execSync(script, {
      timeout: timeoutSeconds * 1000,
      input: JSON.stringify(inputData),
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, VALIDATION_INPUT: JSON.stringify(inputData) },
    })
    const durationMs = Date.now() - startTime
    const lines = stdout.trim().split("\n")
    const lastLine = lines[lines.length - 1]
    let result: Partial<ValidationResult>

    try {
      result = JSON.parse(lastLine)
    } catch {
      return {
        passed: false,
        errors: [`Validation did not return valid JSON. Got: ${lastLine?.substring(0, 200)}`],
        duration_ms: durationMs,
        stdout: stdout.substring(0, 5000),
      }
    }

    return {
      passed: result.passed ?? false,
      errors: result.errors ?? [],
      duration_ms: durationMs,
      stdout: stdout.substring(0, 5000),
    }
  } catch (err: any) {
    const durationMs = Date.now() - startTime
    if (err.killed || err.signal === "SIGTERM") {
      return {
        passed: false,
        errors: [`Validation timed out after ${timeoutSeconds}s`],
        duration_ms: durationMs,
        stderr: err.stderr?.substring(0, 2000),
      }
    }
    return {
      passed: false,
      errors: [`Validation error: ${err.message?.substring(0, 500)}`],
      duration_ms: durationMs,
      stderr: err.stderr?.substring(0, 2000),
      stdout: err.stdout?.substring(0, 2000),
    }
  }
}

function buildScript(language: string, code: string): string {
  switch (language) {
    case "python":
      return `python3 -c "${code.replace(/"/g, '\\"').replace(/`/g, '\\`')}"`
    case "typescript":
      return `bun -e "${code.replace(/"/g, '\\"').replace(/`/g, '\\`')}"`
    case "shell":
      return code
    default:
      throw new Error(`Unsupported validation language: ${language}`)
  }
}
