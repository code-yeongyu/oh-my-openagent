import { afterEach, describe, expect, test } from "bun:test"

import { assembleOmoSdk } from "../omo-sdk/assembly"
import { createRemoteThreadFixture } from "./thread-remote-fixture"

// #14951: the reads the SDK lacked (threads.receipt, threads.readAfterWait, threads.messages) on the root, each the
// thread core's one body the tool runs, on this device (dur-local) and on device b (dur-on-b).

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

function rootOn() {
  const a = account()
  const s = surface(a.remote)
  const root = assembleOmoSdk(
    {
      agentDir: s.agentDir,
      cwd: process.cwd(),
      uid: 501,
      user: "qa",
      ports: { host: s.host, store: s.store, remote: a.remote },
    },
    {},
  )
  return { a, s, root }
}

const threads = (answer: unknown) =>
  ((answer as { threads?: readonly { thread: string; state?: string; cwd?: string }[] }).threads ?? []).map(
    (row) => row.thread,
  )

describe("threads.list filters", () => {
  test("#given threads here and on device b #when the root lists by device, name and project #then only the matching rows", async () => {
    const { root } = rootOn()
    expect(threads(await root.threads.list({ all_scope: true, device: "b" }))).toEqual(["dur-on-b"])
    expect(threads(await root.threads.list({ all_scope: true, device: "here" }))).toEqual(["dur-local"])
    expect(threads(await root.threads.list({ all_scope: true, name: "ON B" }))).toEqual(["dur-on-b"])
    expect(threads(await root.threads.list({ all_scope: true, project: "/work/b" }))).toEqual(["dur-on-b"])
  })

  test("#given archived false #when the root lists #then no archived row; archived true lists archived rows only", async () => {
    const { root } = rootOn()
    const unarchived = (await root.threads.list({ all_scope: true, archived: false })) as {
      threads: readonly { state?: string }[]
    }
    expect(unarchived.threads.every((row) => row.state !== "archived")).toBe(true)
    const archived = (await root.threads.list({ all_scope: true, archived: true })) as {
      kind: string
      threads: readonly { state?: string }[]
    }
    expect(archived.kind).toBe("ok")
    expect(archived.threads.every((row) => row.state === "archived")).toBe(true)
  })

  test("#given a workspace other than this one #when the root lists without all_scope #then this workspace's thread is not listed", async () => {
    const { root } = rootOn()
    expect(threads(await root.threads.list({}))).toContain("dur-local")
    expect(threads(await root.threads.list({ workspace: "/nowhere/else" }))).not.toContain("dur-local")
  })

  test("#given a list under a key #when the key is reused with another filter #then idempotency_conflict", async () => {
    const { root } = rootOn()
    expect(await root.threads.list({ all_scope: true, idempotency_key: "k-list" })).toMatchObject({ kind: "ok" })
    expect(await root.threads.list({ all_scope: true, device: "b", idempotency_key: "k-list" })).toMatchObject({
      kind: "error",
      error: { code: "idempotency_conflict" },
    })
  })
})

describe("a keyed read is bound to its caller's principal", () => {
  test("#given one key used by the tool (a session), the SDK root (cli:501) and a root for another uid (cli:502) with different filters #when each lists #then none replays or conflicts with another", async () => {
    const { a, s, root } = rootOn()
    const other = assembleOmoSdk(
      {
        agentDir: s.agentDir,
        cwd: process.cwd(),
        uid: 502,
        user: "qa2",
        ports: { host: s.host, store: s.store, remote: a.remote },
      },
      {},
    )
    const key = "k-shared"
    const viaTool = (await s.run("thread_list", { all_scope: true, idempotency_key: key })) as unknown as {
      kind: string
      threads: unknown[]
    }
    const viaRoot = (await root.threads.list({ all_scope: true, device: "b", idempotency_key: key })) as unknown as {
      kind: string
      threads: unknown[]
    }
    const viaOther = (await other.threads.list({
      all_scope: true,
      device: "here",
      idempotency_key: key,
    })) as unknown as {
      kind: string
      threads: unknown[]
    }
    expect([viaTool.kind, viaRoot.kind, viaOther.kind]).toEqual(["ok", "ok", "ok"])
    expect(threads(viaRoot)).toEqual(["dur-on-b"])
    expect(threads(viaOther)).toEqual(["dur-local"])
    expect(threads(viaTool).sort()).toEqual(["dur-local", "dur-on-b"])
  })
})

