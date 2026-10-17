import { spawn } from "node:child_process"

export type DshHeadlessRunInput = {
  readonly command: string
  readonly args: string[]
  readonly cwd: string
  readonly prompt: string
  readonly timeoutMs: number
  readonly abort: AbortSignal
  readonly env?: Record<string, string | undefined>
}

export type DshHeadlessRunResult = {
  readonly output: string
  readonly exitCode: number | null
}

/**
 * Drive one DeepSeek Harness agent through the published headless profile:
 * spawn `dsh --profile headless <task>`, capture the final assistant message,
 * and settle on process exit. This is the npm-published one-shot entry
 * (`@deepseek-ai/dsh`); the ACP protocol server is the source-composition
 * alternative handled by runDshAcpAgent.
 */
export async function runDshHeadless(input: DshHeadlessRunInput): Promise<DshHeadlessRunResult> {
  const child = spawn(input.command, [...input.args, "--profile", "headless", input.prompt], {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: process.platform === "win32",
  })

  return new Promise<DshHeadlessRunResult>((resolve, reject) => {
    let settled = false
    let stdout = ""
    let stderr = ""
    let childError: Error | undefined

    const finish = (result: DshHeadlessRunResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const disposeChild = () => {
      if (!child.killed) {
        try {
          child.kill("SIGTERM")
        } catch {
          // reaping races are tolerated
        }
      }
    }

    const timeout = setTimeout(() => {
      disposeChild()
      fail(new Error(`dsh headless run exceeded ${input.timeoutMs}ms`))
    }, input.timeoutMs)

    const onAbort = () => {
      disposeChild()
      fail(new Error("dsh headless run aborted"))
    }
    if (input.abort.aborted) {
      onAbort()
      return
    }
    input.abort.addEventListener("abort", onAbort, { once: true })

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString("utf8")
    })
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString("utf8")
    })
    child.on("error", (error) => {
      childError = error
      clearTimeout(timeout)
      fail(error)
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      input.abort.removeEventListener("abort", onAbort)
      if (settled) return
      if (code !== 0 && code !== null) {
        fail(childError ?? new Error(stderr.trim() || `dsh headless exited with code ${code}`))
        return
      }
      finish({ output: `${stdout}${stderr}`.trim(), exitCode: code })
    })
  })
}
