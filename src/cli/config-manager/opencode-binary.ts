import type { OpenCodeBinaryType } from "../../shared/opencode-config-dir-types"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { initConfigContext } from "./config-context"

const OPENCODE_BINARIES = ["opencode", "opencode-desktop"] as const
const SEMVER_PATTERN = /\b\d+\.\d+\.\d+\b/

interface OpenCodeBinaryResult {
  binary: OpenCodeBinaryType
  version: string
}

function extractSemver(output: string): string | null {
  const match = output.match(SEMVER_PATTERN)
  return match ? match[0] : null
}

async function findOpenCodeBinaryWithVersion(): Promise<OpenCodeBinaryResult | null> {
  for (const binary of OPENCODE_BINARIES) {
    try {
      const proc = spawnWithWindowsHide([binary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(proc.stdout).text()
      await proc.exited
      if (proc.exitCode !== 0) continue
      const version = extractSemver(output)
      if (!version) continue
      initConfigContext(binary, version)
      return { binary, version }
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
