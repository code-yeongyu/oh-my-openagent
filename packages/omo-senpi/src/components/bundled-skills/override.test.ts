import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createMemoryBinding } from "../memory/binding"
import { createMemoryIdentityContext } from "../memory/context"
import { createMemorySkillsScopeHandler } from "../memory/skills-scope"
import { createTaskSkillLoader, packagedSkillDirs } from "../task/task-skill-loader"
import { createBundledSkillsComponent, resolveBundledSkillsDir } from "./index"

const variable = "OMO_BUNDLED_SKILLS_DIR"
const context: ComponentContext = {
  logger: { info() {}, warn() {}, error() {} },
  config: { getFlag: () => undefined },
}
let root: string
let saved: string | undefined

beforeEach(() => {
  saved = process.env[variable]
  delete process.env[variable]
  root = mkdtempSync(join(tmpdir(), "bundled-skills-override-"))
})

afterEach(() => {
  if (saved === undefined) delete process.env[variable]
  else process.env[variable] = saved
  rmSync(root, { recursive: true, force: true })
})

function skill(dir: string, name: string, body = name): string {
  const file = join(dir, name, "SKILL.md")
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `---\nname: ${name}\ndescription: fixture skill\n---\n${body}\n`)
  return file
}

function layout(kind: "source" | "packaged") {
  const moduleDir = kind === "source"
    ? join(root, "packages/omo-senpi/src/components/task")
    : join(root, "runtime/plugin/extensions")
  mkdirSync(moduleDir, { recursive: true })
  const url = pathToFileURL(join(moduleDir, "module.js")).href
  const bundled = [
    resolve(moduleDir, "../../../plugin/skills"),
    resolve(moduleDir, "../skills"),
  ] as const
  const conditional = [
    resolve(moduleDir, "../../../plugin/skills-conditional"),
    resolve(moduleDir, "../skills-conditional"),
  ] as const
  for (const dir of [...bundled, ...conditional]) mkdirSync(dir, { recursive: true })
  return { url, bundled, conditional }
}

