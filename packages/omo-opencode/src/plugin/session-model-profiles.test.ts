import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { getFallbackModelsForSession } from "../hooks/runtime-fallback/fallback-models"
import { getSessionFallbackSnapshot } from "../shared/session-fallback-snapshot"
import { applyAgentVariant } from "../shared/agent-variant"
import { createSessionModelProfiles } from "./session-model-profiles"

function fixture(run: (args: { profiles: ReturnType<typeof createSessionModelProfiles>; path: string; config: Record<string, unknown>; reads: string[] }) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "omo-session-model-profiles-"))
  const project = join(root, "project")
  const path = join(project, ".omo", "omo.jsonc")
  mkdirSync(join(project, ".omo"), { recursive: true })
  const route = (model: string) => ({ "[opencode]": { agents: { explore: { model }, sisyphus: { model, fallback_models: [`${model}-fallback`] } }, categories: { quick: { model } } } })
  const config = { profiles: { quality: route("fixture/quality"), budget: route("fixture/budget") } }
  writeFileSync(path, JSON.stringify(config))
  const reads: string[] = []
  const profiles = createSessionModelProfiles({
    directory: project,
    environment: { HOME: root, USERPROFILE: root, OMO_PROFILE: "quality" },
    initialConfig: { agents: { explore: { model: "fixture/startup" } } },
    readSession: async (id) => { reads.push(id); return id.startsWith("child") ? { parentID: "parent" } : {} },
  })
  return run({ profiles, path, config, reads }).finally(() => {
    for (const id of ["parent", "other", "child-one"]) profiles.clearSession(id)
    rmSync(root, { recursive: true, force: true })
  })
}

