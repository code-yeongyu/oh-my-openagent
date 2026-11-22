import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { type DesktopCapabilities, ENGINE_ABI, PROTOCOL_VERSION } from "@oh-my-opencode/senpi-desktop-protocol"
import { isDesktopCapabilities, isRecord, parseHello } from "./parse"

/** Bounds the fresh engine's `engine.hello` + `capabilities`, the budget `computer-use-doctor` gives its probe. */
const PERMISSION_PROBE_TIMEOUT_MS = 5_000

type Capabilities = Omit<DesktopCapabilities, "cursorOverlay"> & { readonly cursorOverlay?: boolean }

/** Resolves the capabilities a new engine process reports, or `undefined` when it gave no usable answer. */
export type PermissionProbe = () => Promise<Capabilities | undefined>

const HELLO_ID = 1
const CAPABILITIES_ID = 2
const DENIED = "denied"

/** The doctor's probe path: start `file args` once more, ask `engine.hello` and `capabilities`, then end it. */
export function probeFreshEngine(
  file: string,
  args: readonly string[],
  timeoutMs = PERMISSION_PROBE_TIMEOUT_MS,
): PermissionProbe {
  return () =>
    new Promise((resolve) => {
      const child = spawn(file, [...args], { stdio: "pipe", windowsHide: true })
      const replies = new Map<unknown, unknown>()
      let settled = false
      const finish = (value: Capabilities | undefined) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
        child.stdin.end()
        child.kill()
      }
      const timer = setTimeout(() => finish(undefined), timeoutMs)
      child.on("error", () => finish(undefined))
      child.stdin.on("error", () => finish(undefined))
      child.on("close", () => finish(undefined))
      child.stderr.resume()
      createInterface({ input: child.stdout }).on("line", (line) => {
        const message = parseJson(line)
        if (!isRecord(message) || message.id === undefined) return
        if (!("result" in message)) return finish(undefined)
        replies.set(message.id, message.result)
        if (!replies.has(HELLO_ID) || !replies.has(CAPABILITIES_ID)) return
        const hello = parseHello(replies.get(HELLO_ID))
        const capabilities = replies.get(CAPABILITIES_ID)
        const sameContract = hello?.abi === ENGINE_ABI && hello.protocolVersion === PROTOCOL_VERSION
        finish(sameContract && isDesktopCapabilities(capabilities) ? capabilities : undefined)
      })
      for (const [id, method] of [
        [HELLO_ID, "engine.hello"],
        [CAPABILITIES_ID, "capabilities"],
      ] as const) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: {} })}\n`)
      }
    })
}

/**
 * macOS caches a TCC answer per process, so a long-lived engine keeps reporting a denial the user has since
 * lifted (DESIGN G14). After this child answered with a denial, its next `session.open` also asks a fresh
 * engine, and the fresh answer replaces every permission the child reported denied.
 */
export class PermissionPreflight {
  readonly #probe: PermissionProbe
  readonly #pending = new Map<number, { readonly opens: boolean; readonly probe?: Promise<Capabilities | undefined> }>()
  #lastDenied = false

  constructor(probe: PermissionProbe) {
    this.#probe = probe
  }

  /** Tracks an outgoing request; the probe starts with the `session.open` so the two run side by side. */
  sent(message: { readonly id?: unknown; readonly method?: unknown }): void {
    const { id, method } = message
    if (typeof id !== "number") return
    if (method === "capabilities") this.#pending.set(id, { opens: false })
    if (method === "session.open") {
      this.#pending.set(id, this.#lastDenied ? { opens: true, probe: this.#probe() } : { opens: true })
    }
  }

  /** The line to dispatch: unchanged unless it answers a probed `session.open`, which waits for the probe. */
  received(line: string): string | Promise<string> {
    if (this.#pending.size === 0) return line
    const message = parseJson(line)
    if (!isRecord(message) || typeof message.id !== "number" || !this.#pending.has(message.id)) return line
    const request = this.#pending.get(message.id)
    this.#pending.delete(message.id)
    const { result } = message
    const capabilities = request?.opens === true && isRecord(result) ? result.capabilities : result
    if (!isDesktopCapabilities(capabilities)) return line
    // Whether the next open probes follows the child's OWN answer: its cached denial outlives a merged grant,
    // so the merged result must not clear the flag (or the open after a successful re-probe skips the probe
    // and hands the caller the stale denial again).
    this.#lastDenied = hasDenial(capabilities)
    const probe = request?.probe
    if (probe === undefined || !isRecord(result)) return line
    return probe.then((fresh) => {
      if (fresh === undefined) return line
      const merged = merge(capabilities, fresh)
      return JSON.stringify({ ...message, result: { ...result, capabilities: merged } })
    })
  }
}

function hasDenial(capabilities: Capabilities): boolean {
  return [capabilities.capturePermission, capabilities.inputPermission, capabilities.axPermission].includes(DENIED)
}

function merge(stale: Capabilities, fresh: Capabilities): Capabilities {
  let merged = stale
  if (stale.capturePermission === DENIED) {
    merged = {
      ...merged,
      capturePermission: fresh.capturePermission,
      capture: fresh.capture,
      displayCount: fresh.displayCount,
    }
  }
  if (stale.inputPermission === DENIED || stale.axPermission === DENIED) {
    merged = {
      ...merged,
      inputPermission: fresh.inputPermission,
      axPermission: fresh.axPermission,
      input: fresh.input,
      ax: fresh.ax,
      backgroundWindowInput: fresh.backgroundWindowInput,
    }
  }
  return merged
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}
