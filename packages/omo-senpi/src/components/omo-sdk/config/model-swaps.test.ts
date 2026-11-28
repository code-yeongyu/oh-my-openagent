import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

import {
  assistantTurn,
  configSandbox,
  type ConfigSandbox,
  errorOf,
  modelChange,
  valueOf,
} from "./config-sandbox.test-support"

let sandbox: ConfigSandbox
afterEach(() => sandbox.cleanup())

const OPUS_55 = "anthropic/claude-opus-5-5"
const OPUS_5 = "anthropic/claude-opus-5"

const record = [
  modelChange("2026-11-09T12:00:01.000Z", OPUS_55),
  assistantTurn("2026-11-09T12:01:00.000Z", OPUS_55),
  modelChange("2026-11-09T12:11:27.105Z", OPUS_5, "fallback", OPUS_55),
  assistantTurn("2026-11-09T12:11:40.000Z", OPUS_5),
  modelChange("2026-11-09T12:12:39.953Z", OPUS_55, "fallback-revert", OPUS_5),
  assistantTurn("2026-11-09T12:13:00.000Z", OPUS_55),
  assistantTurn("2026-11-09T12:14:00.000Z", OPUS_55),
  modelChange("2026-11-09T12:20:00.000Z", OPUS_5, "fallback", OPUS_55),
  assistantTurn("2026-11-09T12:21:00.000Z", OPUS_5),
]

describe("config.modelSwaps", () => {
  test("#given a record with two fallback and one fallback-revert entries #when it is read #then three swaps, an open window and turns per model answer", async () => {
    sandbox = configSandbox()
    const session = sandbox.session(record)
    const swaps = valueOf(await sandbox.config().modelSwaps({ session }))
    expect(swaps).not.toHaveProperty("session")
    expect(swaps.launchModel).toBe(OPUS_55)
    expect(swaps.currentModel).toBe(OPUS_5)
    expect(swaps.swaps).toEqual([
      { time: "2026-11-09T12:11:27.105Z", reason: "fallback", from: OPUS_55, to: OPUS_5 },
      { time: "2026-11-09T12:12:39.953Z", reason: "fallback-revert", from: OPUS_5, to: OPUS_55 },
      { time: "2026-11-09T12:20:00.000Z", reason: "fallback", from: OPUS_55, to: OPUS_5 },
    ])
    expect(swaps.fallbackWindowOpen).toBe(true)
    expect(swaps.turnsPerModel).toEqual({ [OPUS_55]: 3, [OPUS_5]: 2 })
  })

  test("#given the last swap reverted #when the record is read #then no fallback window is open", async () => {
    sandbox = configSandbox()
    const session = sandbox.session(record.slice(0, 6))
    expect(valueOf(await sandbox.config().modelSwaps({ session })).fallbackWindowOpen).toBe(false)
  })

  test("#given no session option #when it runs in a session #then the calling session's record is read", async () => {
    sandbox = configSandbox()
    const session = sandbox.session(record)
    const swaps = valueOf(await sandbox.config({ env: { PI_SESSION_FILE: session } }).modelSwaps())
    expect(swaps.swaps).toHaveLength(3)
  })

  test("#given a session id #when it is read #then the record is found under the agent dir's sessions", async () => {
    sandbox = configSandbox()
    sandbox.session(record, "0199abcd-swaps")
    expect(valueOf(await sandbox.config().modelSwaps({ session: "0199abcd-swaps" })).swaps).toHaveLength(3)
  })

  test("#given a session that does not exist #when it is read #then it answers session_not_found without the reference", async () => {
    sandbox = configSandbox()
    const missingPath = join(sandbox.root, "nowhere.jsonl")
    const answers = [
      await sandbox.config().modelSwaps({ session: "0199-missing" }),
      await sandbox.config().modelSwaps({ session: missingPath }),
      await sandbox.config().modelSwaps(),
      await sandbox.config({ env: { PI_SESSION_FILE: missingPath } }).modelSwaps(),
    ]
    expect(answers.map((answer) => errorOf(answer).code)).toEqual(Array(4).fill("session_not_found"))
    expect(JSON.stringify(answers)).not.toContain(sandbox.root)
    expect(JSON.stringify(answers)).not.toContain("0199-missing")
  })

  test("#given a valid record outside the agent dir's sessions #when it is named by path #then it answers exactly as a missing record does", async () => {
    sandbox = configSandbox()
    const inside = sandbox.session(record)
    const outsideDir = join(sandbox.root, "elsewhere")
    mkdirSync(outsideDir, { recursive: true })
    const outside = join(outsideDir, "copy.jsonl")
    writeFileSync(outside, await Bun.file(inside).text())
    const missing = await sandbox.config().modelSwaps({ session: join(outsideDir, "missing.jsonl") })
    const answers = [
      await sandbox.config().modelSwaps({ session: outside }),
      await sandbox.config().modelSwaps({ session: relative(sandbox.project, outside) }),
      await sandbox.config({ env: { PI_SESSION_FILE: outside } }).modelSwaps(),
      await sandbox.config().check({ session: outside }),
    ]
    expect(errorOf(missing).code).toBe("session_not_found")
    for (const answer of answers.slice(0, 3)) expect(answer).toEqual(missing)
    expect(valueOf(await sandbox.config().modelSwaps({ session: inside })).swaps).toHaveLength(3)
    expect(JSON.stringify(answers[3])).not.toContain("quota_swap")
  })

  test("#given a record naming credential-shaped models #when it is read #then those ids are withheld", async () => {
    sandbox = configSandbox()
    const secret = "openai/sk-CANARYCANARYCANARYCANARY"
    const session = sandbox.session([
      modelChange("2026-11-09T12:00:01.000Z", OPUS_55),
      modelChange("2026-11-09T12:11:27.105Z", secret, "fallback", OPUS_55),
      assistantTurn("2026-11-09T12:11:40.000Z", secret),
    ])
    const swaps = valueOf(await sandbox.config().modelSwaps({ session }))
    expect(swaps.currentModel).toBeNull()
    expect(swaps.swaps).toEqual([{ time: "2026-11-09T12:11:27.105Z", reason: "fallback", from: OPUS_55, to: null }])
    expect(JSON.stringify(swaps)).not.toContain("CANARY")
  })
})
