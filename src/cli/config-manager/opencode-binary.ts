import { extractSemverFromOutput } from "../../shared/extract-semver"
import type { OpenCodeBinaryType } from "../../shared/opencode-config-dir-types"
import { gracefulTerminate } from "../../shared/signals"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { initConfigContext } from "./config-context"

const OPENCODE_BINARIES = ["opencode", "opencode-desktop"] as const
const OPENCODE_VERSION_CHECK_TIMEOUT_MS = 1500
const OPENCODE_VERSION_KILL_GRACE_MS = 200
const OPENCODE_OUTPUT_WAIT_TIMEOUT_MS = 200

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
      const timedExitResult = await Promise.race([
        proc.exited.then((exitCode) => ({ type: "exit" as const, exitCode })),
        new Promise<{ type: "timeout" }>((resolve) => {
          killTimer = setTimeout(() => {
            gracefulTerminate(proc, { gracePeriodMs: OPENCODE_VERSION_KILL_GRACE_MS })
            resolve({ type: "timeout" })
          }, OPENCODE_VERSION_CHECK_TIMEOUT_MS)
        }),
      ])

      if (killTimer) {
        clearTimeout(killTimer)
      }

      if (timedExitResult.type === "timeout") {
        void outputPromise.catch(() => {})
        continue
      }

      let outputTimer: ReturnType<typeof setTimeout> | null = null
      const outputResult = await Promise.race([
        outputPromise.then((output) => ({ type: "output" as const, output })),
        new Promise<{ type: "timeout" }>((resolve) => {
          outputTimer = setTimeout(() => {
            resolve({ type: "timeout" })
          }, OPENCODE_OUTPUT_WAIT_TIMEOUT_MS)
        }),
      ]).catch(() => ({ type: "timeout" as const }))

      if (outputTimer) {
        clearTimeout(outputTimer)
      }

      if (outputResult.type !== "output") {
        continue
      }

      if (timedExitResult.exitCode === 0 && proc.exitCode === 0) {
        const output = outputResult.output
        const version = extractSemverFromOutput(output) ?? output.trim()
        if (version.length === 0) {
          continue
        }

        initConfigContext(binary, version)
        return { binary, version }
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error
      }

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
