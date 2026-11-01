import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { createInterface } from "node:readline"

import { HEARTBEAT_REQUEST_ID_PREFIX } from "../../runners/rpc/heartbeat"

type Stage = { readonly stage: string; readonly elapsed_ms: number; readonly facts: Readonly<Record<string, unknown>> }

function stageName(stage: Stage | undefined): string {
  if (stage === undefined) return "start"
  const { launch, event, command } = stage.facts as { launch?: unknown; event?: { stage?: unknown }; command?: unknown }
  const detail = typeof event?.stage === "string" ? event.stage : typeof command === "string" ? command : undefined
  const child = detail === undefined ? "" : `:${detail}`
  return `${stage.stage}${child}${typeof launch === "number" ? ` (launch ${launch})` : ""}`
}

function requestLine(chunk: unknown): { readonly type?: string; readonly id?: string } {
  const line = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : ""
  try {
    const { type, id } = JSON.parse(line) as { type?: unknown; id?: unknown }
    return { ...(typeof type === "string" ? { type } : {}), ...(typeof id === "string" ? { id } : {}) }
  } catch {
    return {} // not one protocol line; the stage still marks the send
  }
}

// Liveness probes are tagged by the heartbeat module that sends them, not recognised by command name.
const HEARTBEAT_PROBE = "heartbeat_probe"

/** Observation only: never advances the clock, releases a barrier, or changes an RPC deadline. */
export function createColdReviveTrace(collectModules = false) {
  const started = performance.now()
  const stages: Stage[] = []
  const graphs: { launch: number; stage: string; elapsed_ms: number; modules: string[] }[] = []
  let launches = 0
  const onStage = new Set<(stage: Stage) => void>()
  const mark = (stage: string, facts: Readonly<Record<string, unknown>> = {}): void => {
    const entry = { stage, elapsed_ms: Math.round((performance.now() - started) * 1000) / 1000, facts }
    stages.push(entry)
    console.error(`COLD_REVIVE_STAGE ${JSON.stringify(entry)}`)
    for (const listener of onStage) listener(entry)
  }
  const failure = (reason: string, cause?: unknown): Error => new Error(
    `${reason}; cold-revive stages=${JSON.stringify(stages)}`, { cause },
  )
  /** Rejects once no stage has been marked for `windowMs`, naming the last stage and the stall length. */
  const watchProgress = (windowMs: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let reject: (error: Error) => void = () => undefined
    const stalled = new Promise<never>((_, rejectStall) => { reject = rejectStall })
    // A heartbeat probe is the product checking liveness, not progress: it never restarts the clock.
    const arm = (stage?: Stage): void => {
      if (stage?.stage === HEARTBEAT_PROBE) return
      clearTimeout(timer)
      const armedAt = performance.now()
      timer = setTimeout(() => {
        const last = stages.findLast((entry) => entry.stage !== HEARTBEAT_PROBE)
        const stallMs = Math.round(performance.now() - armedAt)
        reject(failure(`Cold revival stalled: no stage for ${stallMs} ms (liveness window ${windowMs} ms) after "${stageName(last)}" at ${last?.elapsed_ms ?? 0} ms`))
      }, windowMs)
    }
    onStage.add(arm)
    arm()
    return { stalled, dispose: (): void => { onStage.delete(arm); clearTimeout(timer) } }
  }
  const spawnProcess = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    const launch = ++launches
    mark("connect", { launch })
    const child = spawn(command, [...args], collectModules
      ? { ...options, env: { ...options.env, OMO_QA_MEMBER_BOOT_MODULES: "1" } }
      : options)
    child.once("spawn", () => mark("process_spawned", { launch }))
    child.once("error", error => mark("process_error", { launch, message: error.message }))
    child.once("close", (code, signal) => mark("process_closed", { launch, code, signal }))
    // The protocol client arms a request's deadline and then writes it, so a stage marked on the write
    // restarts the watchdog no earlier than the product's own clock for that request.
    const stdin = child.stdin
    if (stdin) {
      const write = stdin.write.bind(stdin) as (chunk: unknown, ...rest: unknown[]) => boolean
      stdin.write = ((chunk: unknown, ...rest: unknown[]) => {
        const { type, id } = requestLine(chunk)
        if (id?.startsWith(HEARTBEAT_REQUEST_ID_PREFIX)) mark(HEARTBEAT_PROBE, { launch, command: type })
        else mark("request_sent", { launch, command: type })
        return write(chunk, ...rest)
      }) as typeof stdin.write
    }
    if (child.stdout) createInterface({ input: child.stdout }).on("line", line => {
      let value: { type?: string; command?: string; success?: boolean }
      try { value = JSON.parse(line) } catch { return } // Protocol client reports malformed lines.
      if (value.type === "response") mark(`${value.command}_ack`, { launch, success: value.success })
      if (value.type === "agent_start") mark("turn_start", { launch })
      if (value.type === "agent_end") mark("turn_settle", { launch })
    })
    let timings: Record<string, number> | undefined
    if (child.stderr) createInterface({ input: child.stderr }).on("line", line => {
      // senpi's phase timer (TIMING=1) prints one block per namespace; relay it as one stage.
      if (/^--- Startup Timings: .+ ---$/.test(line)) { timings = {}; return }
      const phase = /^\s+(.+): (\d+)ms$/.exec(line)
      if (timings !== undefined && phase !== null) {
        timings[phase[1] ?? ""] = Number(phase[2])
        if (phase[1] === "TOTAL") { mark("child_timings", { launch, phases: timings }); timings = undefined }
        return
      }
      if (!line.startsWith("COLD_REVIVE_CHILD ")) return
      const { module_paths, ...event } = JSON.parse(line.slice(18))
      if (module_paths) graphs.push({ launch, stage: event.stage, elapsed_ms: event.elapsed_ms, modules: module_paths })
      mark("child_stage", { launch, event })
    })
    return child
  }
  return { mark, failure, watchProgress, spawnProcess, stages, graphs }
}

export type ColdReviveTrace = ReturnType<typeof createColdReviveTrace>
