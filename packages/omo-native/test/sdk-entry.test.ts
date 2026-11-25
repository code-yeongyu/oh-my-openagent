import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOmoSdk } from "../sdk.ts"

const env = { OMO_SERVICE_API_URL: "https://accounts.example.test" }

describe("omo-ai/sdk", () => {
  test("#given the entry, whose manifest has no ./sdk export yet #when install.sdkRoot runs #then it answers not_implemented naming the entry", async () => {
    const sdk = createOmoSdk({ env, cwd: "/work" })
    expect(await sdk.install.sdkRoot()).toMatchObject({
      kind: "error",
      error: { code: "not_implemented", details: { entry: "omo-ai/sdk" } },
    })
  })

  test("#given the entry #when install.version runs #then the loaded install core answers this package's version and its engine", async () => {
    const sdk = createOmoSdk({ env, cwd: "/work" })
    const answer = await sdk.install.version()
    if (answer.kind !== "ok") throw new Error(`install.version failed: ${answer.error.code}`)
    expect(answer.value.version).toBe((await Bun.file(join(import.meta.dir, "..", "package.json")).json()).version)
    expect(typeof answer.value.engine).toBe("string")
  })

  test("#given two roots #when one applies the plan the other answered #then it refuses invalid_arguments and writes nothing", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-c1c-roots-")))
    try {
      const home = join(root, "home")
      mkdirSync(join(root, "xdg", "opencode"), { recursive: true })
      mkdirSync(home, { recursive: true })
      writeFileSync(
        join(root, "xdg", "opencode", "auth.json"),
        JSON.stringify({ google: { type: "api", key: "SK-C1C-ROOTS" } }),
      )
      const rootEnv = {
        HOME: home,
        SENPI_CODING_AGENT_DIR: join(root, "agent"),
        XDG_DATA_HOME: join(root, "xdg"),
        XDG_CONFIG_HOME: join(root, "xdg-config"),
        XDG_CACHE_HOME: join(root, "xdg-cache"),
      }
      const [first, second] = [createOmoSdk({ env: rootEnv, home }), createOmoSdk({ env: rootEnv, home })]
      const planned = await first.install.setup.plan()
      if (planned.kind !== "ok") throw new Error(`plan failed: ${planned.error.code}`)
      expect(await second.install.setup.apply({ plan: planned.value, consent: "all" })).toMatchObject({
        kind: "error",
        error: { code: "invalid_arguments", details: { field: "plan" } },
      })
      expect(existsSync(join(root, "agent", "auth.json"))).toBe(false)
      expect(await first.install.setup.apply({ plan: planned.value, consent: "all" })).toMatchObject({ kind: "ok" })
      expect(existsSync(join(root, "agent", "auth.json"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("#given a caller that passes cores to the entry #when the root is built #then the type rejects it and construction refuses it", () => {
    // @ts-expect-error the entry sets the cores; its public options do not carry them
    expect(() => createOmoSdk({ env, cores: { install: async () => ({}) } })).toThrow(
      new TypeError("createOmoSdk: cores is set by the entry that ships the launcher library, not by a caller"),
    )
  })
})
