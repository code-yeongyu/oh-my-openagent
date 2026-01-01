import type { CheckResult, CheckDefinition } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"

export interface GhCliInfo {
  installed: boolean
  version: string | null
  path: string | null
  authenticated: boolean
  username: string | null
  scopes: string[]
  error: string | null
}

async function checkBinaryExists(binary: string): Promise<{ exists: boolean; path: string | null }> {
  try {
    const proc = Bun.spawn(["which", binary], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode === 0) {
      return { exists: true, path: output.trim() }
    }
  } catch {
    // intentionally empty - binary not found
  }
  return { exists: false, path: null }
}

async function getGhVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["gh", "--version"], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode === 0) {
      const match = output.match(/gh version (\S+)/)
      return match?.[1] ?? output.trim().split("\n")[0]
    }
  } catch {
    // intentionally empty - version unavailable
  }
  return null
}

async function getGhAuthStatus(): Promise<{
  authenticated: boolean
  username: string | null
  scopes: string[]
  error: string | null
}> {
  try {
    const proc = Bun.spawn(["gh", "auth", "status"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    await proc.exited

    const output = stderr || stdout

    if (proc.exitCode === 0) {
      const usernameMatch = output.match(/Logged in to github\.com account (\S+)/)
      const username = usernameMatch?.[1]?.replace(/[()]/g, "") ?? null

      const scopesMatch = output.match(/Token scopes?:\s*(.+)/i)
      const scopes = scopesMatch?.[1]
        ? scopesMatch[1]
            .split(/,\s*/)
            .map((s) => s.replace(/['"]/g, "").trim())
            .filter(Boolean)
        : []

      return { authenticated: true, username, scopes, error: null }
    }

    const errorMatch = output.match(/error[:\s]+(.+)/i)
    return {
      authenticated: false,
      username: null,
      scopes: [],
      error: errorMatch?.[1]?.trim() ?? "Not authenticated",
    }
  } catch (err) {
    return {
      authenticated: false,
      username: null,
      scopes: [],
      error: err instanceof Error ? err.message : "Failed to check auth status",
    }
  }
}

export async function getGhCliInfo(): Promise<GhCliInfo> {
  const binaryCheck = await checkBinaryExists("gh")

  if (!binaryCheck.exists) {
    return {
      installed: false,
      version: null,
      path: null,
      authenticated: false,
      username: null,
      scopes: [],
      error: null,
    }
  }

  const [version, authStatus] = await Promise.all([getGhVersion(), getGhAuthStatus()])

  return {
    installed: true,
    version,
    path: binaryCheck.path,
    authenticated: authStatus.authenticated,
    username: authStatus.username,
    scopes: authStatus.scopes,
    error: authStatus.error,
  }
}

export async function checkGhCli(): Promise<CheckResult> {
  const info = await getGhCliInfo()
  const name = CHECK_NAMES[CHECK_IDS.GH_CLI]

  if (!info.installed) {
    return {
      name,
      status: "warn",
      message: "Not installed (optional)",
      details: [
        "GitHub CLI is used by librarian agent and scripts",
        "Install: https://cli.github.com/",
      ],
    }
  }

  if (!info.authenticated) {
    return {
      name,
      status: "warn",
      message: `${info.version ?? "installed"} - not authenticated`,
      details: [
        info.path ? `Path: ${info.path}` : null,
        "Authenticate: gh auth login",
        info.error ? `Error: ${info.error}` : null,
      ].filter((d): d is string => d !== null),
    }
  }

  const details: string[] = []
  if (info.path) details.push(`Path: ${info.path}`)
  if (info.username) details.push(`Account: ${info.username}`)
  if (info.scopes.length > 0) details.push(`Scopes: ${info.scopes.join(", ")}`)

  return {
    name,
    status: "pass",
    message: `${info.version ?? "installed"} - authenticated as ${info.username ?? "unknown"}`,
    details: details.length > 0 ? details : undefined,
  }
}

export function getGhCliCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.GH_CLI,
    name: CHECK_NAMES[CHECK_IDS.GH_CLI],
    category: "tools",
    check: checkGhCli,
    critical: false,
  }
}
