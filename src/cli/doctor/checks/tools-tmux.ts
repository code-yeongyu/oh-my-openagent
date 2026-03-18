import { spawnWithWindowsHide } from "../../../shared/spawn-with-windows-hide"

export interface TmuxInfo {
  installed: boolean
  version: string | null
  path: string | null
}

async function checkBinaryExists(binary: string): Promise<{ exists: boolean; path: string | null }> {
  try {
    const binaryPath = Bun.which(binary)
    return { exists: Boolean(binaryPath), path: binaryPath ?? null }
  } catch {
    return { exists: false, path: null }
  }
}

async function getTmuxVersion(): Promise<string | null> {
  try {
    const processResult = spawnWithWindowsHide(["tmux", "-V"], { stdout: "pipe", stderr: "pipe" })
    const output = await new Response(processResult.stdout).text()
    await processResult.exited
    if (processResult.exitCode !== 0) return null

    // e.g., tmux 3.3a -> 3.3a
    const matchedVersion = output.match(/tmux (\S+)/i)
    return matchedVersion?.[1] ?? output.trim().split("\n")[0] ?? null
  } catch {
    return null
  }
}

export async function getTmuxInfo(): Promise<TmuxInfo> {
  const binaryStatus = await checkBinaryExists("tmux")
  if (!binaryStatus.exists) {
    return {
      installed: false,
      version: null,
      path: null,
    }
  }

  const version = await getTmuxVersion()
  return {
    installed: true,
    version,
    path: binaryStatus.path,
  }
}
