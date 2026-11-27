// Surface (c) of the X1a proof: the omo CLI as a spawned process with --json. The run hands it the launcher and the
// environment of device A; each scenario call is one `omo` process whose stdout is parsed as the raw answer. Today the
// thread verbs cover send, read and close; open, interrupt and the model switch are `omo remote` verbs (design 6.2,
// `omo thread interrupt` / `omo thread model` are planned in T3).
import { spawn } from "node:child_process"

import type { Mapping, Op } from "../scenario.ts"
import { type Answer, type Call, call, type Driver, succeeded, threadOf } from "./driver.ts"

export const MAPPING: Readonly<Record<Op, Mapping>> = {
  create: { kind: "needs_account", how: "omo remote open <device> --prompt <text> --json" },
  send: call("omo thread send <thread> <text> --mode <delivery> --json"),
  read: call("omo thread read <thread> --json"),
  interrupt: call("omo remote interrupt <thread> --json"),
  setModel: call("omo remote model <thread> <provider/id:level> --json"),
  // No CLI verb sets a thread's thinking level today (`omo remote` has model only; `omo thread` has no reasoning verb).
  setReasoning: { kind: "unavailable", slice: "T3 (the omo thread verbs over the SDK root)" },
  close: call("omo thread close <thread> --json"),
}

const argvOf = (op: Op, input: Readonly<Record<string, string>>): string[] => {
  const at = (name: string): string => input[name] ?? ""
  switch (op) {
    case "create":
      return ["remote", "open", at("device"), "--prompt", at("prompt"), "--json"]
    case "send":
      return [
        "thread",
        "send",
        at("thread"),
        at("message"),
        "--mode",
        at("delivery"),
        ...(input["expected_turn_id"] === undefined ? [] : ["--expected-turn", at("expected_turn_id")]),
        ...(input["idempotency_key"] === undefined ? [] : ["--idempotency-key", at("idempotency_key")]),
        "--json",
      ]
    case "read":
      return ["thread", "read", at("thread"), "--json"]
    case "interrupt":
      return ["remote", "interrupt", at("thread"), "--json"]
    case "setModel":
      return ["remote", "model", at("thread"), at("model"), "--json"]
    case "setReasoning":
      return []
    case "close":
      return ["thread", "close", at("thread"), "--json"]
  }
}

type Spawned = { readonly code: number | null; readonly stdout: string; readonly stderr: string }

const runOmo = (
  launcher: readonly string[],
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  signal: AbortSignal | undefined,
) =>
  new Promise<Spawned>((resolve, reject) => {
    const [command, ...prefix] = launcher
    if (command === undefined) return reject(new Error("no omo launcher"))
    const child = spawn(command, [...prefix, ...argv], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(signal === undefined ? {} : { signal, killSignal: "SIGKILL" as const }),
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")))
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")))
    child.once("error", (error) => (signal?.aborted === true ? resolve({ code: null, stdout, stderr }) : reject(error)))
    child.once("close", (code) => resolve({ code, stdout, stderr }))
  })

const parsed = (stdout: string): unknown => {
  const last = stdout.trim().split("\n").at(-1) ?? ""
  try {
    return JSON.parse(last)
  } catch {
    return undefined
  }
}

/** `launcher`: the argv that runs omo (`node <omo.js>`); `env`/`cwd`: device A's sandbox. */
export function createCliDriver(options: {
  readonly launcher: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string
}): Driver {
  return {
    mapping: MAPPING,
    run: async ({ op, input }: Call, signal?: AbortSignal): Promise<Answer> => {
      const argv = argvOf(op, input)
      const result = await runOmo(options.launcher, argv, options.env, options.cwd, signal)
      const json = parsed(result.stdout)
      const raw = {
        exit: result.code,
        json: json ?? null,
        ...(json === undefined ? { stdout: result.stdout.slice(-2000), stderr: result.stderr.slice(-2000) } : {}),
      }
      const thread = threadOf(json)
      return {
        call: `omo ${argv.join(" ")}`,
        raw,
        answered: result.code === 0 && succeeded(json),
        ...(thread === undefined ? {} : { thread }),
      }
    },
    close: async () => {},
  }
}
