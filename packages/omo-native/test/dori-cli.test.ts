import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { doriDoctorLines } from "../bin/lib/dori.js"
import { FIXTURE_HOST, home, packagedOmo, removeDoriRoots } from "./dori.test-support"

afterEach(removeDoriRoots)

describe("dori CLI dispatch", () => {
  test("#given an installed host #when either command runs #then gateway warns and delegates with the canonical relaunch argv", () => {
    const app = packagedOmo(FIXTURE_HOST)
    const env = { ...home(), PATH: process.env.PATH ?? "" }
    const run = (command: string) => spawnSync(process.execPath, [join(app, "bin/omo.js"), command, "status"], {
      cwd: app, env, encoding: "utf8",
    })

    const canonical = run("dori")
    const alias = run("gateway")

    expect(canonical.status).toBe(7)
    expect(alias.status).toBe(canonical.status)
    expect(alias.stdout).toBe(canonical.stdout)
    expect(canonical.stderr).toBe("")
    expect(alias.stderr).toContain("omo gateway is deprecated; use omo dori instead")
    expect(JSON.parse(alias.stdout).launch.slice(-2)).toEqual(["dori", "connect"])
  })

  test("#given only legacy gateway sections #when doctor runs #then the host is not imported", async () => {
    let imported = false
    const lines = await doriDoctorLines({
      env: home('{"gateway":{},"[native]":{"gateway":{}},"[senpi]":{"gateway":{}}}'),
      importHost: async () => { imported = true; throw new Error("must not load") },
    })
    expect(lines).toEqual([])
    expect(imported).toBe(false)
  })
})
