import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DORI_NOT_INSTALLED, doriDoctorLines, runDoriCommand } from "../bin/lib/dori.js"
import { packageRoot } from "../bin/lib/package-paths.js"
import { drive, FIXTURE_HOST, home, packagedOmo, removeDoriRoots, tempRoot, write } from "./dori.test-support"

const THREAD_SDK = join("runtime", "thread-sdk", "sdk.js")

afterEach(removeDoriRoots)

function sink(): { write: (text: string) => void; text: () => string } {
  let buffer = ""
  return { write: (text: string) => { buffer += text }, text: () => buffer }
}

function missingPackage(): Error {
  return Object.assign(new Error("Cannot find package 'dori-extension' from '/somewhere/bin/lib/dori.js'"), {
    code: "ERR_MODULE_NOT_FOUND",
  })
}

describe("omo dori resolves a separately installed package", () => {
  test("#given the package is not installed #when omo dori runs #then it prints one line and exits 1", async () => {
    // given
    const stdout = sink()
    const stderr = sink()

    // when
    const code = await runDoriCommand(["status"], { stdout, stderr, env: home(), importHost: async () => { throw missingPackage() } })

    // then
    expect(code).toBe(1)
    expect(stdout.text()).toBe("")
    expect(stderr.text()).toBe(`omo dori: ${DORI_NOT_INSTALLED}\n`)
    expect(stderr.text().split("\n").filter(Boolean)).toHaveLength(1)
  })

  test("#given a packaged omo without the package #when omo dori runs for real #then the bare-name import misses and it prints the one line", () => {
    // given
    const app = packagedOmo()

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(`omo dori: ${DORI_NOT_INSTALLED}\n`)
  })

  test("#given the package installed beside omo #when omo dori runs for real #then its host entry is called with the argv and host facts", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST)
    const env = home()

    // when
    const result = drive(app, ["connect", "--scope", "qa"], env)

    // then
    expect(result.status).toBe(7)
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["connect", "--scope", "qa"],
      agentDir: join(env.HOME, ".omo", "agent"),
      home: env.HOME,
      pluginRoot: join(app, "plugin"),
      threadSdkUrl: pathToFileURL(join(app, "plugin", THREAD_SDK)).href,
      launch: ["omo-under-test", "dori", "connect"],
    })
  })

  test("#given an install without the thread SDK file #when omo dori runs #then the host still gets the plugin root and the SDK file URL inside it", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST)

    // when
    const result = drive(app, ["status"], home())
    const received = JSON.parse(result.stdout)

    // then
    expect(result.status).toBe(7)
    expect(received.pluginRoot).toBe(join(app, "plugin"))
    expect(new URL(received.threadSdkUrl).protocol).toBe("file:")
    expect(received.threadSdkUrl).toEndWith("/runtime/thread-sdk/sdk.js")
    expect(fileURLToPath(received.threadSdkUrl)).toBe(join(received.pluginRoot, THREAD_SDK))
    expect(existsSync(fileURLToPath(received.threadSdkUrl))).toBe(false)
  })

  test("#given omo launched from a symlinked install #when omo dori runs #then the plugin root and SDK URL name the real install", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST)
    const linked = join(tempRoot("omo-dori-hook-link-"), "omo-ai")
    symlinkSync(app, linked, "dir")

    // when
    const result = drive(linked, ["status"], home())
    const received = JSON.parse(result.stdout)

    // then
    expect(result.status).toBe(7)
    expect(received.pluginRoot).toBe(join(app, "plugin"))
    expect(received.threadSdkUrl).toBe(pathToFileURL(join(app, "plugin", THREAD_SDK)).href)
  })

  test("#given an installed package on another host contract #when omo dori runs #then it names both versions and exits 1", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST.replace("HOST_CONTRACT_VERSION = 1", "HOST_CONTRACT_VERSION = 2"))

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toBe("omo dori: the installed dori-extension speaks host contract 2, this omo speaks 1: upgrade omo so both speak the same host contract\n")
  })

  test("#given a missing module inside an installed package #when loaded #then it is reported as broken, not as not installed", async () => {
    // given
    const stderr = sink()
    const inner = Object.assign(new Error("Cannot find package 'left-pad' from '/x/node_modules/dori-extension/host.js'"), { code: "ERR_MODULE_NOT_FOUND" })

    // when
    const code = await runDoriCommand(["status"], { stdout: sink(), stderr, env: home(), importHost: async () => { throw inner } })

    // then
    expect(code).toBe(1)
    expect(stderr.text()).toStartWith("omo dori: cannot load dori-extension/host: Cannot find package 'left-pad'")
  })
})

