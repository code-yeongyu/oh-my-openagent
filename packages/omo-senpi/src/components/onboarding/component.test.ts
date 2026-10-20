import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { createOnboardingHarness, hermeticScanEnvironment } from "./test-harness"
import { claimOnboarding, isOnboardingComplete, releaseOnboarding } from "./state"
import { createOnboardingComponent, type TuiScanResult } from "./component"
import { registrySnapshot } from "../memory/facts-runner.test-support"
import { fakeModel } from "./understand.test-support"

// A scan that rejects on its first call and succeeds after, counting every start.
function flakyScan(context: string, gate: Promise<void> = Promise.resolve()) {
  let calls = 0
  const scan = async (): Promise<TuiScanResult> => {
    calls += 1
    if (calls === 1) throw new Error("transient scan failure")
    await gate
    return { scanId: "scan-retry", digests: [], projectRoots: new Set<string>(), context }
  }
  return { scan, calls: () => calls }
}

const dirs: string[] = []
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-onboarding-entry-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("omo.onboard"))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("onboarding entry", () => {
  test("#given background RPC sessions #when opened without prompts #then no claim or turn", async () => {
    const dir = freshDir()
    for (const name of ["probe", "auth", "prewarm"]) {
      const h = createOnboardingHarness(dir, name)
      await h.start()
      expect(isOnboardingComplete(dir)).toBe(false)
      expect(h.pi.messages).toEqual([])
      expect(h.widgets.size).toBe(0)
    }
  })

  test("#given a fresh TUI #when launched #then only a static widget appears", async () => {
    const dir = freshDir()
    const h = createOnboardingHarness(dir, "tui", "tui")
    await h.start()
    expect(h.widgets.has("omo-onboarding")).toBe(true)
    expect(h.pi.messages).toEqual([])
    expect(isOnboardingComplete(dir)).toBe(false)
  })

  test("#given the first real prompt #when dispatched #then context rides once on that turn", async () => {
    const dir = freshDir()
    const h = createOnboardingHarness(dir, "first", "tui")
    await h.start()
    expect(await h.prompt()).toEqual([{
      message: { customType: "omo-onboarding:context", content: expect.any(String), display: false },
    }])
    expect(isOnboardingComplete(dir)).toBe(true)
    expect(h.pi.messages).toEqual([])
    expect(h.widgets.has("omo-onboarding")).toBe(false)
    expect(await h.prompt()).toEqual([undefined])
  })

  test("#given two sessions on one install #when both prompt #then only one claims", async () => {
    const dir = freshDir()
    const first = createOnboardingHarness(dir, "first")
    const second = createOnboardingHarness(dir, "second")
    const results = await Promise.all([first.prompt(), second.prompt()])
    expect(results.flat().filter(Boolean)).toHaveLength(1)
    expect(isOnboardingComplete(dir)).toBe(true)
  })

  test("#given an existing marker #when a new session prompts #then no onboarding", async () => {
    const dir = freshDir()
    claimOnboarding(dir)
    const h = createOnboardingHarness(dir)
    expect(await h.prompt()).toEqual([undefined])
    expect(h.pi.messages).toEqual([])
  })

  test("#given an externally created marker and sidecar #when normal lifecycle events fire #then both stay untouched", async () => {
    const dir = freshDir()
    const marker = join(dir, "onboarding-completed")
    const sidecar = join(dir, "onboarding-completed.desktop-stopgap")
    writeFileSync(marker, "")
    writeFileSync(sidecar, "opaque fixture; not interpreted by onboarding")
    for (const mode of ["rpc", "tui"]) {
      const h = createOnboardingHarness(dir, mode, mode)
      await h.start()
      expect(await h.prompt()).toEqual([undefined])
      await h.agentStart()
      await h.end("error")
      await h.settle()
      await h.pi.dispatch("session_abort", {}, h.ctx)
      await h.pi.dispatch("session_shutdown", {}, h.ctx)
      expect(h.pi.messages).toEqual([])
      expect(h.widgets.size).toBe(0)
      expect(readFileSync(marker, "utf8")).toBe("")
      expect(readFileSync(sidecar, "utf8")).toBe("opaque fixture; not interpreted by onboarding")
    }
  })

  for (const trigger of ["extension", "delivery"]) {
    test(`#given a ${trigger} turn #when starting #then the user retains onboarding`, async () => {
      const dir = freshDir()
      const h = createOnboardingHarness(dir)
      expect(await h.prompt({ trigger })).toEqual([undefined])
      expect(isOnboardingComplete(dir)).toBe(false)
    })
  }

  test("#given a preview pass #when dispatched directly #then it cannot consume state", async () => {
    const dir = freshDir()
    const h = createOnboardingHarness(dir)
    expect(await h.prompt({ preview: true })).toEqual([undefined])
    expect(isOnboardingComplete(dir)).toBe(false)
    expect(h.pi.handlers.find((entry) => entry.event === "before_agent_start")?.options?.previewSafe).not.toBe(true)
    expect((await h.prompt()).filter(Boolean)).toHaveLength(1)
  })

  for (const excluded of ["headless", "worker", "disabled"]) {
    test(`#given ${excluded} #when startup and prompt fire #then neither claims nor sends`, async () => {
      const dir = freshDir()
      const h = createOnboardingHarness(dir)
      if (excluded === "headless") h.ctx.hasUI = false
      if (excluded === "worker") h.pi.sessionKind = "worker"
      if (excluded === "disabled") h.pi.setFlag("omo-senpi-onboarding-disabled", true)
      await h.start()
      expect(await h.prompt()).toEqual([undefined])
      expect(isOnboardingComplete(dir)).toBe(false)
      expect(h.pi.messages).toEqual([])
    })
  }

  test("#given forced TUI onboarding #when startup repeats #then one immediate guided tour", async () => {
    const dir = freshDir()
    claimOnboarding(dir)
    const h = createOnboardingHarness(dir, "forced", "tui")
    h.pi.setFlag("onboard", true)
    await h.start()
    await h.start()
    expect(h.pi.messages).toEqual([{
      message: { customType: "omo-onboarding:bootstrap", content: expect.any(String), display: false },
      options: { triggerTurn: true, deliverAs: "followUp" },
    }])
    expect(await h.prompt()).toEqual([undefined])
    await h.agentStart()
    await h.end()
    await h.settle()
    expect(await h.prompt()).toEqual([undefined])
  })

  test("#given forced RPC onboarding #when opened #then it waits for the first prompt", async () => {
    const dir = freshDir()
    claimOnboarding(dir)
    const h = createOnboardingHarness(dir)
    h.pi.setFlag("onboard", true)
    await h.start()
    expect(h.pi.messages).toEqual([])
    expect((await h.prompt()).filter(Boolean)).toHaveLength(1)
  })

  for (const mode of ["tui", "rpc"]) {
    test(`#given --onboard in ${mode} #when new resume and fork register runtimes #then force injects only once per process`, async () => {
      const dir = freshDir()
      claimOnboarding(dir)
      const tours: number[] = []
      for (const reason of ["startup", "new", "resume", "fork"]) {
        const component = createOnboardingComponent({
          claimOnboarding: () => claimOnboarding(dir),
          isOnboardingComplete: () => isOnboardingComplete(dir),
          releaseOnboarding: () => releaseOnboarding(dir),
          scan: async () => undefined,
          scanEnvironment: hermeticScanEnvironment(dir),
        })
        const h = createOnboardingHarness(dir, reason, mode, component)
        h.pi.setFlag("onboard", true)
        await h.start()
        const results = await h.prompt()
        tours.push(h.pi.messages.length + results.filter(Boolean).length)
        await h.agentStart()
        await h.end()
        await h.settle()
      }
      expect(tours).toEqual([1, 0, 0, 0])
    })
  }

  test("#given the first setup scan fails #when onboarding claims again in this process #then the scan retries and its result reaches the context", async () => {
    const dir = freshDir()
    const flaky = flakyScan("Onboarding scan scan-retry: SCAN-RETRY-OK")
    const component = createOnboardingComponent({
      claimOnboarding: () => claimOnboarding(dir),
      isOnboardingComplete: () => isOnboardingComplete(dir),
      releaseOnboarding: () => releaseOnboarding(dir),
      scan: flaky.scan,
      scanEnvironment: hermeticScanEnvironment(dir),
      sessionHistory: async () => undefined,
    })
    const h = createOnboardingHarness(dir, "retry", "rpc", component)
    const contentOf = (results: unknown[]) => String((results.find(Boolean) as { message: { content: unknown } }).message.content)

    expect(contentOf(await h.prompt())).not.toContain("SCAN-RETRY-OK")
    await h.pi.dispatch("input_disposition", { disposition: "rejected" }, h.ctx)
    expect(contentOf(await h.prompt())).toContain("SCAN-RETRY-OK")
    expect(flaky.calls()).toBe(2)
  })

  test("#given the first understanding scan fails #when onboarding_understand runs again, twice at once #then one retried scan serves both", async () => {
    const dir = freshDir()
    let open = (): void => undefined
    const flaky = flakyScan("unused", new Promise<void>((resolve) => { open = resolve }))
    const component = createOnboardingComponent({
      claimOnboarding: () => claimOnboarding(dir),
      isOnboardingComplete: () => isOnboardingComplete(dir),
      releaseOnboarding: () => releaseOnboarding(dir),
      scan: flaky.scan,
      scanEnvironment: hermeticScanEnvironment(dir),
      understanding: { createRunner: fakeModel(async () => "completed").createRunner },
    })
    const h = createOnboardingHarness(dir, "understand", "tui", component)
    const understand = h.pi.tools.find((tool) => tool["name"] === "onboarding_understand") as unknown as {
      execute(id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: unknown): Promise<{ content: Array<{ text?: string }>; isError?: boolean }>
    }
    const toolCtx = { model: { provider: "omo-mock", id: "mock-1" }, modelRegistry: registrySnapshot() }
    const text = (result: { content: Array<{ text?: string }> }) => result.content.map((part) => part.text ?? "").join("")

    const failed = await understand.execute("u1", { consent: true }, undefined, undefined, toolCtx)
    expect(text(failed)).toContain("scan did not run")
    const retried = [
      understand.execute("u2", { consent: true }, undefined, undefined, toolCtx),
      understand.execute("u3", { consent: true }, undefined, undefined, toolCtx),
    ]
    open()
    for (const result of await Promise.all(retried)) expect(text(result)).not.toContain("scan did not run")
    expect(flaky.calls()).toBe(2)
  })

  for (const entry of ["context", "forced-rpc", "bootstrap"]) {
    test(`#given ${entry} onboarding #when its skill pointer is resolved #then the actual skill file exists`, async () => {
      const h = createOnboardingHarness(freshDir(), entry, entry === "bootstrap" ? "tui" : "rpc")
      h.pi.setFlag("onboard", entry !== "context")
      await h.start()
      const results = await h.prompt()
      const message = entry === "bootstrap" ? h.pi.messages[0]?.message
        : (results[0] as { message: { content: unknown } }).message
      expect(typeof message?.content).toBe("string")
      const path = String(message?.content).match(/\S+\/onboarding\/SKILL\.md/)?.[0]
      expect(path).toBeDefined()
      expect(existsSync(resolve(path!))).toBe(true)
    })
  }
})
