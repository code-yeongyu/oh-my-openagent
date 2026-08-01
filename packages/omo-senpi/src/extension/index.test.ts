import { describe, expect, it } from "bun:test"

import { createConfigWatchComponent } from "../components/config-watch"
import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { composeOmoSenpiExtension } from "./compose"
import type { ComponentLogger } from "./types"
import extension from "./index"

function createRecordingLogger(): ComponentLogger & { entries: Array<{ level: string; message: string; details?: unknown }> } {
  const entries: Array<{ level: string; message: string; details?: unknown }> = []
  return {
    entries,
    info(message, details) {
      entries.push({ level: "info", message, details })
    },
    warn(message, details) {
      entries.push({ level: "warn", message, details })
    },
    error(message, details) {
      entries.push({ level: "error", message, details })
    },
  }
}

function containsTodoContinuity(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("<omo-todo-continuity>") || value.includes("todo items remain open")
  }
  if (value === null || typeof value !== "object") {
    return false
  }
  return Object.values(value).some(containsTodoContinuity)
}

describe("omo-senpi extension entry", () => {
  it("#given the real extension entry #when registered with a fake API #then configured components are wired", async () => {
    const pi = new FakeExtensionAPI()

    await extension(pi)

    expect(pi.flags.map((flag) => flag.name)).toEqual(
      expect.arrayContaining([
        "omo-senpi-config-startup-disabled",
        "omo-senpi-ultrawork-disabled",
        "omo-senpi-ulw-loop-disabled",
        "omo-senpi-fallback-architect-disabled",
        "omo-senpi-comment-checker-disabled",
        "omo-senpi-telemetry-disabled",
        "omo-senpi-lsp-disabled",
        "omo-senpi-codegraph-disabled",
        "omo-senpi-config-watch-disabled",
      ]),
    )
    expect(pi.handlers.map((handler) => handler.event)).toEqual(
      expect.arrayContaining(["input", "tool_result", "session_start", "model_select", "message_end"]),
    )
  })

  it("#given open todo state #when ordinary input arrives #then the extension does not inject continuity guidance", async () => {
    const pi = new FakeExtensionAPI()
    await extension(pi)

    const results = await pi.dispatch(
      "input",
      { type: "input", text: "ordinary follow-up", source: "interactive" },
      {
        cwd: "/repo",
        sessionManager: {
          getBranch() {
            return [
              {
                type: "custom",
                customType: "senpi.todo-state",
                data: {
                  schema: "v2",
                  phases: [
                    {
                      name: "Current",
                      tasks: [{ content: "keep working", status: "pending" }],
                    },
                  ],
                },
              },
            ]
          },
        },
      },
    )

    expect([...results, ...pi.messages].some(containsTodoContinuity)).toBe(false)
  })

  it("#given config-watch disabled by flag #when composed #then it emits no registration and no warning", async () => {
    const pi = new FakeExtensionAPI()
    const emitted: Array<{ name: string; payload: unknown }> = []
    const logger = createRecordingLogger()
    pi.setFlag("omo-senpi-config-watch-disabled", true)
    pi.events = {
      emit(name, payload) {
        emitted.push({ name, payload })
      },
      on() {
        return () => undefined
      },
    }

    await composeOmoSenpiExtension([createConfigWatchComponent()], { logger })(pi)

    expect(pi.flags.map((flag) => flag.name)).toEqual([
      "omo-senpi-disabled",
      "omo-senpi-config-watch-disabled",
    ])
    expect(emitted).toEqual([])
    expect(logger.entries).toEqual([
      {
        level: "info",
        message: "omo-senpi component disabled by flag",
        details: { component: "config-watch" },
      },
    ])
  })
})
