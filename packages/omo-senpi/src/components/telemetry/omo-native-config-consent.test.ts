import { describe, expect, test } from "bun:test"

import { isOmoNativeTelemetryConfigEnabled } from "./omo-native-session"

// The queue's consent read (#11198): this process's config choice is dropped, the record's writer's is applied.
function readWith(env: Record<string, string | undefined>, selection?: Record<string, string>) {
  const seen: Array<Record<string, string | undefined>> = []
  const enabled = isOmoNativeTelemetryConfigEnabled(
    { isConfigEnabled: (_cwd, readEnv) => {
      seen.push({ ...readEnv })
      return readEnv.OMO_PROFILE === "work"
    } },
    { cwd: "/repo" },
    env,
    "/home/account",
    selection,
  )
  return { enabled, env: seen[0] ?? {} }
}

describe("queue consent read", () => {
  test("#given this process runs another profile and its own HOME #when no record selection is given #then the read uses no profile and the account home", () => {
    const { enabled, env } = readWith({ OMO_PROFILE: "mine", HOME: "/tmp/elsewhere" })

    expect(enabled).toBe(false)
    expect(env.OMO_PROFILE).toBeUndefined()
    expect(env.HOME).toBe("/home/account")
  })

  test("#given a record written under OMO_PROFILE=work #when it is judged #then the read uses the writer's profile, not this process's", () => {
    const { enabled, env } = readWith({ OMO_PROFILE: "mine" }, { OMO_PROFILE: "work", HOME: "/home/writer" })

    expect(enabled).toBe(true)
    expect(env.HOME).toBe("/home/writer")
  })

  test("#given a Windows writer that named only USERPROFILE #when its record is judged #then the account home does not override the writer's", () => {
    const { env } = readWith({ HOME: "/tmp/elsewhere" }, { USERPROFILE: "C:\\Users\\writer" })

    expect(env.HOME).toBeUndefined()
    expect(env.USERPROFILE).toBe("C:\\Users\\writer")
  })
})
