import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { drive, FIXTURE_HOST, GATEWAY_DIR, GATEWAY_MANIFEST, home, packagedOmo, removeGatewayRoots, write } from "./gateway.test-support"

afterEach(removeGatewayRoots)

function refusal(app: string, why: string): string {
  return `omo gateway: refusing the installed gateway at ${join(app, GATEWAY_DIR)}: ${why}\n`
}

describe("omo verifies the installed gateway package before importing its host entry", () => {
  test("#given a manifest that names another package #when omo gateway runs #then it refuses without running the host", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST, { ...GATEWAY_MANIFEST, name: "@someone-else/omo-gateway" })

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, 'its package.json names "@someone-else/omo-gateway", not "@oh-my-opencode/omo-gateway"'))
  })

  test("#given a manifest without omoGateway.hostContract #when omo gateway runs #then it refuses and names the missing field", () => {
    // given
    const { omoGateway: _declared, ...undeclared } = GATEWAY_MANIFEST
    const app = packagedOmo(FIXTURE_HOST, undeclared)

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, "its package.json does not declare omoGateway.hostContract"))
  })

  test("#given a manifest declaring another host contract #when omo gateway runs #then it refuses before the host module runs", () => {
    // given: the host module itself speaks contract 1, so only the manifest check can refuse
    const app = packagedOmo(FIXTURE_HOST, { ...GATEWAY_MANIFEST, omoGateway: { hostContract: 2 } })

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, "its package.json declares host contract 2, this omo speaks 1"))
  })

  test("#given a host entry symlinked to a file outside the package #when omo gateway runs #then it refuses the escaping entry", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST)
    write(app, "elsewhere/host.js", FIXTURE_HOST)
    rmSync(join(app, GATEWAY_DIR, "host.js"))
    symlinkSync(join(app, "elsewhere", "host.js"), join(app, GATEWAY_DIR, "host.js"))

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, `its host entry resolves to ${join(app, "elsewhere", "host.js")}, outside the package`))
  })

  test("#given a verified package reached through a symlinked package directory #when omo gateway runs #then its host runs", () => {
    // given: linked installs (bun, pnpm, workspaces) put the real package elsewhere; the check compares real paths
    const app = packagedOmo(FIXTURE_HOST)
    const store = join(app, "store", "omo-gateway")
    mkdirSync(join(app, "store"), { recursive: true })
    renameSync(join(app, GATEWAY_DIR), store)
    symlinkSync(store, join(app, GATEWAY_DIR), "dir")
    const env = home()

    // when
    const result = drive(app, ["connect"], env)

    // then
    expect(result.stderr).toBe("")
    expect(result.status).toBe(7)
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["connect"],
      agentDir: join(env.HOME, ".omo", "agent"),
      home: env.HOME,
      pluginRoot: join(app, "plugin"),
      threadSdkUrl: pathToFileURL(join(app, "plugin", "runtime", "thread-sdk", "sdk.js")).href,
      launch: ["omo-under-test", "gateway", "connect"],
    })
  })
})
