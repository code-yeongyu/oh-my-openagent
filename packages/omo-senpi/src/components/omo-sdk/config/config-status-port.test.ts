import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createOmoSdk } from ".."

describe("config.status file-system port", () => {
  test("#given a fake file system holding a user omo.jsonc #when config.status runs #then it reads that file through the port and reports it, writing nothing", async () => {
    const home = "/home/fixture"
    const userConfig = join(home, ".omo", "omo.jsonc")
    const reads: string[] = []
    const fileSystem = {
      existsSync: (path: string) => path === userConfig,
      readFileSync: (path: string) => {
        reads.push(path)
        if (path !== userConfig) throw new Error(`no such fixture file: ${path}`)
        return '{ "task": { "host_engine_policy": "sometimes" } }'
      },
    }
    const sdk = createOmoSdk({ env: { HOME: home }, cwd: join(home, "project"), ports: { fileSystem } })
    const result = await sdk.config.status()
    expect(reads).toEqual([userConfig])
    expect(result.kind === "ok" && result.value.files.map((file) => file.path)).toContain(userConfig)
    expect(result.kind === "ok" && result.value.diagnostics.length).toBeGreaterThan(0)
  })
})
