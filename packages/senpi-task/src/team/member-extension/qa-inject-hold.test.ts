import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import type { Message } from "@oh-my-opencode/team-core/types"

import { createQaAfterInjectHold, QA_HOLD_AFTER_INJECT_ENV } from "./qa-inject-hold"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("member QA after-inject hold", () => {
  test("#given a hold path outside QA #when resolved #then the test hook stays disabled", () => {
    const hook = createQaAfterInjectHold({ [QA_HOLD_AFTER_INJECT_ENV]: "/tmp/hold" })

    expect(hook).toBeUndefined()
  })

  test("#given a QA release file #when an injected message enters the hook #then a marker is written before release", async () => {
    const root = mkdtempSync(join(tmpdir(), "senpi-member-hold-"))
    roots.push(root)
    const markerPath = join(root, "hold", "entered.json")
    mkdirSync(join(root, "hold"), { recursive: true })
    writeFileSync(`${markerPath}.release`, "release\n", "utf8")
    const hook = createQaAfterInjectHold({
      OMO_SENPI_QA: "1",
      [QA_HOLD_AFTER_INJECT_ENV]: markerPath,
    })
    if (hook === undefined) throw new Error("expected QA hold hook")

    await hook(message())

    expect(readFileSync(markerPath, "utf8")).toContain("22222222-2222-4222-8222-222222222222")
  })
})

function message(): Message {
  return {
    version: 1,
    messageId: "22222222-2222-4222-8222-222222222222",
    from: "lead",
    to: "member",
    kind: "message",
    body: "payload",
    timestamp: 1,
  }
}
