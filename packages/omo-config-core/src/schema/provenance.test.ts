import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig, OmoConfigLayerSchema, OmoConfigProfileSchema, OmoConfigSchema, OmoTypedHarnessConfigSchema } from "../index"

const provenance = { workspaces: [{ name: "Example workspace", git_owners: ["example-owner"], paths: ["~/projects"] }] }
let root: string | undefined
afterEach(() => { if (root !== undefined) rmSync(root, { recursive: true, force: true }); root = undefined })

test("#given a provenance table #when parsing every config layer #then labels and matching rules survive", () => {
  for (const schema of [OmoConfigSchema, OmoConfigLayerSchema, OmoConfigProfileSchema, OmoTypedHarnessConfigSchema]) {
    expect(schema.parse({ provenance }).provenance).toEqual(provenance)
  }
  expect(OmoConfigSchema.parse({}).provenance).toBeUndefined()
})

test("#given malformed workspace rules #when parsing the config #then invalid labels lists and unknown keys are rejected", () => {
  for (const row of [{ name: "" }, { name: " " }, { name: 1 }, { name: "example", git_owners: "owner" }, { name: "example", paths: [1] }, { name: "example", extra: true }]) {
    expect(OmoConfigSchema.safeParse({ provenance: { workspaces: [row] } }).success).toBe(false)
  }
})

test("#given user project harness and profile tables #when loading a native profile #then the resolved table uses normal precedence", () => {
  root = mkdtempSync(join(tmpdir(), "omo-provenance-config-"))
  const cwd = join(root, "project")
  mkdirSync(join(root, ".omo"), { recursive: true })
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(root, ".omo", "omo.json"), JSON.stringify({ provenance, "[native]": { provenance: { workspaces: [{ name: "Harness" }] } } }))
  writeFileSync(join(cwd, ".omo", "omo.json"), JSON.stringify({
    provenance: { workspaces: [{ name: "Project" }] },
    profiles: { review: { provenance: { workspaces: [{ name: "Profile" }] }, "[native]": { provenance } } },
  }))
  const loaded = loadOmoConfig({ cwd, env: { HOME: root, OMO_PROFILE: "review" }, harness: "native" })
  expect(loaded.diagnostics).toEqual([])
  expect(loaded.config.provenance).toEqual(provenance)
})
