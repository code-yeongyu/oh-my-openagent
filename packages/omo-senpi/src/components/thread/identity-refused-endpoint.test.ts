import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { withContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { DIAL_SCENES } from "../../../../senpi-task/src/runners/rpc-host/testing/dial-refusals"
import { createGatewayStore } from "./gateway/store"
import { createLiveThreadSurface } from "./live-surface"
import { createThreadTools } from "./tools"

// Security contract (omo#15197): an identity refusal reaches an agent session as its code and fixed sentence, no path.
const SCENE = DIAL_SCENES["a challenge under a launch with no record"]
const TARGET = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
const CONTROL_CALLS = [
  ["thread_read", { thread: TARGET, all_scope: true }],
  ["thread_rename", { thread: TARGET, name: "renamed", all_scope: true }],
  ["thread_interrupt", { thread: TARGET, all_scope: true }],
  ["thread_close", { thread: TARGET, all_scope: true }],
] as const

describe.skipIf(process.platform === "win32")("a thread on an endpoint refused for its identity, beside one that answers", () => {
  test("#given a challenge under a launch with no key record #when an agent session lists, controls and sends to that thread #then it is told host_identity_unproven with the fixed sentence, never not-live or offline, and no path", async () => {
    if (SCENE === undefined || SCENE.session === undefined) throw new Error("dial scene missing")
    const session = SCENE.session
    await withContractHost(SCENE.options, async (refused) => {
      const recordPath = SCENE.arrange(refused)
      await withContractHost({}, async (answering) => {
        const dir = mkdtempSync(join(tmpdir(), "identity-refused-"))
        const sessions = join(dir, "sessions")
        mkdirSync(sessions, { recursive: true })
        const file = join(sessions, `2026-11-27T10-00-00-000Z_${TARGET}.jsonl`)
        writeFileSync(
          file,
          `${JSON.stringify({ type: "session", id: TARGET, timestamp: "2026-11-27T10:00:00.000Z", cwd: dir })}\n${JSON.stringify({ type: "session_info", name: "unproven-target" })}\n`,
        )
        const store = createGatewayStore({ agentDir: dir })
        try {
          const surface = createLiveThreadSurface(undefined, {
            env: { OMO_CODING_AGENT_DIR: refused.root, SENPI_RPC_SOCKET: answering.socket, SENPI_RPC_KEY_ROOT: refused.root },
            statusAll: async () => [
              { socket: refused.socket, reachable: true, session_paths: [file] },
              { socket: answering.socket, reachable: true, session_paths: [] },
            ],
            registry: async () => [],
          })
          const tools = createThreadTools({
            host: surface,
            store,
            stateDirectory: dir,
            sessionsDirectory: () => sessions,
            callerSessionId: () => "caller",
            callerWorkspaceRoot: () => dir,
          })
          const run = async (name: string, args: Readonly<Record<string, unknown>>) => {
            const tool = tools.find((candidate) => candidate.name === name)
            if (tool === undefined) throw new Error(`${name} is not registered`)
            const output = await tool.execute(`call-${name}`, args, undefined, undefined, {} as never)
            return { result: output.details.result as Record<string, unknown>, rendered: JSON.stringify(output) }
          }
          const rendered: string[] = []

          const listed = await run("thread_list", { all_scope: true })
          rendered.push(listed.rendered)
          const threads = (listed.result["threads"] ?? []) as readonly Record<string, unknown>[]
          expect(threads.find((row) => row["thread"] === TARGET)).toMatchObject({ error_note: session })

          for (const [name, args] of CONTROL_CALLS) {
            const answer = await run(name, args)
            rendered.push(answer.rendered)
            expect(answer.result).toMatchObject({
              kind: "error",
              error: { message: `Thread operation failed: ${session}` },
            })
          }

          const sent = await run("thread_send", { thread: TARGET, message: "hello", all_scope: true })
          rendered.push(sent.rendered)
          expect(sent.result).toMatchObject({
            kind: "ok",
            delivery: { kind: "queued", waiting_on: { kind: "host_identity_unproven" } },
          })

          for (const text of rendered) {
            expect(text).not.toContain(refused.socket)
            expect(text).not.toContain(refused.root)
            expect(text).not.toContain(recordPath)
            expect(text).not.toMatch(/\/rpc\/keys\//)
          }
          expect(refused.mutations).toEqual([])
        } finally {
          await store.dispose()
          rmSync(dir, { recursive: true, force: true })
        }
      })
    })
  })
})
