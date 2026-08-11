/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { SENPI_ULTRAWORK_DIRECTIVE } from "./generated-directive"
import { armingSnapshot, classifyUltraworkInput, createSessionArming, createUltraworkComponent } from "./index"
import {
  createTestContext,
  dispatchInput,
  expectHiddenInjection,
  expectReminderMessage,
  registerIsolatedUltrawork,
  seedSharedArmingSlot,
  sessionEventCtx,
} from "./ultrawork.test-support"

describe("omo-senpi ultrawork once-per-session arming", () => {
  it("#given an armed session #when a second trigger dispatches #then injects a short reminder instead of the full directive", async () => {
    // given: the first trigger of a session arms the full directive once
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    await dispatchInput(pi, "ulw first pass")
    expect(pi.messages[0]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)

    // when
    const result = await dispatchInput(pi, "ulw second pass")

    // then: the transcript already holds the directive, so only a nudge rides in
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages).toHaveLength(2)
    expectReminderMessage(pi, 1)
  })

  it("#given an armed session #when the session compacts #then the next trigger injects the full directive again", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    await dispatchInput(pi, "ulw first pass")

    // when: an accepted compaction drops the transcript block that held the directive
    await pi.dispatch("session_compact", { type: "session_compact", accepted: true }, sessionEventCtx("session-a"))
    const result = await dispatchInput(pi, "ulw after compact")

    // then
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages).toHaveLength(2)
    expect(pi.messages[1]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
  })

  it("#given an armed session #when a compaction is rejected #then the next trigger stays a reminder", async () => {
    // given: a rejected compaction leaves the transcript (and the directive) intact
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    await dispatchInput(pi, "ulw first pass")

    // when
    await pi.dispatch("session_compact", { type: "session_compact", accepted: false }, sessionEventCtx("session-a"))
    const result = await dispatchInput(pi, "ulw after rejected compact")

    // then
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages).toHaveLength(2)
    expectReminderMessage(pi, 1)
  })

  it("#given one live session #when triggers span rejected and accepted compactions #then the directive-reminder sequence stays pinned", async () => {
    // given: a fresh session has no directive in its transcript
    const pi = new FakeExtensionAPI()
    const arming = createSessionArming()
    await createUltraworkComponent(arming).register(pi, createTestContext(pi))
    await pi.dispatch("session_start", {}, sessionEventCtx("session-characterization"))

    // when: first trigger, repeat trigger, rejected compact, then accepted compact
    await dispatchInput(pi, "ulw first")
    await dispatchInput(pi, "ulw second")
    await pi.dispatch("session_compact", { type: "session_compact", accepted: false }, sessionEventCtx("session-characterization"))
    await dispatchInput(pi, "ulw after rejected compact")
    await pi.dispatch("session_compact", { type: "session_compact", accepted: true }, sessionEventCtx("session-characterization"))
    await dispatchInput(pi, "ulw after accepted compact")

    // then: only accepted compaction permits the full directive to return
    expect(pi.messages).toHaveLength(4)
    expect(pi.messages[0]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
    expectReminderMessage(pi, 1)
    expectReminderMessage(pi, 2)
    expect(pi.messages[3]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
  })

  it("#given suppression routes #when matching text dispatches #then no message emits and the session ledger stays unarmed", async () => {
    const cases = [
      { name: "/skill prefix", text: "/skill:myulw run it", source: "interactive", disabled: false },
      { name: "disabled flag", text: "ulw fix this", source: "interactive", disabled: true },
      { name: "extension source", text: "ultrawork again", source: "extension", disabled: false },
    ] as const

    for (const testCase of cases) {
      // given
      const pi = new FakeExtensionAPI()
      const arming = createSessionArming()
      pi.setFlag("omo-senpi-ultrawork-disabled", testCase.disabled)
      await createUltraworkComponent(arming).register(pi, createTestContext(pi))
      await pi.dispatch("session_start", {}, sessionEventCtx(`session-${testCase.name}`))

      // when
      const result = await dispatchInput(pi, testCase.text, testCase.source)

      // then
      expect(result).toEqual({ action: "continue" })
      expect(pi.messages).toHaveLength(0)
      expect(arming.isArmed(`session-${testCase.name}`)).toBe(false)
    }
  })

  it("#given shared arming state #when snapshot is read three times #then every read is identical and the ledger stays unchanged", () => {
    // given
    const arming = createSessionArming()
    arming.markArmed("session-snapshot")
    arming.rearmOnCompact("session-snapshot")
    const restoreSlot = seedSharedArmingSlot({ directive: SENPI_ULTRAWORK_DIRECTIVE, arming })

    try {
      const before = {
        armed: arming.isArmed("session-snapshot"),
        pending: arming.isCompactRearmPending?.("session-snapshot") ?? false,
      }

      // when
      const snapshots = [
        armingSnapshot("session-snapshot"),
        armingSnapshot("session-snapshot"),
        armingSnapshot("session-snapshot"),
      ]

      // then
      expect(snapshots).toEqual([
        { wasArmed: false, compactRearmPending: true },
        { wasArmed: false, compactRearmPending: true },
        { wasArmed: false, compactRearmPending: true },
      ])
      expect({
        armed: arming.isArmed("session-snapshot"),
        pending: arming.isCompactRearmPending?.("session-snapshot") ?? false,
      }).toEqual(before)
    } finally {
      restoreSlot()
    }
  })

  it("#given pre-mutation snapshots #when effective prompts are classified #then every arming stage is distinguishable", () => {
    const input = { text: "ulw ship it", source: "interactive" as const }

    expect(classifyUltraworkInput(input, { wasArmed: false, compactRearmPending: false }).stage).toBe("first_arm")
    expect(classifyUltraworkInput(input, { wasArmed: true, compactRearmPending: false }).stage).toBe("remention")
    expect(classifyUltraworkInput(input, { wasArmed: false, compactRearmPending: true }).stage).toBe("post_compact_rearm")
  })

  it("#given a known fresh session #when the first trigger dispatches #then injects the full directive byte-identically", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))

    // when
    const result = await dispatchInput(pi, "ulw first pass")

    // then
    expectHiddenInjection(pi, result)
  })

  it("#given an armed session #when a queued trigger dispatches #then the transform appends the reminder not the directive", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    const first = await dispatchInput(pi, "ulw queued first", "interactive", "steer")
    expect(first).toEqual({ action: "transform", text: `ulw queued first\n${SENPI_ULTRAWORK_DIRECTIVE}` })

    // when
    const prompt = "ulw queued second"
    const result = await dispatchInput(pi, prompt, "interactive", "steer")

    // then: still atomic with the queued message, but only the short reminder
    expect(pi.messages).toHaveLength(0)
    expect(result).toMatchObject({ action: "transform" })
    if (result.action !== "transform") {
      throw new Error("expected a transform result")
    }
    const text = result.text
    expect(text.startsWith(`${prompt}\n`)).toBe(true)
    const appended = text.slice(prompt.length + 1)
    expect(appended.length).toBeLessThan(400)
    expect(appended).not.toContain("<ultrawork-mode>")
  })

  it("#given a pasted directive block #when the next plain trigger dispatches #then injects the reminder not a second full copy", async () => {
    // given: the pasted transcript already carries the full directive
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    await dispatchInput(pi, "이 기록 확인해줘 <ultrawork-mode>\n# Role\n</ultrawork-mode> 그리고 ulw 모드로 부탁해")
    expect(pi.messages).toHaveLength(0)

    // when
    const result = await dispatchInput(pi, "ulw keep going")

    // then
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages).toHaveLength(1)
    expectReminderMessage(pi, 0)
  })

  it("#given /skill:ultrawork expanded inline #when the next plain trigger dispatches #then injects the reminder not a second full copy", async () => {
    // given: the skill expansion inlines the full SKILL.md, whose body IS the directive
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    await dispatchInput(pi, "/skill:ultrawork fix this login bug")
    expect(pi.messages).toHaveLength(0)

    // when
    const result = await dispatchInput(pi, "ulw keep going")

    // then
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages).toHaveLength(1)
    expectReminderMessage(pi, 0)
  })

  it("#given two armed sessions #when switching back to the first #then the next trigger is the reminder", async () => {
    // given: both sessions hold the directive in their own transcripts
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    await dispatchInput(pi, "ulw in a")
    await pi.dispatch("session_start", {}, sessionEventCtx("session-b"))
    await dispatchInput(pi, "ulw in b")
    expect(pi.messages).toHaveLength(2)

    // when: back in session A; dropping its arming here would re-inject ~17KB it still holds
    await pi.dispatch("session_before_switch", {}, sessionEventCtx("session-b"))
    await pi.dispatch("session_start", {}, sessionEventCtx("session-a"))
    const result = await dispatchInput(pi, "ulw in a again")

    // then
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages).toHaveLength(3)
    expect(pi.messages[0]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
    expect(pi.messages[1]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
    expectReminderMessage(pi, 2)
  })

  it("#given the input event ctx carries the session id #when a second trigger dispatches #then injects the reminder without any session events", async () => {
    // given
    const pi = new FakeExtensionAPI()
    await registerIsolatedUltrawork(pi)
    await dispatchInput(pi, "ulw first pass", "interactive", undefined, sessionEventCtx("session-a"))

    // when
    const result = await dispatchInput(pi, "ulw second pass", "interactive", undefined, sessionEventCtx("session-a"))

    // then
    expect(result).toEqual({ action: "continue" })
    expect(pi.messages).toHaveLength(2)
    expect(pi.messages[0]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
    expectReminderMessage(pi, 1)
  })

  it("#given an armed session #when the component re-registers on resume #then the next trigger is the reminder not the full directive", async () => {
    // given: senpi tears down the extension runner on a session switch or resume
    // and re-registers every component in the same process; the first registration
    // already armed the session with the full directive.
    const piBeforeResume = new FakeExtensionAPI()
    await createUltraworkComponent().register(piBeforeResume, createTestContext(piBeforeResume))
    await piBeforeResume.dispatch("session_start", {}, sessionEventCtx("session-resumed"))
    await dispatchInput(piBeforeResume, "ulw first pass")
    expect(piBeforeResume.messages[0]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)

    // when: the replacement runner re-registers the component and the resumed
    // session triggers again — its transcript still holds the directive block.
    const piAfterResume = new FakeExtensionAPI()
    await createUltraworkComponent().register(piAfterResume, createTestContext(piAfterResume))
    await piAfterResume.dispatch("session_start", {}, sessionEventCtx("session-resumed"))
    const result = await dispatchInput(piAfterResume, "ulw keep going")

    // then: only the short reminder rides in; re-injecting ~17KB here is the
    // token burn this feature exists to stop.
    expect(result).toEqual({ action: "continue" })
    expect(piAfterResume.messages).toHaveLength(1)
    expectReminderMessage(piAfterResume, 0)
  })

  it("#given the packaged extension reloaded uncached #when the same session triggers on the second load #then injects the reminder not the full directive", async () => {
    // given: senpi loads packaged extensions through an UNCACHED importer (Jiti
    // `moduleCache: false` in core/extensions/loader.ts), so every load re-evaluates
    // the whole bundle and rebuilds each module-scope binding. A query-suffixed
    // RELATIVE import reproduces that boundary in-process: Bun keys its module cache
    // on the full specifier, so each query variant evaluates fresh (a file:// URL
    // drops the query and would NOT bust the cache).
    const loadPackagedExtension = async (reload: number): Promise<(pi: unknown) => Promise<void>> => {
      const module = (await import(`../../../plugin/extensions/omo.js?reload=${reload}`)) as {
        default: (pi: unknown) => Promise<void>
      }
      return module.default
    }

    // load #1 arms the session with the full directive
    const piBeforeReload = new FakeExtensionAPI()
    await (await loadPackagedExtension(1))(piBeforeReload)
    await piBeforeReload.dispatch("session_start", {}, sessionEventCtx("session-reload"))
    await dispatchInput(piBeforeReload, "ulw first pass")
    const firstInjection = piBeforeReload.messages.find((call) => call.message["customType"] === "omo-ultrawork:directive")
    expect(firstInjection?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)

    // when: the host reloads the packaged extension (fresh module evaluation) and
    // the SAME session triggers again — its transcript still holds the directive.
    const piAfterReload = new FakeExtensionAPI()
    await (await loadPackagedExtension(2))(piAfterReload)
    await piAfterReload.dispatch("session_start", {}, sessionEventCtx("session-reload"))
    await dispatchInput(piAfterReload, "ulw keep going")

    // then: the arming ledger survived re-evaluation, so only the short reminder
    // rides in; re-emitting ~29KB here is the token burn this feature exists to stop.
    const reinjection = piAfterReload.messages.find((call) => call.message["customType"] === "omo-ultrawork:directive")
    const content = reinjection?.message["content"]
    if (typeof content !== "string") {
      throw new Error("expected one ultrawork injection after reload")
    }
    expect(content.length).toBeLessThan(400)
    expect(content).not.toContain("<ultrawork-mode>")
  })

  it("#given a slot left under different directive text #when the bundle re-evaluates #then the session is not armed and receives the full directive", async () => {
    // given: an earlier bundle evaluation armed the session and left the REAL
    // slot shape — { directive, arming } — on the process-global registry, tagged
    // with directive text the CURRENT directive no longer matches (omo.js or
    // SENPI_ULTRAWORK_DIRECTIVE changed mid-process). `arming` is present and IS
    // the stale ledger, so the directive-text mismatch alone must discard it.
    const staleLedger = createSessionArming()
    staleLedger.markArmed("session-upgraded")
    const restoreSlot = seedSharedArmingSlot({ directive: "<ultrawork-mode>\nstale directive text\n</ultrawork-mode>", arming: staleLedger })
    try {
      // when: the reloaded bundle constructs its component against the shared slot
      const pi = new FakeExtensionAPI()
      await createUltraworkComponent().register(pi, createTestContext(pi))
      await pi.dispatch("session_start", {}, sessionEventCtx("session-upgraded"))
      const result = await dispatchInput(pi, "ulw after upgrade")

      // then: the directive mismatch discards the stale ledger, so the session gets
      // the FULL directive again — never a reminder pointing at rules its
      // transcript no longer holds.
      expect(result).toEqual({ action: "continue" })
      expect(pi.messages).toHaveLength(1)
      expect(pi.messages[0]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
    } finally {
      restoreSlot()
    }
  })

  it("#given a bare ledger left by a pre-slot bundle #when the bundle re-evaluates #then the session is not armed and receives the full directive", async () => {
    // given: the oldest bundles wrote the ledger ITSELF to the process-global
    // registry — no { directive, arming } wrapper at all. That legacy shape has
    // no directive to match, so it must be discarded like a mismatched one.
    const staleLedger = createSessionArming()
    staleLedger.markArmed("session-upgraded")
    const restoreSlot = seedSharedArmingSlot(staleLedger)
    try {
      // when
      const pi = new FakeExtensionAPI()
      await createUltraworkComponent().register(pi, createTestContext(pi))
      await pi.dispatch("session_start", {}, sessionEventCtx("session-upgraded"))
      const result = await dispatchInput(pi, "ulw after upgrade")

      // then
      expect(result).toEqual({ action: "continue" })
      expect(pi.messages).toHaveLength(1)
      expect(pi.messages[0]?.message["content"]).toBe(SENPI_ULTRAWORK_DIRECTIVE)
    } finally {
      restoreSlot()
    }
  })
})
