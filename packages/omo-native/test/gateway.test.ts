import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { GATEWAY_NOT_INSTALLED, gatewayDoctorLines, runGatewayCommand } from "../bin/lib/gateway.js"
import { packageRoot } from "../bin/lib/package-paths.js"
import { drive, FIXTURE_HOST, home, packagedOmo, removeGatewayRoots, tempRoot, write } from "./gateway.test-support"

const THREAD_SDK = join("runtime", "thread-sdk", "sdk.js")

afterEach(removeGatewayRoots)

function sink(): { write: (text: string) => void; text: () => string } {
  let buffer = ""
  return { write: (text: string) => { buffer += text }, text: () => buffer }
}

function missingPackage(): Error {
  return Object.assign(new Error("Cannot find package '@oh-my-opencode/omo-gateway' from '/somewhere/bin/lib/gateway.js'"), {
    code: "ERR_MODULE_NOT_FOUND",
  })
}

describe("omo gateway resolves a separately installed package", () => {
  test("#given the package is not installed #when omo gateway runs #then it prints one line and exits 1", async () => {
    // given
    const stdout = sink()
    const stderr = sink()

    // when
    const code = await runGatewayCommand(["status"], { stdout, stderr, env: home(), importHost: async () => { throw missingPackage() } })

    // then
    expect(code).toBe(1)
    expect(stdout.text()).toBe("")
    expect(stderr.text()).toBe(`omo gateway: ${GATEWAY_NOT_INSTALLED}\n`)
    expect(stderr.text().split("\n").filter(Boolean)).toHaveLength(1)
  })

  test("#given a packaged omo without the package #when omo gateway runs for real #then the bare-name import misses and it prints the one line", () => {
    // given
    const app = packagedOmo()

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(`omo gateway: ${GATEWAY_NOT_INSTALLED}\n`)
  })

  test("#given the package installed beside omo #when omo gateway runs for real #then its host entry is called with the argv and host facts", () => {
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
      launch: ["omo-under-test", "gateway", "connect"],
    })
  })

  test("#given an install without the thread SDK file #when omo gateway runs #then the host still gets the plugin root and the SDK file URL inside it", () => {
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

  test("#given omo launched from a symlinked install #when omo gateway runs #then the plugin root and SDK URL name the real install", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST)
    const linked = join(tempRoot("omo-gateway-hook-link-"), "omo-ai")
    symlinkSync(app, linked, "dir")

    // when
    const result = drive(linked, ["status"], home())
    const received = JSON.parse(result.stdout)

    // then
    expect(result.status).toBe(7)
    expect(received.pluginRoot).toBe(join(app, "plugin"))
    expect(received.threadSdkUrl).toBe(pathToFileURL(join(app, "plugin", THREAD_SDK)).href)
  })

  test("#given an installed package on another host contract #when omo gateway runs #then it names both versions and exits 1", () => {
    // given
    const app = packagedOmo(FIXTURE_HOST.replace("HOST_CONTRACT_VERSION = 1", "HOST_CONTRACT_VERSION = 2"))

    // when
    const result = drive(app, ["status"], home())

    // then
    expect(result.status).toBe(1)
    expect(result.stderr).toBe("omo gateway: the installed gateway speaks host contract 2, this omo speaks 1\n")
  })

  test("#given a missing module inside an installed package #when loaded #then it is reported as broken, not as not installed", async () => {
    // given
    const stderr = sink()
    const inner = Object.assign(new Error("Cannot find package 'left-pad' from '/x/node_modules/@oh-my-opencode/omo-gateway/host.js'"), { code: "ERR_MODULE_NOT_FOUND" })

    // when
    const code = await runGatewayCommand(["status"], { stdout: sink(), stderr, env: home(), importHost: async () => { throw inner } })

    // then
    expect(code).toBe(1)
    expect(stderr.text()).toStartWith("omo gateway: cannot load @oh-my-opencode/omo-gateway/host: Cannot find package 'left-pad'")
  })
})