describe("threads.read inputs", () => {
  test("#given a thread with several transcript items #when the root reads with limit 1 #then the one newest item of the unlimited read", async () => {
    const { root } = rootOn()
    const all = (await root.threads.read({ thread: "dur-local" })) as { kind: string; items: readonly unknown[] }
    const one = (await root.threads.read({ thread: "dur-local", limit: 1 })) as {
      kind: string
      items: readonly unknown[]
    }
    expect(all.items.length).toBeGreaterThan(1)
    expect(one.items).toEqual(all.items.slice(-1))
  })

  test("#given a read under a key #when it runs #then it answers the read, and the same key with another thread is idempotency_conflict", async () => {
    const { root } = rootOn()
    expect(await root.threads.read({ thread: "dur-local", idempotency_key: "k-read" })).toMatchObject({ kind: "ok" })
    expect(await root.threads.read({ thread: "dur-on-b", idempotency_key: "k-read" })).toMatchObject({
      kind: "error",
      error: { code: "idempotency_conflict" },
    })
  })
})

describe("threads.receipt", () => {
  test("#given the root sent to a thread on this device #when it asks for that delivery's receipt #then it answers the delivery's outcome, as thread_read's receipt branch does for its caller", async () => {
    const { root } = rootOn()
    const sent = (await root.threads.send({ thread: "dur-local", message: "receipt me" })) as { delivery_id?: string }
    const receipt = await root.threads.receipt({ thread: "dur-local", delivery_id: String(sent.delivery_id) })
    expect(receipt).toMatchObject({
      kind: "ok",
      thread: "dur-local",
      delivery_id: sent.delivery_id,
      outcome: { kind: "pending" },
    })
  })

  test("#given a delivery id the root never sent #when it asks for its receipt #then outcome_unavailable, and nothing is read or sent", async () => {
    const { root, a } = rootOn()
    const before = a.sent.length
    expect(await root.threads.receipt({ thread: "dur-local", delivery_id: "dlv-nobody" })).toMatchObject({
      kind: "ok",
      outcome: { kind: "outcome_unavailable" },
    })
    expect(a.sent.length).toBe(before)
  })
})

describe("threads.readAfterWait", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given an idle thread %s #when the root reads after a wait #then it answers the transcript with the wait block, as thread_read's wait branch does",
    async (thread) => {
      const { root, s } = rootOn()
      const unmeasured = (answer: unknown) => {
        const { wait, ...rest } = answer as { readonly wait?: Record<string, unknown> }
        return { ...rest, wait: wait === undefined ? undefined : { ...wait, waited_ms: 0 } }
      }
      const viaRoot = unmeasured(await root.threads.readAfterWait({ thread, wait_ms: 1 }))
      const viaTool = unmeasured(await s.run("thread_read", { thread, wait_ms: 1 }))
      expect(viaRoot.wait).toBeDefined()
      expect(viaRoot).toEqual(viaTool)
    },
  )
})

describe("threads.messages", () => {
  test.each(["dur-local", "dur-on-b"])(
    "#given a live thread %s #when the root asks for its messages #then it answers the engine's whole message list",
    async (thread) => {
      const { root } = rootOn()
      const answer = (await root.threads.messages({ thread })) as { kind: string; messages?: readonly unknown[] }
      expect(answer.kind).toBe("ok")
      expect(answer.messages?.length).toBeGreaterThan(0)
    },
  )

  test("#given an address nothing holds #when the root asks for its messages #then not_found, as every control answers it", async () => {
    const { root } = rootOn()
    expect(await root.threads.messages({ thread: "nobody-here" })).toMatchObject({
      kind: "error",
      error: { code: "not_found" },
    })
  })
})
