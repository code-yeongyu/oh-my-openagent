import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { buildIdentityPaths, PendingNudges, RecallLedger, type RecallNudge } from "@oh-my-opencode/memory-core"
import { IdleInjectionCoordinator } from "../../../extension/idle-injection-coordinator"
import { createMemoryBinding } from "../binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "../context"
import { createKibitzerDelivery } from "./delivery"
import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { createRecallDrain } from "../recall-drain"

const nudge: RecallNudge = { path: "memory/rollouts.md", hint: "Drain nodes before rollout." }
const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await Bun.$`rm -rf ${dir}`
})

function contextFor(dir: string): MemoryIdentityContext {
  return createMemoryIdentityContext({
    identity: "observability-agent",
    identityPaths: buildIdentityPaths(join(dir, "memory"), "observability-agent"),
    binding: createMemoryBinding({ identity: "observability-agent", repoPath: join(dir, "repo"), boundAt: 0 }),
  })
}

async function fixture(): Promise<{
  context: MemoryIdentityContext
  ledger: RecallLedger
  pending: PendingNudges
}> {
  const dir = await mkdtemp(join(tmpdir(), "kibitzer-observability-"))
  dirs.push(dir)
  const context = contextFor(dir)
  return {
    context,
    ledger: new RecallLedger(context.identityPaths.recallLedger),
    pending: new PendingNudges(context.identityPaths.recallPending),
  }
}

describe("kibitzer observability contract", () => {
  test("#given accepted nudges #when steer wake and prompt deliver #then each trace records its via", async () => {
    const steer = await fixture()
    const steerEntries: unknown[] = []
    const steerDelivery = createKibitzerDelivery({
      ledgerFor: () => steer.ledger,
      pendingFor: () => steer.pending,
      sendMessage: () => undefined,
      appendEntry: (_type, data) => steerEntries.push(data),
    })
    await steerDelivery.accept("steer-session", steer.context, [nudge])
    await steerDelivery.onToolResult("steer-session", steer.context, {
      hasPendingMessages: () => false,
      isIdle: () => false,
    })

    const wake = await fixture()
    const wakeEntries: unknown[] = []
    let wakeEntryReady: (() => void) | undefined
    const wakeReady = new Promise<void>((resolve) => { wakeEntryReady = resolve })
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const wakeDelivery = createKibitzerDelivery({
      ledgerFor: () => wake.ledger,
      pendingFor: () => wake.pending,
      coordinator,
      sendMessage: () => undefined,
      appendEntry: (_type, data) => {
        wakeEntries.push(data)
        if (typeof data === "object" && data !== null && "via" in data && data.via === "wake") wakeEntryReady?.()
      },
    })
    await wakeDelivery.accept("wake-session", wake.context, [nudge])
    coordinator.enqueue({ key: "task-completion:1", source: "task-completion", content: "done" })
    coordinator.flushOnIdle()
    await Promise.race([wakeReady, new Promise<void>((_, r) => setTimeout(() => r(new Error("wake ready timeout")), 5000))])

    const prompt = await fixture()
    const promptEntries: unknown[] = []
    const promptDelivery = createKibitzerDelivery({
      ledgerFor: () => prompt.ledger,
      pendingFor: () => prompt.pending,
      sendMessage: () => undefined,
      appendEntry: (_type, data) => promptEntries.push(data),
    })
    await promptDelivery.accept("prompt-session", prompt.context, [nudge])
    const drain = createRecallDrain({
      resolveContext: (id) => (id === "prompt-session" ? prompt.context : undefined),
      resolveSettings: () => memorySettings(),
      env: {},
      ledgerFor: () => prompt.ledger,
      pendingFor: () => prompt.pending,
      drainQueued: promptDelivery.drainForPrompt,
    })
    const pi = new MemoryFakeExtensionAPI()
    drain.register(pi)
    await pi.dispatch("before_agent_start", { type: "before_agent_start" }, {
      sessionManager: { getSessionId: () => "prompt-session", getBranch: () => [] },
    })

    expect(steerEntries).toEqual([{ version: 1, nudges: [nudge], via: "steer" }])
    expect(wakeEntries).toEqual([{ version: 1, nudges: [nudge], via: "wake" }])
    expect(pi.entries.map((entry) => entry.data)).toEqual([{ version: 1, nudges: [nudge], via: "prompt" }])
  })
})
