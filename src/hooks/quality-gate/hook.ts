interface PendingCall {
  filePath: string
  sessionID: string
  timestamp: number
}

const pendingCalls = new Map<string, PendingCall>()
const CLEANUP_INTERVAL_MS = 30_000
const MAX_AGE_MS = 60_000

const LINTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"])

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, call] of pendingCalls) {
      if (now - call.timestamp > MAX_AGE_MS) {
        pendingCalls.delete(key)
      }
    }
  }, CLEANUP_INTERVAL_MS)
}

function isLintableFile(filePath: string): boolean {
  const ext = filePath.lastIndexOf(".")
  if (ext === -1) return false
  return LINTABLE_EXTENSIONS.has(filePath.slice(ext))
}

async function runBiomeCheck(filePath: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["npx", "biome", "check", "--no-errors-on-unmatched", filePath],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: process.cwd(),
      },
    )

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => {
        proc.kill()
        reject(new Error("biome timeout"))
      }, 10_000),
    )

    const result = await Promise.race([
      (async () => {
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        const exitCode = await proc.exited
        return { stdout, stderr, exitCode }
      })(),
      timeout,
    ])

    if (result.exitCode === 0) return null

    const output = result.stdout.trim()
    return output || null
  } catch {
    return null
  }
}

export function createQualityGateHook() {
  startCleanup()

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase()
      if (toolLower !== "write" && toolLower !== "edit" && toolLower !== "multiedit") {
        return
      }

      const filePath = (output.args.filePath ??
        output.args.file_path ??
        output.args.path) as string | undefined

      if (!filePath || !isLintableFile(filePath)) return

      pendingCalls.set(input.callID, {
        filePath,
        sessionID: input.sessionID,
        timestamp: Date.now(),
      })
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: Record<string, unknown> },
    ): Promise<void> => {
      const pending = pendingCalls.get(input.callID)
      if (!pending) return
      pendingCalls.delete(input.callID)

      const outputLower = (output.output ?? "").toLowerCase()
      if (
        outputLower.includes("error:") ||
        outputLower.includes("failed to") ||
        outputLower.startsWith("error")
      ) {
        return
      }

      const lintResult = await runBiomeCheck(pending.filePath)
      if (lintResult) {
        output.output += `\n\n⚠️ **Quality Gate** — lint issues in \`${pending.filePath.split("/").pop()}\`:\n\`\`\`\n${lintResult}\n\`\`\`\nRun \`bun run lint:fix\` to auto-fix, or address manually.`
      }
    },
  }
}
