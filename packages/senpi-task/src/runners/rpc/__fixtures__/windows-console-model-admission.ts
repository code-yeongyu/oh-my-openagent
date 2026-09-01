import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { createRpcModelAdmission } from "../model-admission"
import type { ProbeMode } from "./windows-console-probe-state"

const FAKE_MODEL_CATALOG_PATH = fileURLToPath(
  new URL("./fake-model-catalog.mjs", import.meta.url),
)

type WindowsModelAdmissionProbeOptions = {
  readonly mode: ProbeMode
  readonly root: string
  readonly waitForFile: (path: string, signal: AbortSignal) => Promise<void>
  readonly mainWindowHandle: (pid: number) => number
}

export function createWindowsModelAdmissionProbe(options: WindowsModelAdmissionProbeOptions) {
  const pidPath = join(options.root, `${options.mode}-catalog-pid.txt`)
  const releasePath = join(options.root, `${options.mode}-catalog-release`)
  const inspection = (async () => {
    await options.waitForFile(pidPath, AbortSignal.timeout(15_000))
    const pid = Number.parseInt(readFileSync(pidPath, "utf8"), 10)
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`invalid catalog probe PID: ${String(pid)}`)
    }
    try {
      return {
        pid,
        mainWindowHandle: options.mainWindowHandle(pid),
      }
    } finally {
      writeFileSync(releasePath, "release\n")
    }
  })()
  const modelAdmission = createRpcModelAdmission({
    buildSpawn: (spec) => ({
      command: process.execPath,
      args: [FAKE_MODEL_CATALOG_PATH, pidPath, releasePath],
      cwd: spec.cwd,
      env: process.env,
    }),
  })
  return { inspection, modelAdmission }
}
