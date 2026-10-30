import { execFile } from "node:child_process"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: readonly string[]): Promise<void> {
  try {
    await execFileAsync("git", [...args], { cwd })
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : ""
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`)
  }
}

const mode = process.argv[2]
const worktree = process.env.MEMORY_DIR
if (!worktree) throw new Error("MEMORY_DIR is required")
if (!process.env.TRANSCRIPT_PATH) throw new Error("TRANSCRIPT_PATH is required")
if (process.env.SENPI_MEMORY_REFLECTION !== "1") throw new Error("reflection sentinel is required")

if (mode === "commit" || mode === "commit-fail" || mode === "commit-hang" || mode === "commit-late-ok") {
  await mkdir(join(worktree, "system"), { recursive: true })
  await writeFile(
    join(worktree, "system", "reflected.md"),
    "---\ndescription: A fact learned by the reflection stub\n---\nThe reflection stub merged this fact.\n",
  )
  await git(worktree, ["add", "system/reflected.md"])
  await git(worktree, ["commit", "-m", "chore(reflection): add stub memory"])
  if (mode === "commit-fail") {
    console.error("model failed after a partial commit")
    process.exitCode = 1
  } else if (mode === "commit-hang") {
    setInterval(() => undefined, 1_000)
  } else if (mode === "commit-late-ok") {
    // Outlives the deadline, then exits 0 on the termination signal: a clean code, but too late.
    const keepAlive = setInterval(() => undefined, 1_000)
    process.on("SIGTERM", () => {
      clearInterval(keepAlive)
      process.exit(0)
    })
  }
} else if (mode === "noop") {
  process.exitCode = 0
} else if (mode === "admin") {
  await appendFile(join(worktree, ".git"), "# reflection stub touched git administration\n")
} else if (mode === "timeout") {
  process.on("SIGTERM", () => undefined)
  setInterval(() => undefined, 1_000)
} else if (mode === "model-not-found") {
  console.error('Error: Model "extension-only/primary" not found. Use --list-models to see available models.')
  process.exitCode = 1
} else if (mode === "provider-cooldown") {
  console.error('503: {"message":"All providers are temporarily cooling down"}')
  process.exitCode = 1
} else if (mode === "auth-missing") {
  console.error("No API key found for kimi-coding")
  process.exitCode = 1
} else {
  throw new Error(`unknown reflection child mode: ${mode}`)
}
