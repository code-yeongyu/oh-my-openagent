import { describe, expect, test } from "bun:test"

import { describeReflectionLauncher } from "./launcher-identity"

describe("reflection launcher identity", () => {
  test("#given a compiled runtime root and live session #when launcher identity is described #then the runtime root and process identity are preserved", () => {
    const launcher = describeReflectionLauncher({
      env: { OMO_PACKAGE_DIR: "/home/user/.omo/binary-runtime/0.0.0-omob.826d819.fe2ff6e" },
      execPath: "/home/user/.omo/binary-runtime/0.0.0-omob.826d819.fe2ff6e/omo",
      pid: 1234,
      sessionId: "session-a",
    })

    expect(launcher).toEqual({
      runtime: "0.0.0-omob.826d819.fe2ff6e",
      execPath: "/home/user/.omo/binary-runtime/0.0.0-omob.826d819.fe2ff6e/omo",
      pid: 1234,
      sessionId: "session-a",
    })
  })
})
