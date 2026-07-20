import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import extension from "./index"

describe("omo-senpi extension entry", () => {
  it("#given the real extension entry #when registered with a fake API #then all five implemented components are wired", async () => {
    const pi = new FakeExtensionAPI()

    await extension(pi)

    expect(pi.flags.map((flag) => flag.name)).toEqual(
      expect.arrayContaining([
        "omo-senpi-ultrawork-disabled",
        "omo-senpi-ulw-loop-disabled",
        "omo-senpi-comment-checker-disabled",
        "omo-senpi-telemetry-disabled",
        "omo-senpi-lsp-disabled",
        "omo-senpi-codegraph-disabled",
      ]),
    )
    expect(pi.handlers.map((handler) => handler.event)).toEqual(
      expect.arrayContaining(["input", "tool_result", "session_start"]),
    )
  })
})
