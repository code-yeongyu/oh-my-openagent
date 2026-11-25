import { afterEach, describe, expect, test } from "bun:test"

import { assembleOmoSdk } from "../../omo-senpi/src/components/omo-sdk/assembly"
import type { OmoPrincipal } from "../../omo-senpi/src/components/omo-sdk/contract"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import { runThreadCommand } from "../bin/lib/thread.js"

// #15021 (security owner's ruling): one key sent to one thread delivers once whatever the surface, within one principal
// class; connector and service keep books of their own; a conflict carries no text from either message.

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

type Surface = "tool" | "sdk" | "cli"
const SURFACES: readonly Surface[] = ["tool", "sdk", "cli"]
const LEGS = { here: "dur-local", b: "dur-on-b" } as const

function world() {
  const a = account()
  const s = surface(a.remote)
  const sdk = s.sdk()
  const send = async (via: Surface, thread: string, text: string, key: string): Promise<Record<string, unknown>> => {
    if (via === "tool") return (await s.run("thread_send", { thread, message: text, idempotency_key: key })) as never
    if (via === "sdk") return (await sdk.send({ thread, text, idempotency_key: key })) as never
    const out: string[] = []
    await runThreadCommand(["send", thread, text, "--idempotency-key", key, "--json"], {
      engine: { run: () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      pluginRoot: "/plugin",
      agentDir: s.agentDir,
      env: {},
      cwd: process.cwd(),
      stdout: { write: (line: string) => void out.push(line) },
      stderr: { write: () => {} },
      platform: "linux",
      loadSqlite: async () => ({}),
      importSdk: async () => ({ createThreadSdk: () => ({ ...sdk, dispose: async () => {} }) }),
      identity: { uid: 501, user: "qa" },
    })
    return JSON.parse(out.join("")) as Record<string, unknown>
  }
  const onB = () => a.sent.filter((entry) => ["prompt", "admit_external_message"].includes(String(entry.rpc?.["type"])))
  const root = (principal: OmoPrincipal) =>
    assembleOmoSdk(
      {
        agentDir: s.agentDir,
        cwd: process.cwd(),
        principal,
        ports: { host: s.host, store: s.store, remote: a.remote },
      },
      {},
    )
  return { send, onB, root }
}

describe("one key, one thread, one delivery across surfaces of one class", () => {
  for (const [leg, thread] of Object.entries(LEGS))
    for (const first of SURFACES)
      for (const second of SURFACES.filter((via) => via !== first))
        test(`#given ${first} sent under a key to the thread ${leg} #when ${second} repeats it #then the repeat answers the first delivery's identifiers, deduplicated`, async () => {
          const { send, onB } = world()
          const one = await send(first, thread, "same message", "k-pair")
          const two = await send(second, thread, "same message", "k-pair")
          expect(one).toMatchObject({ kind: "ok", deduplicated: false })
          expect(two).toMatchObject({ kind: "ok", deduplicated: true })
          // Here the gateway row names the delivery; on b the holder's admissions count it.
          if (leg === "here") expect(two["delivery_id"]).toBe(one["delivery_id"])
          else expect(onB()).toHaveLength(1)
          expect(JSON.stringify(two)).not.toContain("undefined")
        })
})

describe("a conflict carries no text from either message", () => {
  test("#given a key used for one message #when another message reuses it on another surface #then idempotency_conflict naming neither message", async () => {
    const { send } = world()
    await send("tool", "dur-local", "first cnry-1d7a", "k-conflict")
    const conflict = await send("sdk", "dur-local", "second cnry-9e2b", "k-conflict")
    expect(conflict).toMatchObject({ kind: "error", error: { code: "idempotency_conflict" } })
    expect(JSON.stringify(conflict)).not.toMatch(/cnry-/)
  })
})

describe("connector and service never share a person's book", () => {
  for (const kind of ["connector", "service"] as const)
    test(`#given a person sent under a key #when a ${kind} repeats the key #then it gets its own answer, never the person's replay, and the person's next repeat is still a repeat`, async () => {
      const { root } = world()
      const person = root({ kind: "person", uid: 501 })
      const first = (await person.threads.send({
        thread: "dur-local",
        message: "hello",
        idempotency_key: "k-class",
      })) as Record<string, unknown>
      const other = root(kind === "connector" ? { kind, binding: "b-1" } : { kind })
      const theirs = (await other.threads.send({
        thread: "dur-local",
        message: "hello",
        idempotency_key: "k-class",
      })) as Record<string, unknown>
      expect(theirs["delivery_id"]).not.toBe(first["delivery_id"])
      expect(theirs).not.toMatchObject({ deduplicated: true })
      expect(
        await person.threads.send({ thread: "dur-local", message: "hello", idempotency_key: "k-class" }),
      ).toMatchObject({
        kind: "ok",
        deduplicated: true,
        delivery_id: first["delivery_id"],
      })
    })
})