describe("session model profiles", () => {
  test("default delegation reload never looks up session ancestry before any selection", async () => {
    await fixture(async ({ path, config }) => {
      let reads = 0
      const profiles = createSessionModelProfiles({
        directory: dirname(dirname(path)), initialConfig: {},
        environment: { HOME: dirname(dirname(dirname(path))) },
        readSession: async () => { reads++; throw new Error("session lookup unavailable") },
      })
      for (const extra of [{ unknown_key: true }, { telemetry: "invalid" }]) {
        writeFileSync(path, JSON.stringify({ ...config, "[opencode]": { agents: { explore: { model: "fixture/updated" } }, ...extra } }))
        expect((await profiles.load("default-parent")).agents?.explore?.model).toBe("fixture/updated")
      }
      expect(reads).toBe(0)
    })
  })

  test("terminal completion releases only its request snapshot and retains retry and tool steps", async () => {
    await fixture(async ({ profiles }) => {
      await profiles.select("parent", "budget")
      for (const id of ["active", "finished"]) await profiles.applyPrimary("parent", "sisyphus", { id })
      const recovery = profiles.beginRequestRecovery("parent")
      recovery.bind("active")
      recovery.commit()
      await profiles.select("parent", "quality")
      for (const info of [
        { parentID: "active", finish: "tool-calls", time: { completed: 1 } },
        { parentID: "active", finish: "stop", time: {} },
        { parentID: "active", finish: "stop", time: { completed: 1 }, error: { name: "APIError" } },
      ]) profiles.completeRequest("parent", info)
      expect(profiles.primaryConfig("parent", "active")?.agents?.sisyphus?.model).toBe("fixture/budget")
      profiles.completeRequest("parent", { parentID: "finished", finish: "stop", time: { completed: 1 } })
      profiles.completeRequest("parent", { parentID: "finished", finish: "stop", time: { completed: 1 } })
      expect(profiles.primaryConfig("parent", "finished")?.agents?.sisyphus?.model).toBe("fixture/quality")
      expect(profiles.primaryConfig("parent", "active")?.agents?.sisyphus?.model).toBe("fixture/budget")
      profiles.releaseRequest("parent", "active")
      expect(profiles.primaryConfig("parent", "active")?.agents?.sisyphus?.model).toBe("fixture/quality")
    })
  })

  test("a long successful session releases every completed primary snapshot", async () => {
    await fixture(async ({ profiles }) => {
      await profiles.select("parent", "budget")
      for (let n = 0; n < 150; n++) {
        await profiles.applyPrimary("parent", "sisyphus", { id: `turn-${n}` })
        profiles.completeRequest("parent", { parentID: `turn-${n}`, finish: "stop", time: { completed: n + 1 } })
      }
      await profiles.select("parent", "quality")
      for (let n = 0; n < 150; n++) expect(profiles.primaryConfig("parent", `turn-${n}`)?.agents?.sisyphus?.model).toBe("fixture/quality")
    })
  })

  test("a new primary turn retires terminal failed history", async () => {
    await fixture(async ({ profiles }) => {
      await profiles.select("parent", "budget")
      await profiles.applyPrimary("parent", "sisyphus", { id: "failed" })
      profiles.completeRequest("parent", { parentID: "failed", error: { name: "APIError" }, time: { completed: 1 } })
      await profiles.select("parent", "quality")
      await profiles.applyPrimary("parent", "sisyphus", { id: "new-user-turn" })
      expect(profiles.primaryConfig("parent", "failed")?.agents?.sisyphus?.model).toBe("fixture/quality")
    })
  })

  test.each(["primary", "synthetic"])("an active %s retry retains its snapshot across a newer user turn", async (kind) => {
    await fixture(async ({ profiles }) => {
      await profiles.select("parent", "budget")
      await profiles.applyPrimary("parent", "sisyphus", { id: "retrying" })
      const recovery = profiles.beginRequestRecovery("parent")
      recovery.bind("retrying")
      recovery.commit()
      profiles.completeRequest("parent", { parentID: "retrying", error: { name: "APIError" }, time: { completed: 1 } })
      await profiles.select("parent", "quality")
      if (kind === "primary") {
        const retry = { id: "retrying", model: { providerID: "fixture", modelID: "backup" } }
        expect((await profiles.applyPrimary("parent", "sisyphus", retry))?.agents?.sisyphus?.model).toBe("fixture/budget")
        expect(retry.model.modelID).toBe("backup")
      } else expect(profiles.resumeRequest("parent", "retrying")?.agents?.sisyphus?.model).toBe("fixture/budget")
      await profiles.applyPrimary("parent", "sisyphus", { id: "new-user-turn" })
      expect(profiles.primaryConfig("parent", "retrying")?.agents?.sisyphus?.model).toBe("fixture/budget")
    })
  })

  test("headless control returns safe errors and saved inspection preserves each accepted session", async () => {
    await fixture(async ({ profiles, path, config }) => {
      expect(await profiles.control("parent", "budget")).toEqual({ ok: true })
      const initial = await profiles.inspectRuntime("parent")
      expect(initial).toMatchObject({ ok: true, sessionID: "parent", source: "session", acceptedRevision: 1, saved: { valid: true, matchesAccepted: true } })
      expect(await profiles.inspectRuntime("child-one")).toEqual(initial)
      expect(await profiles.control("child-one", "quality")).toEqual({ ok: false, error: { code: "selection-rejected" } })
      for (const value of ["", " padded", "bad\nname", 2, {}, undefined]) {
        expect(await profiles.control("parent", value)).toEqual({ ok: false, error: { code: "invalid-profile" } })
      }
      expect(await profiles.control("parent", "PRIVATE_MISSING_PROFILE")).toEqual({ ok: false, error: { code: "selection-rejected" } })
      expect(await profiles.inspectRuntime("parent")).toEqual(initial)
      writeFileSync(path, JSON.stringify(config).replaceAll("fixture/budget", "fixture/pending"))
      expect(await profiles.inspectRuntime("parent")).toMatchObject({ acceptedRevision: 1, saved: { valid: true, matchesAccepted: false } })
      expect(profiles.primaryConfig("parent")?.agents?.explore?.model).toBe("fixture/budget")
      await profiles.load("parent")
      expect(await profiles.inspectRuntime("parent")).toMatchObject({ acceptedRevision: 2, lastReload: { outcome: "accepted" }, saved: { matchesAccepted: true } })
      writeFileSync(path, '{"PRIVATE_PARSE_SENTINEL":')
      expect(await profiles.inspectRuntime("parent")).toMatchObject({ acceptedRevision: 2, lastReload: { outcome: "accepted" }, saved: { valid: false, matchesAccepted: null } })
      await profiles.load("child-one")
      expect(await profiles.inspectRuntime("parent")).toMatchObject({ lastReload: { outcome: "rejected" } })
      expect(profiles.primaryConfig("parent")?.agents?.explore?.model).toBe("fixture/pending")
      const state = JSON.stringify(await profiles.inspectRuntime("parent"))
      expect(state).not.toContain("PRIVATE")
      expect(state).not.toContain(path)
      writeFileSync(path, JSON.stringify(config))
      expect(await profiles.control("parent", null)).toEqual({ ok: true })
      expect((await profiles.load("parent")).agents?.explore?.model).toBe("fixture/quality")
      expect(await profiles.inspectRuntime("other")).toMatchObject({ source: "startup", acceptedRevision: 1, lastReload: { outcome: "startup" } })
    })
  })

  test("safe inspection redacts session reader failures and instances do not share selectors", async () => {
    await fixture(async ({ profiles, path }) => {
      const other = createSessionModelProfiles({ directory: path, initialConfig: {}, environment: {}, readSession: async () => { throw new Error("PRIVATE_SESSION_TOKEN") } })
      expect(await other.inspectRuntime("unavailable")).toEqual({ ok: false, error: { code: "session-unavailable" } })
      expect(await other.control("unavailable", "budget")).toEqual({ ok: false, error: { code: "selection-rejected" } })
      expect(await profiles.control("parent", "budget")).toEqual({ ok: true })
      expect(await profiles.inspectRuntime("parent")).toMatchObject({ source: "session" })
      const isolated = createSessionModelProfiles({ directory: dirname(dirname(path)), initialConfig: {}, environment: { HOME: dirname(dirname(dirname(path))), OMO_PROFILE: "quality" }, readSession: async () => ({}) })
      expect((await isolated.inspect("parent")).profile).toBe("quality")
      expect(await isolated.inspectRuntime("parent")).toMatchObject({ source: "startup", acceptedRevision: 1 })
      expect((await isolated.load("parent")).agents?.explore?.model).toBe("fixture/quality")
      expect(profiles.primaryConfig("parent")?.agents?.explore?.model).toBe("fixture/budget")
      let rejectChange = false
      const failedCallback = createSessionModelProfiles({ directory: dirname(dirname(path)), initialConfig: {}, environment: { HOME: dirname(dirname(dirname(path))) }, readSession: async () => ({}), onSelectionChanged: () => { if (rejectChange) throw new Error("PRIVATE_CALLBACK") } })
      expect(await failedCallback.control("parent", "budget")).toEqual({ ok: true })
      rejectChange = true
      expect(await failedCallback.control("parent", "quality")).toEqual({ ok: false, error: { code: "selection-rejected" } })
      expect(failedCallback.primaryConfig("parent")?.agents?.explore?.model).toBe("fixture/budget")
    })
  })

  test("native selection overrides startup selector for one parent and descendant dispatches without persisting", async () => {
    await fixture(async ({ profiles, path, reads }) => {
      const before = readFileSync(path, "utf8")
      const env = process.env.OMO_PROFILE
      expect(await profiles.command("parent", "list")).toContain("budget, quality")
      await profiles.select("parent", "budget")
      expect(await profiles.inspect("child-one")).toEqual({ sessionID: "parent", profile: "budget", source: "session", availableProfiles: ["budget", "quality"] })
      expect((await profiles.load("parent")).agents?.explore?.model).toBe("fixture/budget")
      expect((await profiles.load("child-one")).categories?.quick?.model).toBe("fixture/budget")
      // Unselected sessions resolve their startup environment, independently of the parent's selection.
      expect((await profiles.load("other")).agents?.explore?.model).toBe("fixture/quality")
      expect(readFileSync(path, "utf8")).toBe(before)
      expect(process.env.OMO_PROFILE).toBe(env)
      expect(reads.filter((id) => id === "parent")).toHaveLength(1)
      await expect(profiles.command("child-one", "quality")).rejects.toThrow("parent session")
    })
  })

  test("rejects unknown and partial invalid selections atomically, retains snapshot, recovers valid edits", async () => {
    await fixture(async ({ profiles, path, config }) => {
      await profiles.command("parent", "budget")
      await expect(profiles.command("parent", "missing")).rejects.toThrow("does not exist")
      writeFileSync(path, '{"profiles":')
      await expect(profiles.command("parent", "quality")).rejects.toThrow()
      expect((await profiles.load("parent")).agents?.explore?.model).toBe("fixture/budget")
      writeFileSync(path, JSON.stringify({ ...config, "[opencode]": { categories: { broken: { model: 3 } } } }))
      await expect(profiles.command("parent", "quality")).rejects.toThrow()
      expect((await profiles.load("parent")).agents?.explore?.model).toBe("fixture/budget")
      writeFileSync(path, JSON.stringify(config).replaceAll("fixture/budget", "fixture/later"))
      expect((await profiles.load("parent")).agents?.explore?.model).toBe("fixture/later")
      await profiles.command("parent", "clear")
      expect((await profiles.load("parent")).agents?.explore?.model).toBe("fixture/quality")
    })
  })

  test("bare primary fallbacks inherit the effective host provider", async () => {
    await fixture(async ({ profiles, path }) => {
      writeFileSync(path, JSON.stringify({ profiles: { budget: { "[opencode]": { agents: { sisyphus: { fallback_models: ["backup"] } } } } } }))
      await profiles.select("parent", "budget")
      const message = { id: "fallback-only", model: { providerID: "host-provider", modelID: "host-model" } }
      await profiles.applyPrimary("parent", "sisyphus", message)
      expect(message.model).toEqual({ providerID: "host-provider", modelID: "host-model" })
      expect(getSessionFallbackSnapshot("parent")).toEqual([{ providers: ["host-provider"], model: "backup", variant: undefined }])
    })
  })

  test("uncovered agents preserve each new host model and variant", async () => {
    await fixture(async ({ profiles }) => {
      await profiles.select("parent", "budget")
      for (const [id, modelID, variant] of [["host-first", "host-one", "high"], ["host-second", "host-two", "low"]]) {
        const message = { id, model: { providerID: "host", modelID }, variant }
        await profiles.applyPrimary("parent", "bare-agent", message)
        expect(message).toEqual({ id, model: { providerID: "host", modelID }, variant })
      }
    })
  })

  test("removed overrides restore their baseline once and then accept later host choices", async () => {
    await fixture(async ({ profiles, path }) => {
      writeFileSync(path, JSON.stringify({ profiles: { quality: {}, budget: { "[opencode]": { agents: { sisyphus: { model: "fixture/budget", variant: "low" } } } } } }))
      await profiles.select("parent", "budget")
      const first = { id: "before-clear", model: { providerID: "host", modelID: "original" }, variant: "high" }
      await profiles.applyPrimary("parent", "sisyphus", first)
      expect(first.model.modelID).toBe("budget")
      expect(first.variant).toBe("low")
      await profiles.select("parent", undefined)
      const restored = { id: "after-clear", model: { providerID: "fixture", modelID: "budget" }, variant: "low" }
      await profiles.applyPrimary("parent", "sisyphus", restored)
      expect(restored.model).toEqual({ providerID: "host", modelID: "original" })
      expect(restored.variant).toBe("high")
      const later = { id: "host-later", model: { providerID: "host", modelID: "new-choice" }, variant: "medium" }
      await profiles.applyPrimary("parent", "sisyphus", later)
      expect(later.model.modelID).toBe("new-choice")
      expect(later.variant).toBe("medium")
      const retry = { id: "before-clear", model: { providerID: "fixture", modelID: "budget-fallback" }, variant: "minimal" }
      await profiles.applyPrimary("parent", "sisyphus", retry)
      expect(retry.model.modelID).toBe("budget-fallback")
      expect(retry.variant).toBe("minimal")
    })
  })

  test.each([
    ["new model and variant", "deliberate-new-choice", "medium", "deliberate-new-choice", "medium"],
    ["new variant only", "budget", "medium", "original", "medium"],
    ["new model only", "deliberate-new-choice", "low", "deliberate-new-choice", "high"],
    ["stale profile values", "budget", "low", "original", "high"],
  ])("selection-only clear preserves %s independently of stale fields", async (_, incomingModel, incomingVariant, expectedModel, expectedVariant) => {
    await fixture(async ({ profiles, path }) => {
      writeFileSync(path, JSON.stringify({ profiles: { quality: {}, budget: { "[opencode]": { agents: { sisyphus: { model: "fixture/budget", variant: "low" } } } } } }))
      await profiles.select("parent", "budget")
      await profiles.applyPrimary("parent", "sisyphus", { id: "selected", model: { providerID: "fixture", modelID: "original" }, variant: "high" })
      await profiles.select("parent", undefined)
      const next = { id: "first-after-clear", model: { providerID: "fixture", modelID: incomingModel }, variant: incomingVariant }
      await profiles.applyPrimary("parent", "sisyphus", next)
      expect(next.model).toEqual({ providerID: "fixture", modelID: expectedModel })
      expect(next.variant).toBe(expectedVariant)
      const later = { id: "later-after-clear", model: { providerID: "fixture", modelID: "budget" }, variant: "low" }
      await profiles.applyPrimary("parent", "sisyphus", later)
      expect(later.model.modelID).toBe("budget")
      expect(later.variant).toBe("low")
    })
  })

  test.each(["model", "reasoning"])("clearing %s variant suppression preserves a new host variant", async (field) => {
    await fixture(async ({ profiles, path }) => {
      const override = field === "model" ? { model: "fixture/budget" } : { reasoning: "low" }
      writeFileSync(path, JSON.stringify({ profiles: { quality: {}, budget: { "[opencode]": { agents: { sisyphus: override } } } } }))
      await profiles.select("parent", "budget")
      const first: Record<string, unknown> = { id: "suppressed", model: { providerID: "fixture", modelID: "original" }, variant: "high" }
      await profiles.applyPrimary("parent", "sisyphus", first)
      expect(first.variant).toBeUndefined()
      await profiles.select("parent", undefined)
      const next = { id: "explicit-after-suppression", model: { providerID: "fixture", modelID: "chosen" }, variant: "medium" }
      await profiles.applyPrimary("parent", "sisyphus", next)
      expect(next.model.modelID).toBe("chosen")
      expect(next.variant).toBe("medium")
    })
  })

  test.each(["low", "medium"])("clearing lowered reasoning handles incoming %s variant", async (incomingVariant) => {
    await fixture(async ({ profiles, path }) => {
      writeFileSync(path, JSON.stringify({ profiles: { quality: {}, budget: { "[opencode]": { agents: { sisyphus: { reasoning: "low" } } } } } }))
      await profiles.select("parent", "budget")
      const first = { id: "reasoning-first", model: { providerID: "openai", modelID: "gpt-6.1-sol" }, variant: "high" }
      const selected = await profiles.applyPrimary("parent", "sisyphus", first)
      if (!selected) throw new Error("Expected a selected primary config")
      applyAgentVariant(selected, "sisyphus", first, first.model)
      expect(first.variant).toBe("low")
      await profiles.select("parent", undefined)
      const next = { id: "after-reasoning-clear", model: { ...first.model }, variant: incomingVariant }
      await profiles.applyPrimary("parent", "sisyphus", next)
      expect(next.variant).toBe(incomingVariant === "low" ? "high" : "medium")
    })
  })

  test("updates selected primary only, clears previous variant and restores startup model on clear", async () => {
    await fixture(async ({ profiles }) => {
      await profiles.command("parent", "budget")
      const primary = { id: "request-budget", model: { providerID: "fixture", modelID: "quality" }, variant: "high" } as Record<string, unknown>
      await profiles.applyPrimary("parent", "sisyphus", primary)
      expect(primary.model).toEqual({ providerID: "fixture", modelID: "budget" })
      expect(primary.variant).toBeUndefined()
      const retry = { id: "request-budget", model: { providerID: "fixture", modelID: "budget-fallback" }, variant: "low" }
      await profiles.applyPrimary("parent", "sisyphus", retry)
      expect(retry.model.modelID).toBe("budget-fallback")
      expect(retry.variant).toBe("low")
      expect(getFallbackModelsForSession("parent", "sisyphus", { agents: { sisyphus: { fallback_models: ["fixture/startup-fallback"] } } })).toEqual(["fixture/budget-fallback"])
      const child = { model: { providerID: "fixture", modelID: "resolved-child" }, variant: "low" }
      await profiles.applyPrimary("child-one", "explore", child)
      expect(child).toEqual({ model: { providerID: "fixture", modelID: "resolved-child" }, variant: "low" })
      await profiles.command("parent", "quality")
      expect(profiles.primaryConfig("parent", "request-budget")?.agents?.sisyphus?.model).toBe("fixture/budget")
      expect(profiles.primaryConfig("parent")?.agents?.sisyphus?.model).toBe("fixture/quality")
      await profiles.command("parent", "clear")
      const otherAgent = { id: "other-agent-request", model: { providerID: "fixture", modelID: "other-agent-default" } }
      await profiles.applyPrimary("parent", "atlas", otherAgent)
      expect(otherAgent.model.modelID).toBe("other-agent-default")
      const implicitAgent = { id: "implicit-agent", agent: "sisyphus", model: { providerID: "fixture", modelID: "host-default" } }
      await profiles.applyPrimary("parent", undefined, implicitAgent)
      expect(implicitAgent.model.modelID).toBe("quality")
      expect(profiles.primaryConfig("parent", "request-budget")?.agents?.sisyphus?.model).toBe("fixture/budget")
      const olderRetry = { id: "request-budget", model: { providerID: "fixture", modelID: "budget-fallback" } }
      await profiles.applyPrimary("parent", "sisyphus", olderRetry)
      expect(olderRetry.model.modelID).toBe("budget-fallback")
      primary.id = "request-clear"
      await profiles.applyPrimary("parent", "sisyphus", primary)
      expect(primary.model).toEqual({ providerID: "fixture", modelID: "quality" })
      profiles.clearSession("parent")
      expect(profiles.primaryConfig("parent")).toBeUndefined()
      expect(getSessionFallbackSnapshot("parent")).toBeUndefined()
    })
  })
})
