import { join } from "node:path"

import type { RunCommand } from "./types"

export async function seedAndMigrateOmoSot(input: {
  readonly env: { readonly [key: string]: string | undefined }
  readonly log: (message: string) => void
  readonly repoRoot: string
  readonly runCommand: RunCommand
}): Promise<void> {
  const commandEnv: NodeJS.ProcessEnv = { ...input.env }
  const scriptPath = join(input.repoRoot, "packages", "omo-codex", "plugin", "scripts", "migrate-omo-sot.mjs")
  try {
    await input.runCommand(process.execPath, [scriptPath, "--seed"], {
      cwd: input.repoRoot,
      env: commandEnv,
    })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    input.log(`Warning: skipped OMO SOT seed/migration: ${error.message}`)
  }
}
