/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import { maybeAutoPrintPanel, _resetAutoPrintForTests } from "./command-handler"
import { _resetAllForTests } from "./state"
import type { OhMyOpenCodeConfig } from "../../config"

const configOn = {
  display: { show_models_on_session_start: true },
  agents: {
    sisyphus: { model: "anthropic/claude-opus-4-7", variant: "max" },
  },
} as unknown as OhMyOpenCodeConfig

const configOff = {
  display: { show_models_on_session_start: false },
  agents: {
    sisyphus: { model: "anthropic/claude-opus-4-7", variant: "max" },
  },
} as unknown as OhMyOpenCodeConfig

function freshOutput(): { parts: Array<{ type: string; text?: string; id?: string; sessionID?: string; messageID?: string }> } {
  return { parts: [] }
}

describe("maybeAutoPrintPanel", () => {
  beforeEach(() => {
    _resetAllForTests()
    _resetAutoPrintForTests()
  })

  test("#given config flag on and messageID present #when called first time #then injects a part with id/sessionID/messageID and the panel text", () => {
    const output = freshOutput()
    maybeAutoPrintPanel("s1", "msg_1", output, configOn)

    expect(output.parts).toHaveLength(1)
    const part = output.parts[0]
    expect(part.type).toBe("text")
    expect(part.text).toContain("Roles · Models")
    expect(part.text).toContain("sisyphus")
    expect(part.sessionID).toBe("s1")
    expect(part.messageID).toBe("msg_1")
    expect(part.id).toMatch(/^prt_/)
  })

  test("#given config flag on #when called twice in same session #then injects only once", () => {
    const out1 = freshOutput()
    const out2 = freshOutput()
    maybeAutoPrintPanel("s1", "msg_1", out1, configOn)
    maybeAutoPrintPanel("s1", "msg_2", out2, configOn)

    expect(out1.parts).toHaveLength(1)
    expect(out2.parts).toHaveLength(0)
  })

  test("#given config flag off #when called #then does nothing", () => {
    const output = freshOutput()
    maybeAutoPrintPanel("s1", "msg_1", output, configOff)

    expect(output.parts).toHaveLength(0)
  })

  test("#given config undefined #when called #then does nothing", () => {
    const output = freshOutput()
    maybeAutoPrintPanel("s1", "msg_1", output, undefined)

    expect(output.parts).toHaveLength(0)
  })

  test("#given messageID undefined #when called #then skips injection (would create an invalid part)", () => {
    const output = freshOutput()
    maybeAutoPrintPanel("s1", undefined, output, configOn)

    expect(output.parts).toHaveLength(0)
  })

  test("auto-print state is per-session", () => {
    const out1 = freshOutput()
    const out2 = freshOutput()
    maybeAutoPrintPanel("s1", "msg_1", out1, configOn)
    maybeAutoPrintPanel("s2", "msg_2", out2, configOn)

    expect(out1.parts).toHaveLength(1)
    expect(out2.parts).toHaveLength(1)
  })
})