describe("omo doctor dori rows", () => {
  const installedHost = (lines: string[]) => async () => ({
    HOST_CONTRACT_VERSION: 1,
    runGatewayCommand: async () => 0,
    gatewayDoctorLines: async () => lines,
  })

  test("#given no dori section #when doctor asks #then there are no rows and the package is never imported", async () => {
    // given
    let imported = 0
    const importHost = async () => { imported += 1; throw missingPackage() }

    // when
    const withoutFile = await doriDoctorLines({ env: home(), importHost })
    const withOtherKeys = await doriDoctorLines({ env: home(JSON.stringify({ disabled_skills: ["x"], profiles: { p: { dori: {} } } })), importHost })

    // then
    expect(withoutFile).toEqual([])
    expect(withOtherKeys).toEqual([])
    expect(imported).toBe(0)
  })

  test("#given a dori section and no package #when doctor asks #then one WARN row says it is not installed", async () => {
    // given
    const env = home(`// user config\n{ "dori": { "scopes": [{ "id": "qa" }] }, }`)

    // when
    const lines = await doriDoctorLines({ env, importHost: async () => { throw missingPackage() } })

    // then
    expect(lines).toEqual([`WARN dori: ${DORI_NOT_INSTALLED}`])
  })

  test("#given a dori section in the [native] block and the package installed #when doctor asks #then the installed row is followed by the package's own rows", async () => {
    // given
    const env = home(JSON.stringify({ "[native]": { dori: { scopes: [{ id: "qa" }] } } }))

    // when
    const lines = await doriDoctorLines({ env, importHost: installedHost(["PASS dori config: valid (x)", "WARN dori surface qa/slack: options not checked"]) })

    // then
    expect(lines).toEqual(["PASS dori: installed", "PASS dori config: valid (x)", "WARN dori surface qa/slack: options not checked"])
  })

  test("#given a dori section and the package installed #when doctor asks #then the package's doctor gets the plugin root and the thread SDK URL", async () => {
    // given
    const received: Record<string, unknown>[] = []
    const importHost = async () => ({
      HOST_CONTRACT_VERSION: 1,
      runGatewayCommand: async () => 0,
      gatewayDoctorLines: async (options: Record<string, unknown>) => { received.push(options); return [] },
    })

    // when
    await doriDoctorLines({ env: home('{"dori":{}}'), importHost })

    // then
    expect(received).toHaveLength(1)
    expect(received[0]?.pluginRoot).toBe(join(packageRoot, "plugin"))
    expect(received[0]?.threadSdkUrl).toBe(pathToFileURL(join(packageRoot, "plugin", THREAD_SDK)).href)
  })

  test("#given an installed dori with a missing host target #when the packaged CLI and doctor run #then both report load failure", () => {
    // given: a packaged install whose every other check passes
    const app = packagedOmo()
    const senpi = { "@code-yeongyu/senpi": "2026.8.9" }
    write(app, "package.json", JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module", dependencies: senpi }))
    write(app, "node_modules/@code-yeongyu/senpi/package.json", JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" } }))
    for (const file of ["dist/index.js", "dist/cli.js", "dist/core/brand.js"]) write(app, `node_modules/@code-yeongyu/senpi/${file}`, "export {}\n")
    for (const file of ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js"]) write(app, file, "fixture\n")
    write(app, "doctor.mjs", [
      'import { runDoctor } from "./bin/lib/doctor.js"',
      'import { doriDoctorLines } from "./bin/lib/dori.js"',
      "runDoctor({ harnesses: [] }, [], { dori: process.argv[2] ? JSON.parse(process.argv[2]) : await doriDoctorLines(), fetchDistTags: () => ({}), list: () => [], listDirs: () => [], hasRepo: () => false })",
    ].join("\n"))
    const env = { ...home('{"dori":{}}'), PATH: process.env.PATH ?? "", OMO_CODING_AGENT_DIR: join(app, "agent") }
    const doctor = (dori?: string[]) => spawnSync(process.execPath, [join(app, "doctor.mjs"), ...(dori ? [JSON.stringify(dori)] : [])], {
      cwd: app,
      encoding: "utf8",
      env,
    })

    // when
    const control = doctor(["PASS dori: installed"])
    const failing = doctor(["PASS dori: installed", "FAIL dori config: x"])
    const absent = doctor()
    write(app, "node_modules/dori-extension/package.json", JSON.stringify({
      name: "dori-extension", type: "module", exports: { "./host": "./absent.js" }, doriExtension: { hostContract: 1 },
    }))
    const broken = doctor()
    const cli = spawnSync(process.execPath, [join(app, "bin/omo.js"), "dori", "status"], {
      cwd: app, encoding: "utf8", env,
    })

    // then
    expect(control.status).toBe(0)
    expect(failing.stdout).toContain("FAIL dori config: x")
    expect(failing.status).toBe(1)
    expect(absent.status).toBe(0)
    expect(absent.stdout).toContain(`WARN dori: ${DORI_NOT_INSTALLED}`)
    expect(broken.stdout).toContain("FAIL dori: cannot load dori-extension/host:")
    expect(broken.status).toBe(1)
    expect(cli.status).toBe(1)
    expect(cli.stderr).toStartWith("omo dori: cannot load dori-extension/host:")
  })
})
