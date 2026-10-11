import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOnboardingHarness } from "./test-harness"
import { claimOnboarding, isOnboardingComplete } from "./state"

const dirs: string[] = []
function harness(mode = "rpc") {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-lifecycle-"))
  dirs.push(dir)
  return { dir, ...createOnboardingHarness(dir, "owner", mode) }
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("onboarding claim lifecycle", () => {
  for (const stopReason of ["aborted", "error"]) {
    test(`#given the onboarding turn #when ${stopReason} #then release and reinject next time`, async () => {
      const h = harness()
      await h.prompt()
      expect(isOnboardingComplete(h.dir)).toBe(true)
      await h.agentStart()
      await h.end(stopReason, { aborted: stopReason === "aborted" })
      await h.settle()
      expect(isOnboardingComplete(h.dir)).toBe(false)
      expect((await h.prompt()).filter(Boolean)).toHaveLength(1)
    })
  }

  test("#given a completed onboarding turn #when a later turn fails #then keep the marker", async () => {
    const h = harness()
    await h.prompt()
    await h.agentStart()
    await h.end()
    await h.settle()
    await h.agentStart()
    await h.end("error")
    await h.settle()
    expect(isOnboardingComplete(h.dir)).toBe(true)
    expect((await createOnboardingHarness(h.dir, "later").prompt()).filter(Boolean)).toHaveLength(0)
  })

  test("#given automatic retry #when the first attempt fails #then keep ownership until retry completes", async () => {
    const h = harness()
    await h.prompt()
    await h.agentStart()
    await h.end("error", { willRetry: true })
    expect(isOnboardingComplete(h.dir)).toBe(true)
    await h.agentStart()
    await h.end()
    await h.settle()
    expect(isOnboardingComplete(h.dir)).toBe(true)
  })

  test("#given another session or no started run #when agent_end fires #then it cannot release our claim", async () => {
    const h = harness()
    await h.prompt()
    await h.end("error")
    expect(isOnboardingComplete(h.dir)).toBe(true)
    await h.agentStart()
    await h.pi.dispatch("agent_end", { type: "agent_end", aborted: true, messages: [] }, {
      ...h.ctx, sessionManager: { getSessionId: () => "other" },
    })
    expect(isOnboardingComplete(h.dir)).toBe(true)
  })

  test("#given rejected prompt admission #when no agent starts #then release the claim", async () => {
    const h = harness()
    await h.prompt()
    await h.pi.dispatch("input_disposition", { type: "input_disposition", disposition: "rejected" }, h.ctx)
    expect(isOnboardingComplete(h.dir)).toBe(false)
    expect((await h.prompt()).filter(Boolean)).toHaveLength(1)
  })

  test("#given an end boundary #when a late abort joins #then settlement releases the claim", async () => {
    const h = harness("tui")
    await h.prompt()
    await h.agentStart()
    const event = { type: "agent_end", aborted: false, messages: [{ role: "assistant", stopReason: "stop" }] }
    await h.pi.dispatch("agent_end", event, h.ctx)
    event.aborted = true
    await h.settle()
    expect(isOnboardingComplete(h.dir)).toBe(false)
    expect(h.widgets.has("omo-onboarding")).toBe(true)
  })

  test("#given a retry-owned turn #when retry fails terminally #then release the original claim", async () => {
    const h = harness()
    await h.prompt()
    await h.agentStart()
    await h.end("error", { willRetry: true })
    await h.agentStart()
    await h.end("error")
    await h.settle()
    expect(isOnboardingComplete(h.dir)).toBe(false)
  })

  for (const event of ["session_abort", "session_shutdown"]) {
    test(`#given pending onboarding #when ${event} #then release uncompleted ownership`, async () => {
      const h = harness()
      await h.prompt()
      expect(isOnboardingComplete(h.dir)).toBe(true)
      await h.pi.dispatch(event, { type: event }, h.ctx)
      expect(isOnboardingComplete(h.dir)).toBe(false)
    })
  }

  test("#given a forced tour over an old marker #when aborted #then preserve that old marker", async () => {
    const h = harness("tui")
    claimOnboarding(h.dir)
    h.pi.setFlag("onboard", true)
    await h.start()
    await h.agentStart()
    await h.end("aborted", { aborted: true })
    await h.settle()
    expect(isOnboardingComplete(h.dir)).toBe(true)
  })
})
