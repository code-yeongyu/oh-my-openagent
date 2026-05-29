import { spawnWithTimeout } from "../spawn-with-timeout"

export interface PlannotatorInfo {
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

async function getPlannotatorVersion(): Promise<string | null> {
  try {
    const result = await spawnWithTimeout(["plannotator", "--version"], { stdout: "pipe", stderr: "pipe" })
    if (result.timedOut || result.exitCode !== 0) return null

    const matchedVersion = result.stdout.match(/plannotator version (\S+)/i) || result.stdout.match(/(\d+\.\d+\.\d+)/)
    return matchedVersion?.[1] ?? result.stdout.trim().split("\n")[0] ?? null
  } catch {
    return null
  }
}

export async function getPlannotatorInfo(): Promise<PlannotatorInfo> {
  const binaryStatus = await checkBinaryExists("plannotator")
  if (!binaryStatus.exists) {
    const version = await getPlannotatorVersion()
    if (version) {
      return {
        installed: true,
        version,
        path: null,
      }
    }

    return {
      installed: false,
      version: null,
      path: null,
    }
  }

  const version = await getPlannotatorVersion()
  return {
    installed: true,
    version,
    path: binaryStatus.path,
  }
}
