import { describe, expect, test } from "bun:test"
import { withContractHost, type ContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { DIAL_SCENES } from "../../../../senpi-task/src/runners/rpc-host/testing/dial-refusals"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalAttach } from "../remote/local-attach"
import { parseThreadParams, threadToolParamSchemas } from "./contracts"
import { hashArgs } from "./gateway/hash-args"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { createThreadTools } from "./tools"
import { createLiveThreadSurface } from "./live-surface"
import { connectCarrierHost } from "./wake/carrier-connection"

function surface(host: ContractHost, socket: string) {
  return createLiveThreadSurface(undefined, {
    env: { OMO_CODING_AGENT_DIR: host.root, SENPI_RPC_SOCKET: socket, SENPI_RPC_KEY_ROOT: host.root },
    statusAll: async () => undefined,
    registry: async () => [],
  })
}

const refusalOf = (attempt: Promise<unknown>) =>
  attempt.then(
    (value) => value,
    (error: unknown) => error,
  )

// Every omo-senpi dial of an rpc host (thread request, thread watch, wake carrier, local attach) answers each key-root scene alike.
const CALL_SITES: Record<string, (host: ContractHost, socket: string) => Promise<unknown>> = {
  "thread request": (host, socket) =>
    refusalOf(Reflect.apply(surface(host, socket).setSessionName, undefined, ["rpc-1", "renamed", "dur-selected"])),
  "thread watch": async (host, socket) => {
    const client = surface(host, socket)
    if (client.watchSession === undefined) throw new Error("watchSession is missing")
    return await refusalOf(client.watchSession("rpc-1", { record: () => {} }, "dur-selected"))
  },
  "wake carrier": (host, socket) => refusalOf(connectCarrierHost({ socket, keyRoot: () => host.root })),
  "local attach": (host, socket) =>
    refusalOf(
      createLocalAttach({ socket, keyRoot: host.root })({
        device: "dev-self",
        session: "s",
        durableId: "dur-selected",
      }),
    ),
}

async function release(outcome: unknown): Promise<void> {
  if (typeof outcome !== "object" || outcome === null) return
  const watch = Reflect.get(outcome, "watch")
  if (typeof watch === "object" && watch !== null && typeof Reflect.get(watch, "stop") === "function")
    Reflect.apply(Reflect.get(watch, "stop"), watch, [])
  const close = Reflect.get(outcome, "close")
  if (typeof close === "function") await Reflect.apply(close, outcome, [])
}

describe.skipIf(process.platform === "win32")("an rpc host dial over the key records under the key root", () => {
  for (const [site, dial] of Object.entries(CALL_SITES))
    test.each(Object.entries(DIAL_SCENES))(
      `#given %s #when the ${site} dials #then it answers as every client does`,
      async (_name, scene) => {
        await withContractHost(scene.options, async (host) => {
          const file = scene.arrange(host)
          const dialed = scene.dialed?.(host) ?? host.socket
          const outcome = await dial(host, dialed)
          const types = host.frames.map(({ frame }) => frame.type)
          if (scene.refusal === "authenticated") {
            await release(outcome)
            expect(types.slice(0, 2)).toEqual(["get_protocol_info", "authenticate"])
            expect(String(outcome instanceof Error ? outcome.message : "")).not.toMatch(
              /unsafe_key_record|host_identity_unproven/,
            )
            return
          }
          expect(String(outcome instanceof Error ? outcome.message : JSON.stringify(outcome))).toContain(
            scene.refusal(host, file, dialed),
          )
          expect(types).toEqual(["get_protocol_info"])
        })
      },
    )
})

function sessionTools(host: ContractHost, dialed: string, store: GatewayStore, agentDir: string) {
  return createThreadTools({
    host: surface(host, dialed),
    store,
    stateDirectory: agentDir,
    callerSessionId: () => "caller",
    callerWorkspaceRoot: () => process.cwd(),
  })
}

