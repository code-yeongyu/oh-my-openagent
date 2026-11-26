// Surface (a)'s process: the run starts drivers/sdk.ts as its own bun script with device A's environment and the path
// of the public SDK entry, and exchanges one JSON line per scenario call with it, matched by id.
import { spawn } from "node:child_process"
import { join } from "node:path"
import { createInterface } from "node:readline"

import { withTelemetryOptOut } from "../../../../packages/omo-senpi/scripts/qa/telemetry-opt-out-env.mjs"
import { type Answer, type Call, type Driver, isRecord, succeeded, threadOf } from "../drivers/driver.ts"
import { MAPPING } from "../drivers/sdk.ts"

const SCRIPT = join(import.meta.dir, "..", "drivers", "sdk.ts")
const CLOSE_GRACE_MS = 10_000

export function startSdkDriver(options: {
  readonly entry: string
  readonly env: Record<string, string>
  readonly cwd: string
}): Driver {
  const child = spawn(process.execPath, [SCRIPT, options.entry], {
    cwd: options.cwd,
    env: withTelemetryOptOut(options.env),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  let stderr = ""
  child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-4000)))
  const pending = new Map<number, (raw: unknown) => void>()
  createInterface({ input: child.stdout }).on("line", (line) => {
    const reply: unknown = JSON.parse(line)
    if (!isRecord(reply) || typeof reply["id"] !== "number") return
    pending.get(reply["id"])?.(reply["raw"])
    pending.delete(reply["id"])
  })
  // Settles once the script is gone, whether it exited or was killed (a killed child keeps exitCode null).
  const ended = new Promise<"ended">((resolve) => child.once("close", () => resolve("ended")))
  child.once("close", (code) => {
    for (const settle of pending.values()) settle({ exited: code, stderr })
    pending.clear()
  })
  let next = 0
  return {
    mapping: MAPPING,
    // The script has one call at a time in flight; a call past its deadline stops the script (the surface is not reached
    // again), and the pending call settles through the close handler.
    run: async ({ op, input }: Call, signal?: AbortSignal): Promise<Answer> => {
      next += 1
      const id = next
      const raw = await new Promise<unknown>((resolve) => {
        pending.set(id, resolve)
        signal?.addEventListener("abort", () => child.kill("SIGKILL"), { once: true })
        child.stdin.write(`${JSON.stringify({ id, op, input })}\n`)
      })
      const thread = threadOf(raw)
      const mapping = MAPPING[op]
      return {
        call: `${mapping.kind === "call" ? mapping.how : op} ${JSON.stringify(input)}`,
        raw,
        answered: succeeded(raw) && !(isRecord(raw) && ("thrown" in raw || "exited" in raw)),
        ...(thread === undefined ? {} : { thread }),
      }
    },
    // Bounded: a call that never settled keeps the script alive, so it is stopped after CLOSE_GRACE_MS.
    close: async () => {
      child.stdin.end()
      let timer: ReturnType<typeof setTimeout> | undefined
      const grace = new Promise<"grace">((resolve) => {
        timer = setTimeout(() => resolve("grace"), CLOSE_GRACE_MS)
      })
      const outcome = await Promise.race([ended, grace]).finally(() => clearTimeout(timer))
      if (outcome === "grace") {
        child.kill("SIGKILL")
        await ended
      }
    },
  }
}
