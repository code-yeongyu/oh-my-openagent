import type { OpenCodeBinaryType } from "../../shared/opencode-config-dir-types"
import { initConfigContext } from "./config-context"

const OPENCODE_BINARIES = ["opencode", "opencode-desktop"] as const

interface OpenCodeBinaryResult {
  binary: OpenCodeBinaryType
  version: string
}

async function findOpenCodeBinaryWithVersion(): Promise<OpenCodeBinaryResult | null> {
  for (const binary of OPENCODE_BINARIES) {
    try {
      const proc = Bun.spawn([binary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(proc.stdout).text()
      await proc.exited
      if (proc.exitCode === 0) {
        const version = output.trim()
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
