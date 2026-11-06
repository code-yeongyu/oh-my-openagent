import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext, ComponentLogger } from "../../extension/types"
import { createSkillCommandsComponent } from "../skill-commands"
import { createTaskComponent } from "../task"
import { createBundledSkillsComponent } from "./index"

// This suite is not about job widgets: keep the task component off the real senpi job-widget host.
const noJobWidgetHost = async (): Promise<Record<string, never>> => ({})

const variable = "OMO_BUNDLED_SKILLS_DIR"
let root: string
let saved: string | undefined

beforeEach(() => {
  saved = process.env[variable]
  delete process.env[variable]
  root = mkdtempSync(join(tmpdir(), "bundled-skills-invalid-"))
})

afterEach(() => {
  if (saved === undefined) delete process.env[variable]
  else process.env[variable] = saved
  rmSync(root, { recursive: true, force: true })
})

function recorder(): { readonly errors: string[]; readonly logger: ComponentLogger } {
  const errors: string[] = []
  return { errors, logger: { info() {}, warn() {}, error: (message) => { errors.push(message) } } }
}

function ctxFor(pi: FakeExtensionAPI, logger: ComponentLogger): ComponentContext {
  return { logger, config: { getFlag: (name) => pi.getFlag(name) }, getCapturedTools: () => [] }
}

function overrideErrors(errors: readonly string[]): readonly string[] {
  return errors.filter((message) => message.includes(variable))
}

function skillsFixture(name: string): string {
  const dir = join(root, "packaged")
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\nbody\n`)
  return dir
}

function invalidValue(kind: "relative" | "missing" | "unreadable"): string {
  if (kind === "relative") return `relative/${basename(root)}`
  const value = join(root, kind)
  if (kind === "unreadable") mkdirSync(value)
  return value
}

function denyAccess(value: string): { mockRestore(): void } {
  const accessSync = fs.accessSync
  return spyOn(fs, "accessSync").mockImplementation((path, mode) => {
    if (path === value) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
    accessSync(path, mode)
  })
}

describe("invalid bundled skills override at registration", () => {
  for (const kind of ["relative", "missing", "unreadable"] as const) {
    test(`#given a ${kind} override #when the task component registers twice #then the task tools register and one error names the variable`, async () => {
      // given
      const value = invalidValue(kind)
      const denied = kind === "unreadable" ? denyAccess(value) : undefined
      process.env[variable] = value
      const { errors, logger } = recorder()
      try {
        // when
        const first = new FakeExtensionAPI()
        await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => root }).register(first, ctxFor(first, logger))
        const second = new FakeExtensionAPI()
        await createTaskComponent({ loadJobWidgetHost: noJobWidgetHost, resolveCwd: () => root }).register(second, ctxFor(second, logger))

        // then
        for (const pi of [first, second]) {
          const names = pi.tools.map((tool) => tool["name"])
          expect(names).toContain("task")
          expect(names).toContain("task_send")
          expect(names).toContain("workflow")
        }
        expect(overrideErrors(errors)).toHaveLength(1)
      } finally {
        denied?.mockRestore()
      }
    })
  }

  test("#given an invalid override #when skill-commands registers #then the bare aliases still come from the packaged skills", async () => {
    // given
    process.env[variable] = invalidValue("relative")
    const packaged = skillsFixture("ulw-plan")
    const { errors, logger } = recorder()
    const unpinned = new FakeExtensionAPI()
    const pi = new FakeExtensionAPI()
    Object.assign(pi, { getCommands: () => [{ name: "skill:ulw-plan", source: "skill" }] })

    // when
    await createSkillCommandsComponent().register(unpinned, ctxFor(unpinned, logger))
    await createSkillCommandsComponent({ skillsDir: packaged }).register(pi, ctxFor(pi, logger))
    const input = pi.handlers.find((entry) => entry.event === "input")
    const rewritten = await input?.handler({ type: "input", text: "/ulw-plan", source: "interactive" }, undefined)

    // then
    expect(rewritten).toEqual({ action: "transform", text: "/skill:ulw-plan" })
    expect(overrideErrors(errors)).toHaveLength(1)
  })

  test("#given an invalid override #when bundled skills are discovered #then the packaged skills are contributed and the session is told once", async () => {
    // given
    const env = { HOME: root, [variable]: invalidValue("missing") }
    const packaged = skillsFixture("shared-skill")
    const { errors, logger } = recorder()
    const unpinned = new FakeExtensionAPI()
    createBundledSkillsComponent({ env }).register(unpinned, ctxFor(unpinned, logger))
    const pi = new FakeExtensionAPI()
    createBundledSkillsComponent({ env, skillsDir: packaged }).register(pi, ctxFor(pi, logger))
    const notices: { message: string; type: unknown }[] = []
    const eventCtx = { ui: { notify: (message: string, type: unknown) => notices.push({ message, type }) } }

    // when
    await unpinned.dispatch("resources_discover", { cwd: root })
    const first = await pi.dispatch("resources_discover", { cwd: root })
    const again = await pi.dispatch("resources_discover", { cwd: root })
    await pi.dispatch("session_start", {}, eventCtx)
    await pi.dispatch("session_start", {}, eventCtx)

    // then
    const expected = [{ skillPaths: [join(packaged, "shared-skill", "SKILL.md")] }]
    expect(first).toEqual(expected)
    expect(again).toEqual(expected)
    expect(overrideErrors(errors)).toHaveLength(1)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.type).toBe("error")
    expect(notices[0]?.message).toContain(variable)
  })
})
