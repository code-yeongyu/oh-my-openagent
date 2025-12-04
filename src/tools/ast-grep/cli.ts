import { spawn } from "bun"
import { SG_CLI_PATH } from "./constants"
import type { CliMatch, CliLanguage } from "./types"

export interface RunOptions {
  pattern: string
  lang: CliLanguage
  paths?: string[]
  globs?: string[]
  rewrite?: string
  context?: number
  updateAll?: boolean
}

export async function runSg(options: RunOptions): Promise<CliMatch[]> {
  const args = ["run", "-p", options.pattern, "--lang", options.lang, "--json=compact"]

  if (options.rewrite) {
    args.push("-r", options.rewrite)
    if (options.updateAll) {
      args.push("--update-all")
    }
  }

  if (options.context && options.context > 0) {
    args.push("-C", String(options.context))
  }

  if (options.globs) {
    for (const glob of options.globs) {
      args.push("--globs", glob)
    }
  }

  const paths = options.paths && options.paths.length > 0 ? options.paths : ["."]
  args.push(...paths)

  const proc = spawn([SG_CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0 && stdout.trim() === "") {
    if (stderr.includes("No files found")) {
      return []
    }
    if (stderr.trim()) {
      throw new Error(stderr.trim())
    }
    return []
  }

  if (!stdout.trim()) {
    return []
  }

  try {
    return JSON.parse(stdout) as CliMatch[]
  } catch {
    return []
  }
}
