import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import type { OmoConfigEnv } from "@oh-my-opencode/omo-config-core"
import {
  ENGINE_ABI,
  PROTOCOL_VERSION,
  type DesktopCapabilities,
} from "@oh-my-opencode/senpi-desktop-protocol"
import * as z from "zod"

export type EngineProbe = {
  readonly hello: {
    readonly protocolVersion: string
    readonly engineVersion: string
    readonly buildSha: string
    readonly abi: string
  }
  readonly capabilities: DesktopCapabilities
}

export type EngineProbeResult =
  | { readonly ok: true; readonly value: EngineProbe }
  | {
      readonly ok: false
      readonly code: "abi-mismatch" | "handshake-failed" | "timeout"
      readonly message: string
    }

/** Launchers must create a detached process group on POSIX so timeout cleanup owns the whole tree. */
export type EngineLauncher = (
  enginePath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams

export const COMPUTER_USE_DOCTOR_TIMEOUT_MS = 5_000
const STDERR_TAIL_CHARS = 4_096
const HelloSchema = z.object({
  protocolVersion: z.string(),
  engineVersion: z.string(),
  buildSha: z.string(),
  abi: z.string(),
})
const CapabilitiesSchema = z.object({
  backend: z.string(),
  displayServer: z.string().nullable().optional(),
  capture: z.boolean(),
  input: z.boolean(),
  ax: z.boolean(),
  backgroundWindowInput: z.boolean(),
  deliveryModes: z.array(z.string()),
  capturePermission: z.string(),
  inputPermission: z.string(),
  axPermission: z.string(),
  displayCount: z.number().int().nonnegative(),
  focusGuard: z.boolean(),
  stopPath: z.string(),
  stopReason: z.string().nullable().optional(),
  integrityLevel: z.string().nullable().optional(),
  screenLocked: z.boolean(),
})
const RpcResponseSchema = z.object({
  id: z.union([z.literal(1), z.literal(2)]),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})

function validateProbe(hello: unknown, capabilities: unknown, enginePath: string): EngineProbeResult {
  const parsedHello = HelloSchema.safeParse(hello)
  if (!parsedHello.success) {
    return { ok: false, code: "handshake-failed", message: `malformed engine.hello result at ${enginePath}` }
  }
  if (parsedHello.data.abi !== ENGINE_ABI || parsedHello.data.protocolVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "abi-mismatch",
      message:
        `desktop engine ABI mismatch at ${enginePath}: expected abi ${ENGINE_ABI} protocol ${PROTOCOL_VERSION}, ` +
        `engine reported abi ${parsedHello.data.abi} protocol ${parsedHello.data.protocolVersion}`,
    }
  }
  const parsedCapabilities = CapabilitiesSchema.safeParse(capabilities)
  if (!parsedCapabilities.success) {
    return { ok: false, code: "handshake-failed", message: `malformed capabilities result at ${enginePath}` }
  }
  return { ok: true, value: { hello: parsedHello.data, capabilities: parsedCapabilities.data } }
}

export const launchEngineBinary: EngineLauncher = (enginePath, args, env) =>
  spawn(enginePath, [...args], { stdio: "pipe", windowsHide: true, detached: true, env })

export function probeComputerUseEngine(
  enginePath: string,
  env: OmoConfigEnv,
  timeoutMs: number,
  launch: EngineLauncher = launchEngineBinary,
): Promise<EngineProbeResult> {
  const child = launch(enginePath, ["--stdio"], { ...process.env, ...env })
  return new Promise((resolveProbe) => {
    const replies = new Map<number, unknown>()
    let stderrTail = ""
    // The point a stalled probe reached, so a timeout says where the engine stopped answering (#9720).
    const phase = (): string => {
      if (replies.has(1) && !replies.has(2)) return "engine.hello answered, awaiting capabilities"
      if (replies.has(2) && !replies.has(1)) return "capabilities answered, awaiting engine.hello"
      return "requests sent, awaiting engine.hello and capabilities"
    }
    let settled: EngineProbeResult | undefined
    const settle = (result: EngineProbeResult) => {
      if (settled !== undefined) return
      settled = result
      child.stdin.end()
    }
    const timer = setTimeout(() => {
      const result: EngineProbeResult = settled ?? {
        ok: false, code: "timeout", message: `desktop engine probe timed out after ${timeoutMs} ms at ${enginePath} (phase: ${phase()})`,
      }
      settle(result)
      resolveProbe(result)
      lines.close()
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      child.unref()
      if (child.pid === undefined) return
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
        killer.once("error", () => child.kill("SIGKILL"))
        killer.unref()
      } else {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch (error) {
          // macOS reports EPERM, not ESRCH, for a group whose members exited but are not reaped yet.
          if (!(error instanceof Error) || !("code" in error) || (error.code !== "ESRCH" && error.code !== "EPERM")) throw error
        }
      }
    }, timeoutMs)

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS)
    })
    child.stdin.on("error", (error) => {
      settle({ ok: false, code: "handshake-failed", message: `desktop engine stdin failed at ${enginePath}: ${error.message}` })
    })
    child.on("error", (error) => {
      settle({ ok: false, code: "handshake-failed", message: `desktop engine spawn failed at ${enginePath}: ${error.message}` })
    })
    const lines = createInterface({ input: child.stdout }).on("line", (line) => {
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        settle({ ok: false, code: "handshake-failed", message: `desktop engine emitted non-JSON output at ${enginePath}` })
        return
      }
      const parsed = RpcResponseSchema.safeParse(value)
      if (!parsed.success) return
      if (parsed.data.error !== undefined) {
        settle({
          ok: false,
          code: "handshake-failed",
          message: `desktop engine request ${parsed.data.id} failed at ${enginePath}: ${JSON.stringify(parsed.data.error)}`,
        })
        return
      }
      replies.set(parsed.data.id, parsed.data.result)
      if (replies.has(1) && replies.has(2)) settle(validateProbe(replies.get(1), replies.get(2), enginePath))
    })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolveProbe(settled ?? {
        ok: false,
        code: "handshake-failed",
        message:
          `desktop engine exited before the probe completed at ${enginePath} ` +
          `(code ${code ?? "null"}, signal ${signal ?? "null"}); stderr: ${stderrTail.trim() || "<empty>"}`,
      })
    })

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "engine.hello", params: {} })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "capabilities", params: {} })}\n`)
  })
}
