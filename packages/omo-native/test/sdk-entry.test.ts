import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createOmoSdk } from "../sdk.ts"

const env = { OMO_SERVICE_API_URL: "https://accounts.example.test" }

describe("omo-ai/sdk", () => {
  test("#given the entry #when install.sdkRoot runs #then it answers the directory of the built entry beside the launcher library", async () => {
    const sdk = createOmoSdk({ env, cwd: "/work" })
    expect(await sdk.install.sdkRoot()).toEqual({
      kind: "ok",
      value: { path: join(import.meta.dir, "..", "bin", "lib", "sdk") },
    })
  })

  test("#given the entry #when install.version runs #then the loaded install core answers this package's version and its engine", async () => {
    const sdk = createOmoSdk({ env, cwd: "/work" })
    const answer = await sdk.install.version()
    if (answer.kind !== "ok") throw new Error(`install.version failed: ${answer.error.code}`)
    expect(answer.value.version).toBe(
      (await Bun.file(join(import.meta.dir, "..", "package.json")).json()).version,
    )
    expect(typeof answer.value.engine).toBe("string")
  })

  test("#given a caller that passes cores to the entry #when the root is built #then the type rejects it and construction refuses it", () => {
    // @ts-expect-error the entry sets the cores; its public options do not carry them
    expect(() => createOmoSdk({ env, cores: { install: async () => ({}) } })).toThrow(
      new TypeError("createOmoSdk: cores is set by the entry that ships the launcher library, not by a caller"),
    )
  })
})
