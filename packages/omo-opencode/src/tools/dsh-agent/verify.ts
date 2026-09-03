import { spawn } from "node:child_process"

export type VerificationInput = {
  readonly cwd: string
  readonly command: string
  readonly timeoutMs: number
  readonly abort: AbortSignal
}

export type VerificationResult = {
  readonly verified: boolean
  readonly evidence: string
}

/**
 * Run a deterministic verification gate (e.g. "bun test", "bun run typecheck")
 * in the working directory. Exit code 0 means verified; any other outcome
 * returns the captured evidence for the caller to inspect.
 */
export async function runVerificationGate(input: VerificationInput): Promise<VerificationResult> {
  const child = spawn(input.command, {
    cwd: input.cwd,
    env: process.env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: process.platform === "win32",
  })

  return new Promise<VerificationResult>((resolve, reject) => {
    let settled = false
    let stdout = ""
    let stderr = ""

    const finish = (verified: boolean, evidence: string) => {
      if (settled) return
      settled = true
      resolve({ verified, evidence })
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const timeout = setTimeout(() => {
      try {
        child.kill("SIGTERM")
      } catch {
        // reaping races are tolerated
      }
      fail(new Error(`verification gate exceeded ${input.timeoutMs}ms`))
    }, input.timeoutMs)

    const onAbort = () => {
      try {
        child.kill("SIGTERM")
      } catch {
        // reaping races are tolerated
      }
      fail(new Error("verification gate aborted"))
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
      clearTimeout(timeout)
      input.abort.removeEventListener("abort", onAbort)
      fail(error)
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      input.abort.removeEventListener("abort", onAbort)
      if (settled) return
      const evidence = `${stdout}${stderr}`.trim()
      finish(code === 0, evidence)
    })
  })
}
