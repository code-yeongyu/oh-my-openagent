#!/usr/bin/env bun
// Surface (a) of the X1a proof: the SDK from a plain bun script. It imports nothing of the repository: the run hands it
// the path of the public SDK entry of the build under test (`bun drivers/sdk.ts <entry>`), and it speaks JSON lines on
// stdin/stdout, one scenario call in and that call's raw result out. No agent session and no omo child process.
// Today's public entry is the shipped thread SDK (`runtime/thread-sdk/sdk.js`, `createThreadSdk`); once the root lands
// (`omo-ai/sdk`, `createOmoSdk`, slice P1b) the run hands that entry instead and its `threads` namespace answers.
import { userInfo } from "node:os"
import { createInterface } from "node:readline"

import type { Mapping, Op } from "../scenario.ts"
import { call, isRecord } from "./driver.ts"

export const MAPPING: Readonly<Record<Op, Mapping>> = {
  create: call("create({ device, prompt })"),
  send: call("send({ thread, text, mode })"),
  read: call("read({ thread })"),
  interrupt: call("interrupt({ thread })"),
  setModel: call("set_model({ thread, model })"),
  // The SDK root has no reasoning call yet (threads.setReasoning, slice T1b); the cell starts running when it lands.
  setReasoning: { kind: "unavailable", slice: "T1b (threads.setReasoning)" },
  close: call("close({ thread })"),
}

type Sdk = Readonly<Record<string, unknown>>

const member = (sdk: Sdk, name: string, request: Readonly<Record<string, unknown>>): Promise<unknown> => {
  const fn = sdk[name]
  if (typeof fn !== "function") return Promise.resolve({ unavailable: `the entry has no ${name}` })
  return Promise.resolve(fn.call(sdk, request))
}

// The facade's names for the root's operations (design 4.1): snake_case members, `text` and `mode` for a send.
const viaFacade = (sdk: Sdk, op: Op, input: Readonly<Record<string, string>>): Promise<unknown> => {
  switch (op) {
    case "create":
      return member(sdk, "create", { device: input["device"], prompt: input["prompt"] })
    case "send":
      return member(sdk, "send", {
        thread: input["thread"],
        text: input["message"],
        mode: input["delivery"],
        ...(input["expected_turn_id"] === undefined ? {} : { expected_turn_id: input["expected_turn_id"] }),
        ...(input["idempotency_key"] === undefined ? {} : { idempotency_key: input["idempotency_key"] }),
      })
    case "read":
      return member(sdk, "read", { thread: input["thread"] })
    case "interrupt":
      return member(sdk, "interrupt", { thread: input["thread"] })
    case "setModel":
      return member(sdk, "set_model", { thread: input["thread"], model: input["model"] })
    case "setReasoning":
      return member(sdk, "set_reasoning", { thread: input["thread"], level: input["level"] })
    case "close":
      return member(sdk, "close", { thread: input["thread"] })
  }
}

async function main(): Promise<void> {
  const entry = process.argv[2]
  if (entry === undefined) throw new Error("usage: bun drivers/sdk.ts <public SDK entry>")
  const module: unknown = await import(entry)
  const create = isRecord(module) ? module["createThreadSdk"] : undefined
  if (typeof create !== "function") throw new Error(`${entry} exports no createThreadSdk`)
  const sdk: unknown = await create({
    agentDir: process.env["OMO_CODING_AGENT_DIR"],
    cwd: process.cwd(),
    uid: process.getuid?.() ?? 0,
    user: userInfo().username,
  })
  if (!isRecord(sdk)) throw new Error("createThreadSdk answered no SDK")
  // Each call is answered by its id as it settles, so a call that never settles holds up no later one.
  const inFlight: Promise<void>[] = []
  for await (const line of createInterface({ input: process.stdin })) {
    const request: unknown = JSON.parse(line)
    if (!isRecord(request) || typeof request["op"] !== "string" || !isRecord(request["input"])) continue
    const id = request["id"]
    const settled = viaFacade(sdk, request["op"] as Op, request["input"] as Record<string, string>).catch(
      (error: unknown) => ({ thrown: String(error) }),
    )
    inFlight.push(settled.then((raw) => void process.stdout.write(`${JSON.stringify({ id, raw })}\n`)))
  }
  await Promise.all(inFlight)
  await member(sdk, "dispose", {})
}

if (import.meta.main) await main()
