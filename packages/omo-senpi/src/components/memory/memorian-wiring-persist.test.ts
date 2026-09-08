import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { PendingNudges, RecallLedger, buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { createMemorianDelivery } from "./memorian-delivery"

const sessionId = "delivery-persist-session"
const nudge = { path: "reference/rollouts.md", hint: "Drain nodes first." }
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await Bun.$`rm -rf ${root}`
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "omo-memorian-delivery-persist-"))
  roots.push(root)
  const context = createMemoryIdentityContext({
    identity: "delivery-agent",
    identityPaths: buildIdentityPaths(root, "delivery-agent"),
    binding: createMemoryBinding({ identity: "delivery-agent", repoPath: join(root, "repo"), boundAt: 0 }),
  })
  const pending = new PendingNudges(context.identityPaths.recallPending)
  const delivery = createMemorianDelivery({
    ledgerFor: () => new RecallLedger(context.identityPaths.recallLedger),
    pendingFor: () => pending,
    sendMessage: () => undefined,
    appendEntry: () => undefined,
  })
  return { context, pending, delivery }
}

describe("memorian delivery persistence", () => {
  test("#given accepted nudges #when delivery accepts #then pending stores the launch epoch", async () => {
    const f = await fixture()
    await f.delivery.accept(sessionId, f.context, [nudge], 3)
    await expect(f.pending.take(sessionId, { currentEpoch: 3 })).resolves.toEqual([nudge])
  })

  test("#given pending nudges #when compaction is accepted #then pending is deleted", async () => {
    const f = await fixture()
    await f.delivery.accept(sessionId, f.context, [nudge], 0)
    await f.delivery.onCompactionAccepted(sessionId, f.context)
    await expect(f.pending.take(sessionId, { currentEpoch: 0 })).resolves.toEqual([])
  })

  test("#given accepted nudges #when prompt delivery drains the in-memory queue #then the pending file stays for take() to consume", async () => {
    const f = await fixture()
    await f.delivery.accept(sessionId, f.context, [nudge], 0)
    expect(f.delivery.drainForPrompt(sessionId, f.context)).toEqual([nudge])
    expect(existsSync(join(f.context.identityPaths.recallPending, `${sessionId}.json`))).toBe(true)
  })

  test("#given a rejecting pending writer #when accepted #then delivery logs no throw and remains usable", async () => {
    const f = await fixture()
    const delivery = createMemorianDelivery({
      ledgerFor: () => new RecallLedger(f.context.identityPaths.recallLedger),
      pendingFor: () => ({ write: async () => { throw new Error("disk") }, delete: async () => undefined }),
      sendMessage: () => undefined,
      appendEntry: () => undefined,
    })
    await delivery.accept(sessionId, f.context, [nudge], 0)
    expect(delivery.drainForPrompt(sessionId, f.context)).toEqual([nudge])
  })
})
