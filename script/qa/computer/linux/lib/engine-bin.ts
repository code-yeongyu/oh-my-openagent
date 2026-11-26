// Locates the debug engine binary the scenarios drive, building it once per run. `--engine`
// on the driver's own command line names a binary instead and nothing is built.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url))

function targetDir(): string {
  const fromEnv = process.env.CARGO_TARGET_DIR
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv
  const asked = spawnSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
    encoding: "utf8",
  })
  if (asked.status === 0) {
    const workspace = JSON.parse(asked.stdout) as { target_directory?: string }
    if (workspace.target_directory !== undefined) return workspace.target_directory
  }
  return join(REPO_ROOT, "target")
}

/** Builds the engine once and returns the path of its debug binary. */
export function engineBinary(explicit: string | undefined): string {
  if (explicit !== undefined) return explicit
  const built = spawnSync("cargo", ["build", "-p", "omo-computer-engine", "--locked"], {
    stdio: "inherit",
  })
  if (built.status !== 0) throw new Error("cargo build -p omo-computer-engine --locked failed")
  const binary = join(targetDir(), "debug", "omo-computer-engine")
  if (!existsSync(binary)) throw new Error(`the engine binary is not at ${binary}`)
  return binary
}
