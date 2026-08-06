import { spawnWithTimeout } from "../framework/spawn-with-timeout"
import { bunWhich } from "../../../shared/bun-which-shim"

export interface GhCliInfo {
  installed: boolean
  version: string | null
  path: string | null
  authenticated: boolean
  username: string | null
  scopes: string[]
  error: string | null
}

type GhCliDependencies = {
  readonly which?: typeof bunWhich
  readonly spawn?: typeof spawnWithTimeout
}

async function checkBinaryExists(binary: string, which: typeof bunWhich): Promise<{ exists: boolean; path: string | null }> {
  try {
    const binaryPath = which(binary)
    return { exists: Boolean(binaryPath), path: binaryPath ?? null }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return { exists: false, path: null }
  }
}

async function getGhVersion(spawn: typeof spawnWithTimeout): Promise<string | null> {
  try {
    const result = await spawn(["gh", "--version"], { stdout: "pipe", stderr: "pipe" })
    if (result.timedOut || result.exitCode !== 0) return null

    const matchedVersion = result.stdout.match(/gh version (\S+)/)
    return matchedVersion?.[1] ?? result.stdout.trim().split("\n")[0] ?? null
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
}

async function getGhAuthStatus(spawn: typeof spawnWithTimeout): Promise<{
  authenticated: boolean
  username: string | null
  scopes: string[]
  error: string | null
}> {
  try {
    const result = await spawn(
      ["gh", "auth", "status"],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" } }
    )

    if (result.timedOut) {
      return { authenticated: false, username: null, scopes: [], error: "gh auth status timed out" }
    }

    const output = result.stderr || result.stdout
    if (result.exitCode === 0) {
      const usernameMatch = output.match(/Logged in to github\.com account (\S+)/)
      const scopesMatch = output.match(/Token scopes?:\s*(.+)/i)

      return {
        authenticated: true,
        username: usernameMatch?.[1]?.replace(/[()]/g, "") ?? null,
        scopes: scopesMatch?.[1]?.split(/,\s*/).map((scope) => scope.trim()).filter(Boolean) ?? [],
        error: null,
      }
    }

    const errorMatch = output.match(/error[:\s]+(.+)/i)
    return {
      authenticated: false,
      username: null,
      scopes: [],
      error: errorMatch?.[1]?.trim() ?? "Not authenticated",
    }
  } catch (error) {
    return {
      authenticated: false,
      username: null,
      scopes: [],
      error: error instanceof Error ? error.message : "Failed to check auth status",
    }
  }
}

export async function getGhCliInfo(dependencies: GhCliDependencies = {}): Promise<GhCliInfo> {
  const which = dependencies.which ?? bunWhich
  const spawn = dependencies.spawn ?? spawnWithTimeout
  const binaryStatus = await checkBinaryExists("gh", which)
  if (!binaryStatus.exists) {
    const version = await getGhVersion(spawn)
    if (version) {
      const authStatus = await getGhAuthStatus(spawn)
      return {
        installed: true,
        version,
        path: null,
        authenticated: authStatus.authenticated,
        username: authStatus.username,
        scopes: authStatus.scopes,
        error: authStatus.error,
      }
    }

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

  const [version, authStatus] = await Promise.all([getGhVersion(spawn), getGhAuthStatus(spawn)])
  return {
    installed: true,
    version,
    path: binaryStatus.path,
    authenticated: authStatus.authenticated,
    username: authStatus.username,
    scopes: authStatus.scopes,
    error: authStatus.error,
  }
}
