import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import { B, createTwoDevices, T } from "./address/testing/two-devices"
import { createGatewayStore } from "./gateway/store"
import { SEND_PROJECTION } from "./sdk"
import type { ThreadHost } from "./tools"

// Design amendment on the send answer (P1b): the root's threads.send answers the tool's result plus endpoint_kind, its
// link comes from the one function the tools use, and every field of the shipped facade's send answer projects from a
// field of the root's answer (the table in thread/sdk.ts).
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const unused = async (): Promise<never> => {
  throw new Error("not used by a send")
}
const quietHost: ThreadHost = {
  socket: "/tmp/send-projection.sock",
  listSessions: async () => [],
  listView: async () => ({ sessions: [], hosts: [], disk: [] }),
  openSession: unused,
  getMessages: unused,
  getState: unused,
  prompt: unused,
  interrupt: unused,
  setSessionName: unused,
  setModel: unused,
  getAvailableModels: unused,
  setThinkingLevel: unused,
  getAvailableThinkingLevels: unused,
  gateway: { wake: async () => ({ admitted: [] }), releaseSession: unused },
}

function rootOn(td: ReturnType<typeof createTwoDevices>) {
  const agentDir = mkdtempSync(join(tmpdir(), "send-projection-"))
  const store = createGatewayStore({ agentDir })
  const root = assembleOmoSdk(
    { agentDir, cwd: process.cwd(), uid: 501, user: "qa-user", ports: { host: quietHost, store, remote: td.remote } },
    {},
  )
  cleanups.push(async () => {
    await root.dispose()
    rmSync(agentDir, { recursive: true, force: true })
  })
  return root
}

describe("the root's send answer", () => {
  test("#given a thread on device B #when the tool and the root send to it by the same address #then both answers carry the same link", async () => {
    const td = createTwoDevices()
    cleanups.push(td.cleanup)
    const address = `${B.name}/${T.bLive}`
    const tool = (await td.run("thread_send", { thread: address, message: "x" })) as { kind: string; link?: string }
    const root = await rootOn(td).threads.send({ thread: address, message: "y" })
    expect(tool.kind).toBe("ok")
    expect(root.kind).toBe("ok")
    expect(root.kind === "ok" ? root.link : undefined).toBe(tool.link)
  })

  test("#given the projection table #when a facade send's fields are read #then each has its root field in the root's answer to that send", async () => {
    const td = createTwoDevices()
    cleanups.push(td.cleanup)
    const root = await rootOn(td).threads.send({ thread: `${B.name}/${T.bLive}`, message: "y" })
    expect(root.kind).toBe("ok")
    const { link: _link, ...facade } = root as Record<string, unknown>
    const unsourced = Object.keys(facade).filter((field) => !Object.hasOwn(SEND_PROJECTION, field))
    expect(unsourced).toEqual([])
    for (const field of Object.keys(facade))
      expect([field, Object.hasOwn(root, SEND_PROJECTION[field as keyof typeof SEND_PROJECTION])]).toEqual([
        field,
        true,
      ])
  })
})
