import { describe, expect, test } from "bun:test"

import { createOmoSdk } from "../sdk.ts"

const env = { OMO_SERVICE_API_URL: "https://accounts.example.test" }

describe("omo-ai/sdk", () => {
  test("#given install.sdkRoot, a call no shipped entry serves and no matrix line names yet #when it runs #then the root refuses it by default, before its core", async () => {
    const sdk = createOmoSdk({ env, cwd: "/work" })
    expect(await sdk.install.sdkRoot()).toMatchObject({
      kind: "error",
      error: { code: "sender_not_allowed", details: { principal: "script", reason: "no_matrix_cell" } },
    })
  })

  test("#given an install call slice C1c has not landed #when it runs #then it answers not_implemented from the loaded install core", async () => {
    const sdk = createOmoSdk({ env, cwd: "/work" })
    expect(await sdk.install.version()).toMatchObject({ kind: "error", error: { code: "not_implemented" } })
  })

  test("#given a caller that passes cores to the entry #when the root is built #then the type rejects it and construction refuses it", () => {
    // @ts-expect-error the entry sets the cores; its public options do not carry them
    expect(() => createOmoSdk({ env, cores: { install: async () => ({}) } })).toThrow(
      new TypeError("createOmoSdk: cores is set by the entry that ships the launcher library, not by a caller"),
    )
  })
})
