import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { DORI_NOT_INSTALLED } from "../bin/lib/dori.js"
import { drive, FIXTURE_HOST, DORI_DIR, DORI_MANIFEST, home, packagedOmo, removeDoriRoots, write } from "./dori.test-support"

const hostExport = (target: string) => ({ ...DORI_MANIFEST, exports: { "./host": { import: target } } })
const escaped = (path: string) => `its host entry resolves to ${path}, outside the package`

afterEach(removeDoriRoots)

function refusal(app: string, why: string): string {
  return `omo dori: refusing the installed dori at ${join(app, DORI_DIR)}: ${why}\n`
}

describe("omo verifies the installed dori package before importing its host entry", () => {
  test("#given a manifest that names another package #when omo dori runs #then it refuses without running the host", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST, { ...DORI_MANIFEST, name: "@someone-else/omo-dori" })

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, 'its package.json names "@someone-else/omo-dori", not "dori-extension"'))
  })

  test("#given a manifest without doriExtension.hostContract #when omo dori runs #then it refuses and names the missing field", () => {
    // given
    const { doriExtension: _declared, ...undeclared } = DORI_MANIFEST
    const app = packagedOmo(FIXTURE_HOST, undeclared)

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, "its package.json does not declare doriExtension.hostContract"))
  })

  test("#given a manifest declaring another host contract #when omo dori runs #then it refuses before the host module runs", () => {
    // given: the host module itself speaks contract 1, so only the manifest check can refuse
    const app = packagedOmo(FIXTURE_HOST, { ...DORI_MANIFEST, doriExtension: { hostContract: 2 } })

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, "its package.json declares host contract 2, this omo speaks 1: upgrade omo so both speak the same host contract"))
  })

  test("#given a manifest declaring an older host contract #when omo dori runs #then the refusal says to upgrade dori-extension", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST, { ...DORI_MANIFEST, doriExtension: { hostContract: 0 } })

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toBe(refusal(app, "its package.json declares host contract 0, this omo speaks 1: upgrade dori-extension so both speak the same host contract"))
  })

  test("#given a host entry reached through a symlinked parent directory outside the package #when omo dori runs #then it refuses the escaping entry", () => {
    // given: the entry file itself is not a link; its parent directory is
    const app = packagedOmo(FIXTURE_HOST, hostExport("./lib/host.js"))
    write(app, "elsewhere/host.js", FIXTURE_HOST)
    symlinkSync(join(app, "elsewhere"), join(app, DORI_DIR, "lib"), "dir")

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, escaped(join(app, "elsewhere", "host.js"))))
  })

  test("#given an exports host target that climbs out with .. #when omo dori runs #then it refuses the escaping entry", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST, hostExport("./../elsewhere/host.js"))
    write(app, "node_modules/elsewhere/host.js", FIXTURE_HOST)

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, escaped(join(app, "node_modules", "elsewhere", "host.js"))))
  })

  test("#given an exports host target that is an absolute path #when omo dori runs #then it refuses the escaping entry", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST)
    write(app, "elsewhere/host.js", FIXTURE_HOST)
    write(app, join(DORI_DIR, "package.json"), JSON.stringify(hostExport(join(app, "elsewhere", "host.js"))))

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, escaped(join(app, "elsewhere", "host.js"))))
  })

  test("#given a manifest without an ./host export #when omo dori runs #then it refuses and names the missing export", () => {
    // given
    const { exports: _exports, ...unexported } = DORI_MANIFEST
    const app = packagedOmo(FIXTURE_HOST, unexported)

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toBe(refusal(app, 'its package.json does not export "./host"'))
  })

  test("#given a host entry symlinked to a file outside the package #when omo dori runs #then it refuses the escaping entry", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST)
    write(app, "elsewhere/host.js", FIXTURE_HOST)
    rmSync(join(app, DORI_DIR, "host.js"))
    symlinkSync(join(app, "elsewhere", "host.js"), join(app, DORI_DIR, "host.js"))

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(refusal(app, `its host entry resolves to ${join(app, "elsewhere", "host.js")}, outside the package`))
  })

  test("#given a verified package reached through a symlinked package directory #when omo dori runs #then its host runs", () => {
    // given: linked installs (bun, pnpm, workspaces) put the real package elsewhere; the check compares real paths
    const app = packagedOmo(FIXTURE_HOST)
    const store = join(app, "store", "omo-dori")
    mkdirSync(join(app, "store"), { recursive: true })
    renameSync(join(app, DORI_DIR), store)
    symlinkSync(store, join(app, DORI_DIR), "dir")
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
      launch: ["omo-under-test", "dori", "connect"],
    })
  })
})

describe("the package directory omo verifies is the one whose host entry it loads", () => {
  test("#given copies at two node_modules levels #when omo dori runs #then the nearest copy supplies both the checked manifest and the loaded host", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST.replace("return 7", "return 9"))
    write(app, join("bin", DORI_DIR, "package.json"), JSON.stringify(DORI_MANIFEST))
    write(app, join("bin", DORI_DIR, "host.js"), FIXTURE_HOST)

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.stderr).toBe("")
    expect(result.status).toBe(7)
  })

  const NODE_LAUNCH_BUDGET_MS = 60_000
  test("#given a copy only in a node global folder under HOME #when omo dori runs on node #then it is not installed instead of a refusal naming a copy omo cannot load", () => {
    // given: node's CommonJS search list adds ~/.node_modules; ESM resolution from omo's install never does
    const node = Bun.which("node")
    if (node === null) throw new Error("this test needs a real node on PATH")
    const app = packagedOmo()
    const env = home()
    write(env.HOME, join(".node_modules", "dori-extension", "package.json"), JSON.stringify(DORI_MANIFEST))
    write(env.HOME, join(".node_modules", "dori-extension", "host.js"), FIXTURE_HOST)

    // when
    const result = drive(app, ["status"], env, node)

    // then
    expect(result.stdout).toBe("")
    expect(result.status).toBe(1)
    expect(result.stderr).toBe(`omo dori: ${DORI_NOT_INSTALLED}\n`)
  }, NODE_LAUNCH_BUDGET_MS)
})
