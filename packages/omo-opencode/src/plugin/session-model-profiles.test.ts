import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSessionModelProfiles } from "./session-model-profiles"

function fixture(run: (args: { profiles: ReturnType<typeof createSessionModelProfiles>; path: string; config: Record<string, unknown>; reads: string[] }) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "omo-session-model-profiles-"))
  const project = join(root, "project")
  const path = join(project, ".omo", "omo.jsonc")
  mkdirSync(join(project, ".omo"), { recursive: true })
  const route = (model: string) => ({ "[opencode]": { agents: { explore: { model }, sisyphus: { model } }, categories: { quick: { model } } } })
  const config = { profiles: { quality: route("fixture/quality"), budget: route("fixture/budget") } }
  writeFileSync(path, JSON.stringify(config))
  const reads: string[] = []
  const profiles = createSessionModelProfiles({
    directory: project,
    environment: { HOME: root, USERPROFILE: root, OMO_PROFILE: "quality" },
    initialConfig: { agents: { explore: { model: "fixture/startup" } } },
    readSession: async (id) => { reads.push(id); return id.startsWith("child") ? { parentID: "parent" } : {} },
  })
  return run({ profiles, path, config, reads }).finally(() => rmSync(root, { recursive: true, force: true }))
}

describe("session model profiles", () => {
  test("native selection overrides startup selector for one parent and descendant dispatches without persisting", async () => {
    await fixture(async ({ profiles, path, reads }) => {
      const before = readFileSync(path, "utf8")
      const env = process.env.OMO_PROFILE
      expect(await profiles.command("parent", "list")).toContain("budget, quality")
      await profiles.command("parent", "budget")
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

  test("updates selected primary only, clears previous variant and restores startup model on clear", async () => {
    await fixture(async ({ profiles }) => {
      await profiles.command("parent", "budget")
      const primary = { id: "request-budget", model: { providerID: "fixture", modelID: "quality" }, variant: "high" } as Record<string, unknown>
      await profiles.applyPrimary("parent", "sisyphus", primary)
      expect(primary.model).toEqual({ providerID: "fixture", modelID: "budget" })
      expect(primary.variant).toBeUndefined()
      const child = { model: { providerID: "fixture", modelID: "resolved-child" }, variant: "low" }
      await profiles.applyPrimary("child-one", "explore", child)
      expect(child).toEqual({ model: { providerID: "fixture", modelID: "resolved-child" }, variant: "low" })
      await profiles.command("parent", "quality")
      expect(profiles.primaryConfig("parent", "request-budget")?.agents?.sisyphus?.model).toBe("fixture/budget")
      expect(profiles.primaryConfig("parent")?.agents?.sisyphus?.model).toBe("fixture/quality")
      await profiles.command("parent", "clear")
      await profiles.applyPrimary("parent", "sisyphus", primary)
      expect(primary.model).toEqual({ providerID: "fixture", modelID: "quality" })
      profiles.clearSession("parent")
      expect(profiles.primaryConfig("parent")).toBeUndefined()
    })
  })
})
