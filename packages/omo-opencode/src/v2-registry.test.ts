import { describe, expect, it } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import {
  registerCommandsV2,
  registerMcpV2,
  registerSkillsV2,
  renderCommandTemplate,
} from "./v2-registry"

describe("v2 registry", () => {
  it("renders command templates", () => {
    // given a builtin-style template
    const rendered = renderCommandTemplate("do $ARGUMENTS in $SESSION_ID at $TIMESTAMP ok $omo", {
      sessionID: "ses-1",
      argsText: "fix it",
    })

    // when rendered
    // then known placeholders are substituted, unknown dollars untouched
    expect(rendered).toMatch(/^do fix it in ses-1 at \d+ ok \$omo$/)
  })

  it("registers builtin skills without overwriting existing ones", async () => {
    // given a fake skill editor with one pre-existing skill
    const added: string[] = []
    const ctx = {
      location: { directory: "/tmp/v2-skill-test" },
      skill: {
        transform: async (callback: (editor: {
          get: (id: string) => unknown
          add: (skill: { id: string }) => void
        }) => void) => {
          callback({
            get: (id: string) => (id === "frontend" ? { id } : undefined),
            add: (skill: { id: string }) => {
              added.push(skill.id)
            },
          })
        },
      },
    }

    // when registered with empty plugin config
    await registerSkillsV2(ctx as unknown as Plugin.Context, {})

    // then builtin skills were added except the pre-existing one
    expect(added.length).toBeGreaterThan(0)
    expect(added).not.toContain("frontend")
  })

  it("registers builtin commands with prompt-submitting executors", async () => {
    // given a fake command editor and session prompter
    const added: { name: string; execute: (input: never) => Promise<void> }[] = []
    let prompted: { sessionID: string; text: string } | undefined
    const ctx = {
      command: {
        transform: async (callback: (editor: {
          add: (command: { name: string; execute: (input: never) => Promise<void> }) => void
        }) => void) => {
          callback({ add: (command) => { added.push(command) } })
        },
      },
      session: {
        prompt: async (input: { sessionID: string; text: string }) => {
          prompted = { sessionID: input.sessionID, text: input.text }
        },
      },
    }

    // when registered and the goal command runs
    await registerCommandsV2(ctx as unknown as Plugin.Context, {})
    const goal = added.find((command) => command.name === "goal")
    expect(goal).not.toBeUndefined()
    await goal?.execute({ sessionID: "ses-1", prompt: { text: "win" }, delivery: "steer" } as never)

    // then the template was rendered and submitted
    expect(prompted?.sessionID).toBe("ses-1")
    expect(prompted?.text).toContain("win")
  })

  it("registers builtin MCPs with v2 disabled polarity", async () => {
    // given a fake mcp editor
    const set: { name: string; config: { disabled?: boolean } }[] = []
    const ctx = {
      mcp: {
        transform: async (callback: (editor: {
          get: (name: string) => unknown
          set: (name: string, config: { disabled?: boolean }) => void
        }) => void) => {
          callback({
            get: () => undefined,
            set: (name, config) => { set.push({ name, config }) },
          })
        },
      },
    }

    // when registered
    await registerMcpV2(ctx as unknown as Plugin.Context, {}, "/tmp")

    // then servers were set with disabled:false (v1 enabled:true polarity flip)
    expect(set.length).toBeGreaterThan(0)
    for (const entry of set) {
      expect(entry.config.disabled).toBe(false)
    }
  })
})
