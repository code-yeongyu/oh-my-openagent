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
    const binaryPath = Bun.which(binary)
    return { exists: Boolean(binaryPath), path: binaryPath ?? null }
  } catch {
    return { exists: false, path: null }
  }
}

async function getGhVersion(): Promise<string | null> {
  try {
    const processResult = Bun.spawn(["gh", "--version"], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(processResult.stdout).text()
    await processResult.exited
    if (processResult.exitCode !== 0) return null

    const matchedVersion = output.match(/gh version (\S+)/)
    return matchedVersion?.[1] ?? output.trim().split("\n")[0] ?? null
  } catch {
    return null
  }
}

async function getGhAuthStatus(): Promise<{
  authenticated: boolean
  username: string | null
  scopes: string[]
  error: string | null
}> {
  try {
    const processResult = Bun.spawn(["gh", "auth", "status"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GH_NO_UPDATE_NOTIFIER: "1" },
    })

    const stdout = await new Response(processResult.stdout).text()
    const stderr = await new Response(processResult.stderr).text()
    await processResult.exited

    const output = stderr || stdout
    if (processResult.exitCode === 0) {
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

export async function getGhCliInfo(): Promise<GhCliInfo> {
  const binaryStatus = await checkBinaryExists("gh")
  if (!binaryStatus.exists) {
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
    path: binaryStatus.path,
    authenticated: authStatus.authenticated,
    username: authStatus.username,
    scopes: authStatus.scopes,
    error: authStatus.error,
  }
}
