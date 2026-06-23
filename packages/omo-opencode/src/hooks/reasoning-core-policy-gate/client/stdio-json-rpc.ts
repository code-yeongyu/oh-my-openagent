import type { ChildProcessByStdio } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { createInterface } from "node:readline"
import { ReasoningCoreInfrastructureError } from "./infrastructure-error"
import { isRecord, tryParseJson } from "./mcp-payload-extractor"

type SpawnedChild = ChildProcessByStdio<Writable, Readable, Readable>

export function sendJsonRpcOverStdio(
  child: SpawnedChild,
  message: object,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: child.stdout })
    const timeout = setTimeout(() => {
      cleanup()
      reject(new ReasoningCoreInfrastructureError("timeout", `reasoning-core timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const onError = (error: Error) => {
      cleanup()
      reject(new ReasoningCoreInfrastructureError("spawn", error.message, error))
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(
        new ReasoningCoreInfrastructureError(
          "spawn",
          `reasoning-core exited before responding (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        ),
      )
    }

    const onLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return

      const parsed = tryParseJson(trimmed)
      if (!parsed || !isRecord(parsed)) {
        cleanup()
        reject(new ReasoningCoreInfrastructureError("invalid_json", `reasoning-core returned invalid JSON: ${trimmed}`))
        return
      }

      if (typeof parsed.id !== "number") {
        return
      }

      cleanup()
      resolve(parsed)
    }

    function cleanup(): void {
      clearTimeout(timeout)
      rl.off("line", onLine)
      child.off("error", onError)
      child.off("exit", onExit)
      rl.close()
    }

    rl.on("line", onLine)
    child.once("error", onError)
    child.once("exit", onExit)

    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) {
        cleanup()
        reject(new ReasoningCoreInfrastructureError("spawn", error.message, error))
      }
    })
  })
}
