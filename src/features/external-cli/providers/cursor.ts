import { spawn } from "node:child_process"
import type {
  ExternalCliProviderInterface,
  ExternalCliExecuteOptions,
  ExternalCliExecuteResult,
  CursorAgentResponse,
} from "../types"
import { log } from "../../../shared/logger"

const DEFAULT_TIMEOUT = 300000

export class CursorProvider implements ExternalCliProviderInterface {
  readonly name = "cursor" as const

  async execute(options: ExternalCliExecuteOptions): Promise<ExternalCliExecuteResult> {
    const { model, prompt, workspace, timeout = DEFAULT_TIMEOUT } = options

    const args = [
      "agent",
      "-p",
      "--model", model,
      "--output-format", "json",
    ]

    if (workspace) {
      args.push("--workspace", workspace)
    }

    args.push(prompt)

    log("[external-cli:cursor] Executing:", { model, promptLength: prompt.length })

    return new Promise((resolve) => {
      let stdout = ""
      let stderr = ""
      let timedOut = false

      const proc = spawn("cursor", args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout,
      })

      const timeoutId = setTimeout(() => {
        timedOut = true
        proc.kill("SIGTERM")
      }, timeout)

      proc.stdout.on("data", (data) => {
        stdout += data.toString()
      })

      proc.stderr.on("data", (data) => {
        stderr += data.toString()
      })

      proc.on("close", (code) => {
        clearTimeout(timeoutId)

        if (timedOut) {
          resolve({
            success: false,
            result: "",
            error: `Command timed out after ${timeout}ms`,
          })
          return
        }

        if (code !== 0) {
          log("[external-cli:cursor] Command failed:", { code, stderr })
          resolve({
            success: false,
            result: "",
            error: stderr || `Process exited with code ${code}`,
          })
          return
        }

        try {
          const response = JSON.parse(stdout.trim()) as CursorAgentResponse

          if (response.is_error) {
            resolve({
              success: false,
              result: response.result,
              error: response.result,
              duration_ms: response.duration_ms,
              session_id: response.session_id,
            })
            return
          }

          resolve({
            success: true,
            result: response.result,
            duration_ms: response.duration_ms,
            session_id: response.session_id,
          })
        } catch (parseError) {
          log("[external-cli:cursor] Failed to parse response:", { stdout, parseError })
          resolve({
            success: false,
            result: stdout,
            error: `Failed to parse response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          })
        }
      })

      proc.on("error", (err) => {
        clearTimeout(timeoutId)
        log("[external-cli:cursor] Process error:", err)
        resolve({
          success: false,
          result: "",
          error: `Failed to execute cursor command: ${err.message}`,
        })
      })
    })
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("cursor", ["--version"], {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      })

      proc.on("close", (code) => {
        resolve(code === 0)
      })

      proc.on("error", () => {
        resolve(false)
      })
    })
  }
}
