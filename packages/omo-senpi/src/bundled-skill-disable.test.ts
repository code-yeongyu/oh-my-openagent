import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

import { FakeExtensionAPI } from "../test-support/fake-extension-api"
import extension from "./extension/index"

const pluginRoot = resolve(import.meta.dir, "..", "plugin")
const pluginManifestPath = join(pluginRoot, "package.json")

type DiscoverEntry = string | { readonly path: string }

function skillNameFromPath(path: string): string {
  return basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path)
}

function isDiscoverResult(value: unknown): value is { readonly skillPaths?: readonly DiscoverEntry[] } {
  return typeof value === "object" && value !== null
}

/**
 * The Native surface's resolved skill set, mirroring senpi's resource loader:
 * 1. every `pi.skills` entry of the command-line package (`omo` always passes `--extension <plugin>`)
 *    loads unfiltered: no user-level denylist exists on that path, so a name listed there is
 *    present in every run;
 * 2. `resources_discover` contributions from the extension are appended afterwards.
 */
async function resolveNativeSkillNames(cwd: string): Promise<readonly string[]> {
  const names = new Set<string>()
  const manifest = JSON.parse(readFileSync(pluginManifestPath, "utf-8")) as { pi?: { skills?: string[] } }
  for (const entry of manifest.pi?.skills ?? []) {
    const dir = resolve(pluginRoot, entry)
    if (!existsSync(dir)) continue
    for (const child of readdirSync(dir)) {
      if (existsSync(join(dir, child, "SKILL.md"))) names.add(child)
    }
  }

  const pi = new FakeExtensionAPI()
  pi.cwd = cwd
  await extension(pi)
  const results = await pi.dispatch(
    "resources_discover",
    { type: "resources_discover", cwd, reason: "startup", scopedEntries: true },
    { cwd },
  )
  for (const result of results) {
    if (!isDiscoverResult(result)) continue
    for (const entry of result.skillPaths ?? []) {
      names.add(skillNameFromPath(typeof entry === "string" ? entry : entry.path))
    }
  }
  return [...names].sort()
}

describe("bundled skill disable on the Native surface", () => {
  const savedHome = process.env.HOME
  const savedUserProfile = process.env.USERPROFILE
  let home: string
  let cwd: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "omo-skill-disable-home-"))
    cwd = mkdtempSync(join(tmpdir(), "omo-skill-disable-cwd-"))
    process.env.HOME = home
    process.env.USERPROFILE = home
  })

  afterEach(() => {
    process.env.HOME = savedHome
    process.env.USERPROFILE = savedUserProfile
    rmSync(home, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it("#given an empty config #when the Native skill set resolves #then frontend and visual-qa are bundled", async () => {
    const names = await resolveNativeSkillNames(cwd)

    expect(names).toContain("frontend")
    expect(names).toContain("visual-qa")
  })

  it("#given disabled_skills names frontend and visual-qa in the user config #when the Native skill set resolves #then both are absent and the rest stay", async () => {
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify({ disabled_skills: ["frontend", "visual-qa"] }), "utf-8")

    const names = await resolveNativeSkillNames(cwd)

    expect(names).not.toContain("frontend")
    expect(names).not.toContain("visual-qa")
    expect(names).toContain("git-master")
  })

  it("#given user and project configs each disable a different skill #when the Native skill set resolves #then the denylists union", async () => {
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify({ disabled_skills: ["frontend"] }), "utf-8")
    mkdirSync(join(cwd, ".omo"), { recursive: true })
    writeFileSync(join(cwd, ".omo", "omo.jsonc"), JSON.stringify({ "[senpi]": { disabled_skills: ["visual-qa"] } }), "utf-8")

    const names = await resolveNativeSkillNames(cwd)

    expect(names).not.toContain("frontend")
    expect(names).not.toContain("visual-qa")
    expect(names).toContain("git-master")
  })
})
