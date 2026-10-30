import { afterEach, describe, expect, test } from "bun:test"

import { isolatedEnvironment } from "./omo-native-eval-smoke-sandbox.mjs"

const SANDBOX = {
  root: "/tmp/eval-smoke",
  home: "/tmp/eval-smoke/home",
  agentDir: "/tmp/eval-smoke/agent",
  sessionDir: "/tmp/eval-smoke/sessions",
}
const originalDoNotTrack = process.env.DO_NOT_TRACK

afterEach(() => {
  if (originalDoNotTrack === undefined) delete process.env.DO_NOT_TRACK
  else process.env.DO_NOT_TRACK = originalDoNotTrack
})

describe("eval smoke sandbox environment", () => {
  test("#given a caller that opts into tracking #when the sandbox env is built #then DO_NOT_TRACK is forced on", () => {
    // given
    process.env.DO_NOT_TRACK = "0"

    // when
    const env = isolatedEnvironment(SANDBOX)

    // then
    expect(env.DO_NOT_TRACK).toBe("1")
  })
})
