import { extractSemverFromOutput } from "../../shared/extract-semver"
import type { OpenCodeBinaryType } from "../../shared/opencode-config-dir-types"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { initConfigContext } from "./config-context"

const OPENCODE_BINARIES = ["opencode", "opencode-desktop"] as const
const OPENCODE_VERSION_CHECK_TIMEOUT_MS = 1500
const OPENCODE_VERSION_KILL_GRACE_MS = 200

interface OpenCodeBinaryResult {
  binary: OpenCodeBinaryType
  version: string
}

async function findOpenCodeBinaryWithVersion(): Promise<OpenCodeBinaryResult | null> {
  for (const binary of OPENCODE_BINARIES) {
    try {
      const proc = spawnWithWindowsHide([binary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const outputPromise = new Response(proc.stdout).text()
      let killTimer: ReturnType<typeof setTimeout> | null = null
      const timedExitCode = await Promise.race([
        proc.exited,
        new Promise<number>((resolve) => {
          killTimer = setTimeout(() => {
            proc.kill("SIGTERM")
            setTimeout(() => {
              proc.kill("SIGKILL")
            }, OPENCODE_VERSION_KILL_GRACE_MS)
            resolve(1)
          }, OPENCODE_VERSION_CHECK_TIMEOUT_MS)
        }),
      ])

      if (killTimer) {
        clearTimeout(killTimer)
      }

      const output = await Promise.race([
        outputPromise,
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve("")
          }, OPENCODE_VERSION_KILL_GRACE_MS)
        }),
      ])

      if (timedExitCode === 0 && proc.exitCode === 0) {
        const version = extractSemverFromOutput(output) ?? output.trim()
        initConfigContext(binary, version)
        return { binary, version }
      }
    } catch {
      continue
    }
  }
  return null
}

export async function isOpenCodeInstalled(): Promise<boolean> {
  const result = await findOpenCodeBinaryWithVersion()
  return result !== null
}

export async function getOpenCodeVersion(): Promise<string | null> {
  const result = await findOpenCodeBinaryWithVersion()
  return result?.version ?? null
}