describe("bundled skill directory override", () => {
  for (const kind of ["source", "packaged"] as const) {
    for (const value of [undefined, ""]) {
      test(`#given ${kind} layout and ${value === undefined ? "absent" : "empty"} override #when resolving #then legacy paths and order are unchanged`, () => {
        const { url, bundled, conditional } = layout(kind)
        if (value !== undefined) process.env[variable] = value
        expect(resolveBundledSkillsDir(url)).toBe(bundled[1])
        expect(packagedSkillDirs(url)).toEqual([...bundled, ...conditional])
      })
    }

    test(`#given ${kind} layout and shared override #when resolving #then only bundled roots change and x-search remains plugin-relative`, () => {
      const { url, bundled, conditional } = layout(kind)
      const shared = join(root, "shared")
      skill(shared, "shared-skill")
      skill(shared, "skills-conditional", "NOT A CONDITIONAL ROOT")
      skill(conditional[0], "x-search", "PLUGIN CONDITIONAL")
      process.env[variable] = shared
      expect(resolveBundledSkillsDir(url)).toBe(shared)
      const dirs = packagedSkillDirs(url)
      expect(dirs).toEqual([shared, ...conditional])
      for (const dir of bundled) expect(dirs).not.toContain(dir)
      const loader = createTaskSkillLoader({
        homeDir: root, agentDir: join(root, "agent"), pluginSkillsDirs: dirs,
      })
      const result = loader(["shared-skill", "x-search"], root)
      expect(result.resolved).toEqual(["shared-skill", "x-search"])
      expect(result.prepend).toContain("PLUGIN CONDITIONAL")
    })
  }

  test("#given explicit skills dir and valid shared override #when resolving #then the explicit dir wins", async () => {
    const shared = join(root, "shared")
    const explicit = join(root, "explicit")
    skill(shared, "shared-skill")
    const file = skill(explicit, "explicit-skill")
    const env = { HOME: root, [variable]: shared }
    const pi = new FakeExtensionAPI()
    createBundledSkillsComponent({ env, skillsDir: explicit }).register(pi, context)
    expect(await pi.dispatch("resources_discover", { cwd: root })).toEqual([{ skillPaths: [file] }])
  })

  test("#given shared override #when resources discover #then contributions use the shared tree", async () => {
    const shared = join(root, "shared")
    const file = skill(shared, "shared-skill")
    process.env[variable] = shared
    const pi = new FakeExtensionAPI()
    createBundledSkillsComponent({ env: { HOME: root, [variable]: shared } }).register(pi, context)
    expect(await pi.dispatch("resources_discover", { cwd: root })).toEqual([{ skillPaths: [file] }])
  })

  test("#given shared override #when tasks load skills #then user and project roots retain priority", () => {
    const shared = join(root, "shared")
    const agentDir = join(root, "agent")
    skill(shared, "user-skill", "BUNDLED USER")
    skill(shared, "project-skill", "BUNDLED PROJECT")
    skill(shared, "shared-skill", "SHARED BODY")
    skill(join(agentDir, "skills"), "user-skill", "USER BODY")
    skill(join(root, ".agents/skills"), "project-skill", "PROJECT BODY")
    process.env[variable] = shared
    const result = createTaskSkillLoader({ homeDir: root, agentDir })(
      ["user-skill", "project-skill", "shared-skill"], root,
    )
    expect(result.resolved).toEqual(["user-skill", "project-skill", "shared-skill"])
    expect(result.prepend).toContain("USER BODY")
    expect(result.prepend).toContain("PROJECT BODY")
    expect(result.prepend).toContain("SHARED BODY")
    expect(result.prepend).not.toContain("BUNDLED")
  })

  test("#given shared override #when memory skills discover #then the bound memory root and user scope stay unchanged", () => {
    const shared = join(root, "shared")
    skill(shared, "shared-skill")
    process.env[variable] = shared
    const identityPaths = buildIdentityPaths(join(root, "memory"), "override-test")
    const memorySkills = join(identityPaths.repo, "skills")
    skill(memorySkills, "memory-skill")
    const memory = createMemoryIdentityContext({
      identity: "override-test", identityPaths,
      binding: createMemoryBinding({ identity: "override-test", repoPath: identityPaths.repo, boundAt: 0 }),
    })
    const discover = createMemorySkillsScopeHandler({ resolveContext: () => memory })
    expect(discover(
      { type: "resources_discover", cwd: root, scopedEntries: true },
      { sessionManager: { getSessionId: () => "session" } },
    )).toEqual({ skillPaths: [{ path: memorySkills, scope: "user" }] })
  })

  for (const invalid of ["relative", "missing", "file", "unreadable"] as const) {
    test(`#given ${invalid} override #when either loader resolves #then the plugin-relative skills are used and one error names the variable`, () => {
      const { url, bundled, conditional } = layout("packaged")
      const value = invalid === "relative" ? `relative/${basename(root)}` : join(root, invalid)
      if (invalid === "file") writeFileSync(value, "not a directory")
      if (invalid === "unreadable") mkdirSync(value)
      const accessSync = fs.accessSync
      const deniedAccess = invalid === "unreadable"
        ? spyOn(fs, "accessSync").mockImplementation((path, mode) => {
          if (path === value) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
          accessSync(path, mode)
        })
        : undefined
      process.env[variable] = value
      const errors: string[] = []
      const logger = { error: (message: string) => { errors.push(message) } }
      try {
        expect(resolveBundledSkillsDir(url, process.env, { logger })).toBe(bundled[1])
        expect(packagedSkillDirs(url, process.env, logger)).toEqual([...bundled, ...conditional])
        expect(errors).toHaveLength(1)
        expect(errors[0]).toContain(variable)
      } finally {
        deniedAccess?.mockRestore()
      }
    })
  }
})
