import { spawn } from "@oh-my-opencode/utils/runtime"

type RunHerdrOptions = {
  retry?: number
  timeoutMs?: number
}

export type HerdrCommandResult = {
  success: boolean
  output: string
  stdout: string
  stderr: string
  exitCode: number
}

const TERMINAL_HERDR_ERROR_PATTERN = /(?:pane|workspace|tab) (?:not found|does not exist)|server_not_running/i

function createHerdrCommandResult(stdout: string, stderr: string, exitCode: number): HerdrCommandResult {
  return {
    success: exitCode === 0,
    output: stdout,
    stdout,
    stderr,
    exitCode,
  }
}

function isTerminalHerdrError(stderr: string): boolean {
  return TERMINAL_HERDR_ERROR_PATTERN.test(stderr)
}

async function runHerdrCommandOnce(herdrPath: string, args: Array<string>, timeoutMs?: number): Promise<HerdrCommandResult> {
  const abortController = new AbortController()
  const subprocess = spawn([herdrPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    signal: abortController.signal,
  })
  const stdoutPromise = new Response(subprocess.stdout).text()
  const stderrPromise = new Response(subprocess.stderr).text()

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    const exitCodeOrTimeout = timeoutMs === undefined
      ? await subprocess.exited
      : await Promise.race<number | "timeout">(([
          subprocess.exited,
          new Promise<"timeout">((resolve) => {
            timeoutId = setTimeout(() => {
              abortController.abort()
              resolve("timeout")
            }, timeoutMs)
          }),
        ]))

    if (exitCodeOrTimeout === "timeout") {
      void subprocess.exited.catch(() => undefined)
      void stdoutPromise.catch(() => "")
      void stderrPromise.catch(() => "")
      return createHerdrCommandResult("", "timeout", -1)
    }

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    return createHerdrCommandResult(stdout.trim(), stderr.trim(), exitCodeOrTimeout)
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

export async function runHerdrCommand(herdrPath: string, args: string[], options: RunHerdrOptions = {}): Promise<HerdrCommandResult> {
  const retryCount = Math.max(0, options.retry ?? 0)
  let lastResult = createHerdrCommandResult("", "", 1)

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const result = await runHerdrCommandOnce(herdrPath, args, options.timeoutMs)
    lastResult = result

    if (result.exitCode === 0) {
      return result
    }

    if (attempt === retryCount || isTerminalHerdrError(result.stderr)) {
      return result
    }
  }

  return lastResult
}
