import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { ComponentContext } from "../../extension/types"
import { createSkillPointersComponent } from "../skill-pointers"
import { createSessionArming, createUltraworkComponent } from "../ultrawork"
import { createSkillCommandsComponent } from "./index"

type HostCommand = { name: string; description?: string; source: string }

const LOADED: HostCommand[] = [
  { name: "tasks", source: "extension" },
  { name: "skill:ulw-execute", description: "Executes a work plan.", source: "skill" },
  { name: "skill:ulw-plan", description: "Plans first.", source: "skill" },
  { name: "skill:ulw-loop", description: "Goal loop.", source: "skill" },
]

function skillsFixture(names: readonly string[]): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), "omo-skill-commands-"))
  for (const name of names) {
    mkdirSync(join(dir, name))
    writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: fixture\n---\nbody\n`)
  }
  mkdirSync(join(dir, "not-a-skill"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function context(pi: FakeExtensionAPI): ComponentContext {
  return { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: (name) => pi.getFlag(name) } }
}

function hostWith(commands: HostCommand[] | undefined): FakeExtensionAPI {
  const pi = new FakeExtensionAPI()
  if (commands !== undefined) Object.assign(pi, { getCommands: () => commands })
  return pi
}

// senpi's ExtensionRunner.emitInput threads each handler's transform into the next handler's event.
async function submit(
  pi: FakeExtensionAPI,
  text: string,
  options: { source?: string; images?: unknown[]; eventCtx?: unknown } = {},
): Promise<{ text: string; handled: boolean; images?: unknown }> {
  let current = text
  let images: unknown = options.images
  for (const registration of pi.handlers.filter((entry) => entry.event === "input")) {
    const event = { type: "input", text: current, source: options.source ?? "interactive", ...(images === undefined ? {} : { images }) }
    const result: unknown = await registration.handler(event, options.eventCtx)
    if (typeof result !== "object" || result === null) continue
    const action = Reflect.get(result, "action")
    if (action === "handled") return { text: current, handled: true }
    if (action === "transform") {
      current = String(Reflect.get(result, "text"))
      images = Reflect.get(result, "images") ?? images
    }
  }
  return { text: current, handled: false, images }
}

async function registerSkillCommands(pi: FakeExtensionAPI, dir: string): Promise<void> {
  await createSkillCommandsComponent({ skillsDir: dir }).register(pi, context(pi))
}

describe("skill-commands input rewrite", () => {
  test("#given ulw-execute is loaded #when the user submits /ulw-execute demo-plan #then it becomes the /skill: form with the args intact", async () => {
    const fixture = skillsFixture(["ulw-execute", "ulw-plan", "ulw-loop"])
    try {
      const pi = hostWith(LOADED)
      await registerSkillCommands(pi, fixture.dir)

      expect(await submit(pi, "/ulw-execute demo-plan --make-pr")).toEqual({
        text: "/skill:ulw-execute demo-plan --make-pr",
        handled: false,
        images: undefined,
      })
      expect((await submit(pi, "/ulw-plan")).text).toBe("/skill:ulw-plan")
      expect((await submit(pi, "/ulw-loop fix it\nsecond line")).text).toBe("/skill:ulw-loop fix it\nsecond line")
    } finally {
      fixture.cleanup()
    }
  })

  test("#given an attached image #when a bare skill command is rewritten #then the image rides along", async () => {
    const fixture = skillsFixture(["ulw-plan"])
    try {
      const pi = hostWith(LOADED)
      await registerSkillCommands(pi, fixture.dir)
      const image = { type: "image", data: "AA==", mimeType: "image/png" }

      expect(await submit(pi, "/ulw-plan this screen", { images: [image] })).toEqual({
        text: "/skill:ulw-plan this screen",
        handled: false,
        images: [image],
      })
    } finally {
      fixture.cleanup()
    }
  })

  test("#given inputs that do not name a bundled skill command #when submitted #then they pass through untouched", async () => {
    const fixture = skillsFixture(["ulw-execute"])
    try {
      const pi = hostWith(LOADED)
      await registerSkillCommands(pi, fixture.dir)

      for (const text of ["/ulw-executex plan", "/foo bar", " /ulw-execute plan", "run /ulw-execute plan", "/skill:ulw-execute plan", "/tasks"]) {
        expect(await submit(pi, text)).toEqual({ text, handled: false, images: undefined })
      }
      expect((await submit(pi, "/ulw-execute plan", { source: "extension" })).text).toBe("/ulw-execute plan")
    } finally {
      fixture.cleanup()
    }
  })

  test("#given a user prompt template or another command owns the name #when submitted #then the alias steps aside", async () => {
    const fixture = skillsFixture(["refactor"])
    try {
      const pi = hostWith([...LOADED, { name: "refactor", source: "prompt" }, { name: "skill:refactor", source: "skill" }])
      await registerSkillCommands(pi, fixture.dir)

      expect((await submit(pi, "/refactor src")).text).toBe("/refactor src")
    } finally {
      fixture.cleanup()
    }
  })

  test("#given the bundled skill is disabled #when its bare command is submitted #then nothing reaches the model and a warning names the skill", async () => {
    const fixture = skillsFixture(["ulw-research"])
    try {
      const pi = hostWith(LOADED)
      await registerSkillCommands(pi, fixture.dir)
      const notices: Array<{ message: string; type?: string }> = []
      const eventCtx = { ui: { notify: (message: string, type?: string) => notices.push({ message, type }) } }

      const result = await submit(pi, "/ulw-research why", { eventCtx })

      expect(result.handled).toBe(true)
      expect(notices).toEqual([{ message: expect.stringContaining("the ulw-research skill is disabled"), type: "warning" }])
    } finally {
      fixture.cleanup()
    }
  })

  test("#given a host without getCommands #when a bare skill command is submitted #then it is still rewritten", async () => {
    const fixture = skillsFixture(["ulw-execute"])
    try {
      const pi = hostWith(undefined)
      await registerSkillCommands(pi, fixture.dir)

      expect((await submit(pi, "/ulw-execute plan")).text).toBe("/skill:ulw-execute plan")
    } finally {
      fixture.cleanup()
    }
  })

  test("#given no bundled skills directory #when registered #then no handler is installed", async () => {
    const pi = hostWith(LOADED)
    await registerSkillCommands(pi, join(tmpdir(), "omo-skill-commands-missing"))

    expect(pi.handlers).toEqual([])
  })
})

describe("skill-commands ahead of the keyword components", () => {
  test("#given the real component order #when /ulw-execute or /ulw-loop is submitted #then ultrawork does not arm and no skill pointer is injected, while plain ulw still arms", async () => {
    const fixture = skillsFixture(["ulw-execute", "ulw-loop"])
    try {
      const pi = hostWith(LOADED)
      await registerSkillCommands(pi, fixture.dir)
      await createUltraworkComponent(createSessionArming()).register(pi, context(pi))
      await createSkillPointersComponent().register(pi, context(pi))

      const executed = await submit(pi, "/ulw-execute demo-plan")
      const looped = await submit(pi, "/ulw-loop make hello.txt")

      expect(executed.text).toBe("/skill:ulw-execute demo-plan")
      expect(looped.text).toBe("/skill:ulw-loop make hello.txt")
      expect(pi.messages.map((call) => call.message["customType"])).toEqual([])

      await submit(pi, "ulw make hello.txt")
      expect(pi.messages.map((call) => call.message["customType"])).toContain("omo-ultrawork:directive")
    } finally {
      fixture.cleanup()
    }
  })
})
