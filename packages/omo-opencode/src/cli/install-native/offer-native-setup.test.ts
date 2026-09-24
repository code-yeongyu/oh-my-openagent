/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { NATIVE_SETUP_OFFER_QUESTION, nativeSetupFollowUpLine, offerNativeSetup } from "./index"
import type { NativeSetupOfferResult } from "./index"

const VERIFIED_BIN = "/sandbox/.bun/bin/omo"

function recorder(answer: boolean, runSetup: (binPath: string, args: readonly string[]) => Promise<number> = async () => 0) {
  const questions: string[] = []
  const runs: { binPath: string; args: readonly string[] }[] = []
  const starts: string[] = []
  return {
    questions,
    runs,
    starts,
    dependencies: {
      confirm: async (question: string) => {
        questions.push(question)
        return answer
      },
      runSetup: async (binPath: string, args: readonly string[]) => {
        runs.push({ binPath, args })
        return runSetup(binPath, args)
      },
      onStart: (line: string) => starts.push(line),
    },
  }
}

describe("offerNativeSetup", () => {
  test("#given a verified install #when the user answers yes #then setup runs from the verified binary path", async () => {
    // given
    const fake = recorder(true)

    // when
    const result = await offerNativeSetup({ verified: true, omoBinPath: VERIFIED_BIN }, fake.dependencies)

    // then
    expect(fake.questions).toEqual([NATIVE_SETUP_OFFER_QUESTION])
    expect(fake.runs).toEqual([{ binPath: VERIFIED_BIN, args: ["setup"] }])
    expect(fake.starts).toHaveLength(1)
    expect(result).toEqual({ kind: "ran", binPath: VERIFIED_BIN, exitCode: 0 })
  })

  test("#given a verified install #when the user answers no #then nothing is run", async () => {
    // given
    const fake = recorder(false)

    // when
    const result = await offerNativeSetup({ verified: true, omoBinPath: VERIFIED_BIN }, fake.dependencies)

    // then
    expect(fake.questions).toHaveLength(1)
    expect(fake.runs).toEqual([])
    expect(result).toEqual({ kind: "declined" })
  })

  test("#given verify failed #when the offer is made #then the user is not asked and nothing is run", async () => {
    // given
    const fake = recorder(true)

    // when
    const result = await offerNativeSetup({ verified: false, omoBinPath: VERIFIED_BIN }, fake.dependencies)

    // then
    expect(fake.questions).toEqual([])
    expect(fake.runs).toEqual([])
    expect(result).toEqual({ kind: "not-offered" })
  })

  test("#given setup cannot be spawned #when the user answers yes #then the error is returned, not thrown", async () => {
    // given
    const fake = recorder(true, async () => {
      throw new Error("spawn ENOENT")
    })

    // when
    const result = await offerNativeSetup({ verified: true, omoBinPath: VERIFIED_BIN }, fake.dependencies)

    // then
    expect(result).toEqual({ kind: "failed", binPath: VERIFIED_BIN, reason: "spawn ENOENT" })
  })
})

describe("nativeSetupFollowUpLine", () => {
  test("#given each offer result #when the follow-up is derived #then only an unfinished setup gets a line", () => {
    // given
    const results: readonly NativeSetupOfferResult[] = [
      { kind: "not-offered" },
      { kind: "declined" },
      { kind: "ran", binPath: VERIFIED_BIN, exitCode: 0 },
      { kind: "ran", binPath: VERIFIED_BIN, exitCode: 2 },
      { kind: "failed", binPath: VERIFIED_BIN, reason: "spawn ENOENT" },
    ]

    // when
    const lines = results.map((result) => nativeSetupFollowUpLine(result) !== null)

    // then
    expect(lines).toEqual([false, false, false, true, true])
  })
})