const SESSION_CALLS = [
  ["thread_list", { all_scope: true }],
  ["thread_read", { thread: "dur-selected", all_scope: true }],
  ["thread_rename", { thread: "dur-selected", name: "renamed", all_scope: true }],
] as const

describe.skipIf(process.platform === "win32")("an agent session told of a refused rpc host dial", () => {
  const refused = Object.entries(DIAL_SCENES).filter(([, scene]) => scene.session !== undefined)
  test.each(refused)(
    "#given %s #when a thread tool runs #then it is told the code and one fixed sentence, with no path and nothing to remove",
    async (_name, scene) => {
      await withContractHost(scene.options, async (host) => {
        scene.arrange(host)
        const dialed = scene.dialed?.(host) ?? host.socket
        const agentDir = mkdtempSync(join(tmpdir(), "session-refusal-"))
        const store = createGatewayStore({ agentDir })
        try {
          const tools = sessionTools(host, dialed, store, agentDir)
          for (const [name, args] of SESSION_CALLS) {
            const tool = tools.find((candidate) => candidate.name === name)
            if (tool === undefined) throw new Error(`${name} is not registered`)
            const answer = JSON.stringify(
              (await tool.execute("call-1", args, undefined, undefined, {} as never)).details.result,
            )
            expect(JSON.parse(answer)).toMatchObject({
              kind: "error",
              error: { message: `Thread operation failed: ${scene.session}` },
            })
            expect(answer).not.toContain(host.root)
            expect(answer).not.toMatch(/delete|remove|\/rpc\//)
          }
        } finally {
          await store.dispose()
          rmSync(agentDir, { recursive: true, force: true })
        }
      })
    },
  )
})

const RECEIPTED_CALLS = [
  ["thread_rename", { thread: "dur-selected", name: "renamed", all_scope: true, idempotency_key: "rename-refused-1" }],
  ["thread_interrupt", { thread: "dur-selected", all_scope: true, idempotency_key: "interrupt-refused-1" }],
  ["thread_create", { name: "refused-create", prompt: "hello", idempotency_key: "create-refused-1" }],
] as const

describe.skipIf(process.platform === "win32")("a receipted call refused by an rpc host dial, and its repeat", () => {
  const refused = Object.entries(DIAL_SCENES).filter(([, scene]) => scene.session !== undefined)
  test.each(refused)(
    "#given %s #when a receipted call is made twice under one key #then neither answer nor the stored receipt carries a path or anything to remove",
    async (_name, scene) => {
      await withContractHost(scene.options, async (host) => {
        scene.arrange(host)
        const dialed = scene.dialed?.(host) ?? host.socket
        const agentDir = mkdtempSync(join(tmpdir(), "session-receipt-"))
        const store = createGatewayStore({ agentDir })
        try {
          const tools = sessionTools(host, dialed, store, agentDir)
          const ectx = { sessionManager: { getSessionId: () => "caller" } }
          for (const [name, args] of RECEIPTED_CALLS) {
            const tool = tools.find((candidate) => candidate.name === name)
            if (tool === undefined) throw new Error(`${name} is not registered`)
            const first = JSON.stringify(
              (await tool.execute("call-1", args, undefined, undefined, ectx as never)).details.result,
            )
            const again = JSON.stringify(
              (await tool.execute("call-2", args, undefined, undefined, ectx as never)).details.result,
            )
            const parsed = parseThreadParams(threadToolParamSchemas[name], args)
            if (parsed.kind !== "ok") throw new Error(`invalid ${name} args`)
            const receipt = JSON.stringify(
              await store.toolReceiptBegin({
                principal: "session:caller",
                operation: name,
                idempotency_key: args.idempotency_key,
                now: Date.now(),
                args_hash: hashArgs(parsed.value),
              }),
            )
            expect(first).toContain(String(scene.session))
            for (const text of [first, again, receipt]) {
              expect(text).not.toContain(host.root)
              expect(text).not.toMatch(/delete|remove|\/rpc\//)
            }
          }
        } finally {
          await store.dispose()
          rmSync(agentDir, { recursive: true, force: true })
        }
      })
    },
  )
})
