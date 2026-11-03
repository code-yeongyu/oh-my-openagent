import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { createInterface } from "node:readline"

type Stage = { readonly stage: string; readonly elapsed_ms: number; readonly facts: Readonly<Record<string, unknown>> }

/** Observation only: never advances the clock, releases a barrier, or changes an RPC deadline. */
export function createColdReviveTrace(collectModules = false) {
  const started = performance.now()
  const stages: Stage[] = []
  const graphs: { launch: number; stage: string; elapsed_ms: number; modules: string[] }[] = []
  let launches = 0
  const mark = (stage: string, facts: Readonly<Record<string, unknown>> = {}): void => {
    const entry = { stage, elapsed_ms: Math.round((performance.now() - started) * 1000) / 1000, facts }
    stages.push(entry)
    console.error(`COLD_REVIVE_STAGE ${JSON.stringify(entry)}`)
  }
  const failure = (reason: string, cause?: unknown): Error => new Error(
    `${reason}; cold-revive stages=${JSON.stringify(stages)}`, { cause },
  )
  const spawnProcess = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    const launch = ++launches
    mark("connect", { launch })
    const child = spawn(command, [...args], collectModules
      ? { ...options, env: { ...options.env, OMO_QA_MEMBER_BOOT_MODULES: "1" } }
      : options)
    child.once("spawn", () => mark("process_spawned", { launch }))
    child.once("error", error => mark("process_error", { launch, message: error.message }))
    child.once("close", (code, signal) => mark("process_closed", { launch, code, signal }))
    if (child.stdout) createInterface({ input: child.stdout }).on("line", line => {
      let value: { type?: string; command?: string; success?: boolean }
      try { value = JSON.parse(line) } catch { return } // Protocol client reports malformed lines.
      if (value.type === "response") mark(`${value.command}_ack`, { launch, success: value.success })
      if (value.type === "agent_start") mark("turn_start", { launch })
      if (value.type === "agent_end") mark("turn_settle", { launch })
    })
    if (child.stderr) createInterface({ input: child.stderr }).on("line", line => {
      if (!line.startsWith("COLD_REVIVE_CHILD ")) return
      const { module_paths, ...event } = JSON.parse(line.slice(18))
      if (module_paths) graphs.push({ launch, stage: event.stage, elapsed_ms: event.elapsed_ms, modules: module_paths })
      mark("child_stage", { launch, event })
    })
    return child
  }
  return { mark, failure, spawnProcess, stages, graphs }
}

export type ColdReviveTrace = ReturnType<typeof createColdReviveTrace>
