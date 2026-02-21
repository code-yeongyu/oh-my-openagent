import type { CheckFunction, CheckResult, DoctorIssue } from "../types"
import { spawn } from "bun"

async function checkBeadsInstalled(): Promise<{ installed: boolean; version?: string; error?: string }> {
  try {
    const proc = spawn(["bd", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    if (exitCode === 0) {
      const version = stdout.trim() || stderr.trim() || "unknown"
      return { installed: true, version }
    }

    return { installed: false, error: stderr.trim() || `exit code ${exitCode}` }
  } catch (e) {
    return { installed: false, error: e instanceof Error ? e.message : "not found" }
  }
}

export const checkBeads: CheckFunction = async (): Promise<CheckResult> => {
  const issues: DoctorIssue[] = []
  const details: string[] = []

  const result = await checkBeadsInstalled()

  if (result.installed) {
    details.push(`Beads CLI: installed (${result.version})`)
  } else {
    details.push("Beads CLI: not installed (optional)")
  }

  const status = result.installed ? "pass" : "warn"

  return {
    name: "Beads",
    status,
    message: result.installed
      ? `installed (${result.version})`
      : "not installed (optional - https://github.com/steveyegge/beads)",
    details,
    issues,
  }
}