describe("omo doctor gateway rows", () => {
  const installedHost = (lines: string[]) => async () => ({
    HOST_CONTRACT_VERSION: 1,
    runGatewayCommand: async () => 0,
    gatewayDoctorLines: async () => lines,
  })

  test("#given no gateway section #when doctor asks #then there are no rows and the package is never imported", async () => {
    // given
    let imported = 0
    const importHost = async () => { imported += 1; throw missingPackage() }

    // when
    const withoutFile = await gatewayDoctorLines({ env: home(), importHost })
    const withOtherKeys = await gatewayDoctorLines({ env: home(JSON.stringify({ disabled_skills: ["x"], profiles: { p: { gateway: {} } } })), importHost })

    // then
    expect(withoutFile).toEqual([])
    expect(withOtherKeys).toEqual([])
    expect(imported).toBe(0)
  })

  test("#given a gateway section and no package #when doctor asks #then one WARN row says it is not installed", async () => {
    // given
    const env = home(`// user config\n{ "gateway": { "scopes": [{ "id": "qa" }] }, }`)

    // when
    const lines = await gatewayDoctorLines({ env, importHost: async () => { throw missingPackage() } })

    // then
    expect(lines).toEqual([`WARN gateway: ${GATEWAY_NOT_INSTALLED}`])
  })

  test("#given a gateway section in the [native] block and the package installed #when doctor asks #then the installed row is followed by the package's own rows", async () => {
    // given
    const env = home(JSON.stringify({ "[native]": { gateway: { scopes: [{ id: "qa" }] } } }))

    // when
    const lines = await gatewayDoctorLines({ env, importHost: installedHost(["PASS gateway config: valid (x)", "WARN gateway surface qa/slack: options not checked"]) })

    // then
    expect(lines).toEqual(["PASS gateway: installed", "PASS gateway config: valid (x)", "WARN gateway surface qa/slack: options not checked"])
  })

  test("#given a gateway section and the package installed #when doctor asks #then the package's doctor gets the plugin root and the thread SDK URL", async () => {
    // given
    const received: Record<string, unknown>[] = []
    const importHost = async () => ({
      HOST_CONTRACT_VERSION: 1,
      runGatewayCommand: async () => 0,
      gatewayDoctorLines: async (options: Record<string, unknown>) => { received.push(options); return [] },
    })

    // when
    await gatewayDoctorLines({ env: home('{"gateway":{}}'), importHost })

    // then
    expect(received).toHaveLength(1)
    expect(received[0]?.pluginRoot).toBe(join(packageRoot, "plugin"))
    expect(received[0]?.threadSdkUrl).toBe(pathToFileURL(join(packageRoot, "plugin", THREAD_SDK)).href)
  })

  test("#given an installed gateway with a missing host target #when the packaged CLI and doctor run #then both report load failure", () => {
    // given: a packaged install whose every other check passes
    const app = packagedOmo()
    const senpi = { "@code-yeongyu/senpi": "2026.8.9" }
    write(app, "package.json", JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module", dependencies: senpi }))
    write(app, "node_modules/@code-yeongyu/senpi/package.json", JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" } }))
    for (const file of ["dist/index.js", "dist/cli.js", "dist/core/brand.js"]) write(app, `node_modules/@code-yeongyu/senpi/${file}`, "export {}\n")
    for (const file of ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js"]) write(app, file, "fixture\n")
    write(app, "doctor.mjs", [
      'import { runDoctor } from "./bin/lib/doctor.js"',
      'import { gatewayDoctorLines } from "./bin/lib/gateway.js"',
      "runDoctor({ harnesses: [] }, [], { gateway: process.argv[2] ? JSON.parse(process.argv[2]) : await gatewayDoctorLines(), fetchDistTags: () => ({}), list: () => [], listDirs: () => [], hasRepo: () => false })",
    ].join("\n"))
    const env = { ...home('{"gateway":{}}'), PATH: process.env.PATH ?? "", OMO_CODING_AGENT_DIR: join(app, "agent") }
    const doctor = (gateway?: string[]) => spawnSync(process.execPath, [join(app, "doctor.mjs"), ...(gateway ? [JSON.stringify(gateway)] : [])], {
      cwd: app,
      encoding: "utf8",
      env,
    })

    // when
    const control = doctor(["PASS gateway: installed"])
    const failing = doctor(["PASS gateway: installed", "FAIL gateway config: x"])
    const absent = doctor()
    write(app, "node_modules/@oh-my-opencode/omo-gateway/package.json", JSON.stringify({
      name: "@oh-my-opencode/omo-gateway", type: "module", exports: { "./host": "./absent.js" }, omoGateway: { hostContract: 1 },
    }))
    const broken = doctor()
    const cli = spawnSync(process.execPath, [join(app, "bin/omo.js"), "gateway", "status"], {
      cwd: app, encoding: "utf8", env,
    })

    // then
    expect(control.status).toBe(0)
    expect(failing.stdout).toContain("FAIL gateway config: x")
    expect(failing.status).toBe(1)
    expect(absent.status).toBe(0)
    expect(absent.stdout).toContain(`WARN gateway: ${GATEWAY_NOT_INSTALLED}`)
    expect(broken.stdout).toContain("FAIL gateway: cannot load @oh-my-opencode/omo-gateway/host:")
    expect(broken.status).toBe(1)
    expect(cli.status).toBe(1)
    expect(cli.stderr).toStartWith("omo gateway: cannot load @oh-my-opencode/omo-gateway/host:")
  })
})
