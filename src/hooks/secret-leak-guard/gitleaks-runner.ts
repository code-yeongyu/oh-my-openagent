import { log } from "../../shared"

export interface GitleaksResult {
  available: boolean
  findings: GitleaksFinding[]
  error?: string
}

export interface GitleaksFinding {
  RuleID: string
  Match: string
  File: string
  StartLine: number
  EndLine: number
  Description: string
}

let gitleaksAvailable: boolean | null = null
const GITLEAKS_VERSION_TIMEOUT_MS = 5_000
const GITLEAKS_SCAN_TIMEOUT_MS = 30_000

async function checkGitleaksAvailable(): Promise<boolean> {
  if (gitleaksAvailable !== null) return gitleaksAvailable
  try {
    const proc = Bun.spawn(["gitleaks", "version"], { stdout: "pipe", stderr: "pipe" })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => { proc.kill(); reject(new Error("timeout")) }, GITLEAKS_VERSION_TIMEOUT_MS)
    )
    await Promise.race([proc.exited, timeout])
    gitleaksAvailable = true
  } catch {
    gitleaksAvailable = false
    log("[secret-leak-guard] gitleaks not found in PATH — secret scanning disabled")
  }
  return gitleaksAvailable
}

async function runGitleaksWithArgs(args: string[], cwd: string): Promise<GitleaksResult> {
  if (!await checkGitleaksAvailable()) {
    return { available: false, findings: [] }
  }
  try {
    const proc = Bun.spawn(["gitleaks", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => { proc.kill(); reject(new Error("timeout")) }, GITLEAKS_SCAN_TIMEOUT_MS)
    )
    const exitCode = await Promise.race([proc.exited, timeout])
    if (exitCode === 0) {
      return { available: true, findings: [] }
    }
    const stdout = await new Response(proc.stdout).text()
    return parseGitleaksOutput(stdout, "")
  } catch {
    return { available: true, findings: [], error: "gitleaks timed out or failed to start" }
  }
}

export async function runGitleaksStagedScan(cwd: string): Promise<GitleaksResult> {
  return runGitleaksWithArgs(
    ["detect", "--staged", "--report-format", "json", "--no-banner", "--exit-code", "0"],
    cwd,
  )
}

export async function runGitleaksPrePushScan(cwd: string, remoteBranch: string): Promise<GitleaksResult> {
  return runGitleaksWithArgs(
    ["detect", "--log-opts", `${remoteBranch}..HEAD`, "--report-format", "json", "--no-banner", "--exit-code", "0"],
    cwd,
  )
}

function parseGitleaksOutput(stdout: string, stderr: string): GitleaksResult {
  try {
    const findings = JSON.parse(stdout) as GitleaksFinding[]
    if (Array.isArray(findings) && findings.length > 0) {
      return { available: true, findings }
    }
  } catch {
  }
  return { available: true, findings: [], error: stderr || "gitleaks exited with non-zero status" }
}
