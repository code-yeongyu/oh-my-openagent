import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix, relative, sep, win32 } from "node:path"
import { fileURLToPath } from "node:url"

import { shouldDisableTelemetry } from "../../../telemetry-core/src/env.ts"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"
import { SPAWN_BYPASSES } from "./telemetry-opt-out-env.bypasses.mjs"
import {
  TELEMETRY_OPT_OUT_NAMES,
  telemetryLocalSinkEnv,
  withTelemetryOptOut,
} from "./telemetry-opt-out-env.mjs"
import { auditDriverSpawns, findUnroutedSpawns } from "./telemetry-opt-out-env.scan.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const disabled = (env) => shouldDisableTelemetry({ env, productEnvPrefix: "OMO_SENPI" })
const HELPER_IMPORT = `import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs"\n`
const SPAWN_IMPORT = `import { spawn } from "node:child_process"\n`
const unrouted = (source) => findUnroutedSpawns([{ path: "script/qa/new-driver.mjs", source }]).map((site) => site.call)

function qaSources() {
  const listed = execFileSync("git", ["ls-files", "script/qa/**", "packages/*/scripts/qa/**"], { cwd: repoRoot, encoding: "utf8" })
  return listed.split("\n").filter((path) => /\.(?:mjs|cjs|js|ts|mts)$/u.test(path) && !/\.test\./u.test(path))
}

describe("withTelemetryOptOut", () => {
  test("#given a caller that opted in #when the child env is built #then every telemetry gate reads it as opted out", () => {
    const env = withTelemetryOptOut({ PATH: "/bin", DO_NOT_TRACK: "0", OMO_DISABLE_TELEMETRY: "0" })

    expect(env).toEqual({ PATH: "/bin", DO_NOT_TRACK: "1", OMO_DISABLE_TELEMETRY: "1" })
    expect(disabled(env)).toBe(true)
    expect(disabled({ OMO_DISABLE_TELEMETRY: "1" })).toBe(true)
  })

  test("#given isolatedChildEnv #when a sandbox env is built #then it goes through the same opt-out", () => {
    expect(disabled(isolatedChildEnv({ PATH: "/bin" }, "/tmp/sbx/agent"))).toBe(true)
  })

  test("#given a telemetry driver #when it opts in toward a loopback sink #then every opt-out is cleared and the host is local", () => {
    const env = { ...withTelemetryOptOut({ PATH: "/bin", OMO_DISABLE_POSTHOG: "1" }), ...telemetryLocalSinkEnv("http://127.0.0.1:4318") }

    expect(disabled(env)).toBe(false)
    expect(env.POSTHOG_HOST).toBe("http://127.0.0.1:4318")
    for (const name of TELEMETRY_OPT_OUT_NAMES) expect(env[name]).toBe("")
  })

  test("#given a non-loopback sink #when a driver opts in #then it is refused", () => {
    expect(() => telemetryLocalSinkEnv("https://us.i.posthog.com")).toThrow("loopback")
  })
})

describe("QA drivers opt out of telemetry", () => {
  const files = qaSources().map((path) => ({ path, source: readFileSync(join(repoRoot, path), "utf8") }))

  test("#given every QA driver #when its spawn sites are traced #then each env comes from a helper call or a reviewed bypass", () => {
    expect(auditDriverSpawns(files, SPAWN_BYPASSES)).toEqual([])
  })

  test("#given a reviewed bypass that no longer matches #when the tree is scanned #then it is reported as stale", () => {
    const ghost = { file: "script/qa/gone.mjs", function: "main", call: "spawn(senpi)", reason: "removed driver" }
    expect(auditDriverSpawns(files, [...SPAWN_BYPASSES, ghost])).toEqual(["stale bypass script/qa/gone.mjs main spawn(senpi) x0 (reviewed x1)"])
  })

  test("#given a new driver that launches senpi with the caller's env #when the scan runs #then it is rejected", () => {
    const driver = { path: "script/qa/new-driver.mjs", source: `${SPAWN_IMPORT}spawn("senpi", ["-p"], { env: { ...process.env } })\n` }
    expect(auditDriverSpawns([...files, driver], SPAWN_BYPASSES)).toEqual(["unrouted script/qa/new-driver.mjs:2 <module> spawn(\"senpi\")"])
  })

  test("#given a bypassed function #when a second spawn with the same call text appears #then the recount is rejected", () => {
    const path = "packages/omo-senpi/scripts/qa/probe-continuation.mjs"
    const grown = files.map((file) => file.path === path
      ? { ...file, source: file.source.replace("function main() {", "function main() {\n  spawnSync(tmuxBin, [\"new-session\", \"senpi\"])") }
      : file)
    expect(auditDriverSpawns(grown, SPAWN_BYPASSES)).toEqual([`recount bypass ${path} main spawnSync(tmuxBin) x3 (reviewed x2)`])
  })
})

// Reported paths are compared with "/"-separated expectations on every platform.
export function shippedName(pluginRoot, path, paths = { relative, sep }) {
  return paths.relative(pluginRoot, path).split(paths.sep).join("/")
}

// Every file under the plugin root ships (extensions/*.js, scripts/install-local.mjs, runtime/, ...),
// so each one is read; only vendored node_modules are skipped.
function shippedHelperReferences(pluginRoot) {
  const shipped = readdirSync(pluginRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !join(entry.parentPath, entry.name).includes("node_modules"))
    .map((entry) => join(entry.parentPath, entry.name))
  const leaking = shipped.filter((path) => /telemetry-opt-out-env|withTelemetryOptOut|telemetryLocalSinkEnv/u.test(readFileSync(path, "latin1")))
  return { scanned: shipped.length, leaking: leaking.map((path) => shippedName(pluginRoot, path)).sort() }
}

describe("the QA helper never ships", () => {
  test("#given the built plugin tree #when every shipped file is read #then none references the QA opt-out helper", () => {
    const { scanned, leaking } = shippedHelperReferences(join(repoRoot, "packages/omo-senpi/plugin"))
    expect(scanned).toBeGreaterThan(0)
    expect(leaking).toEqual([])
  })

  test.each([
    ["win32", win32, "D:\\a\\plugin", "D:\\a\\plugin\\scripts\\install-local.mjs"],
    ["posix", posix, "/a/plugin", "/a/plugin/scripts/install-local.mjs"],
  ])("#given a %s shipped path #when it is reported #then it uses forward slashes", (_label, paths, root, path) => {
    expect(shippedName(root, path, paths)).toBe("scripts/install-local.mjs")
  })

  test("#given a plugin tree whose bundle and installer name the helper #when it is scanned #then both files are reported", () => {
    const root = mkdtempSync(join(tmpdir(), "qa-helper-ship-"))
    try {
      mkdirSync(join(root, "extensions"))
      mkdirSync(join(root, "scripts"))
      writeFileSync(join(root, "extensions", "omo.js"), `export const ok = 1\nimport "./telemetry-opt-out-env.mjs"\n`)
      writeFileSync(join(root, "scripts", "install-local.mjs"), `const env = withTelemetryOptOut(process.env)\n`)
      writeFileSync(join(root, "extensions", "omo-task.js"), `export const clean = true\n`)
      expect(shippedHelperReferences(root)).toEqual({ scanned: 3, leaking: ["extensions/omo.js", "scripts/install-local.mjs"] })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("spawn tracing (#10226 delta-review probes)", () => {
  test("#given a spawn with no env option #when the runtime inherits the caller's env #then it is unrouted", () => {
    expect(unrouted(`${SPAWN_IMPORT}spawn("senpi", ["-p"])\n`)).toEqual([`spawn("senpi")`])
  })

  test("#given the helper named only in a comment #when the env is process.env #then it is unrouted", () => {
    expect(unrouted(`// withTelemetryOptOut\n${SPAWN_IMPORT}spawn("senpi", [], { env: process.env })\n`)).toEqual([`spawn("senpi")`])
  })

  test("#given the helper imported but never called #when the env spreads process.env #then it is unrouted", () => {
    expect(unrouted(`${HELPER_IMPORT}${SPAWN_IMPORT}spawn("senpi", [], { env: { ...process.env } })\n`)).toEqual([`spawn("senpi")`])
  })

  test("#given a helper call that reaches the env through a local binding #when the scan runs #then the site is routed", () => {
    const source = `${HELPER_IMPORT}${SPAWN_IMPORT}function childEnv(dir) { return { ...withTelemetryOptOut(process.env), HOME: dir } }\n`
      + `export function run(senpiBin) { let env\n  env = childEnv("/tmp/h")\n  return spawn(senpiBin, ["-p"], { cwd: "/tmp", env })\n}\n`
    expect(unrouted(source)).toEqual([])
  })

  test("#given an env parameter #when one caller passes the helper result and another passes process.env #then the site is unrouted", () => {
    const source = `${HELPER_IMPORT}${SPAWN_IMPORT}function launch(env) { return spawn("senpi", ["-p"], { env }) }\n`
      + `launch(withTelemetryOptOut(process.env))\nlaunch(process.env)\n`
    expect(unrouted(source)).toEqual([`spawn("senpi")`])
  })

  test("#given a spawn of a literal non-runtime command #when it inherits the env #then it is not a runtime launch", () => {
    expect(unrouted(`${SPAWN_IMPORT}// boots senpi elsewhere\nspawn("git", ["status"])\n`)).toEqual([])
  })
})

// Delta-3 LOW 1: each of these re-enables telemetry after the helper ran, so a QA child could reach the
// production analytics project.
describe("spawn tracing (#10226 delta-3 opt-out overrides)", () => {
  const routedEnv = `const env = withTelemetryOptOut(process.env)\n`
  const launch = `spawn("senpi", ["-p"], { env })\n`

  for (const [label, mutation] of [
    ["an assignment that turns an opt-out off", `env.OMO_DISABLE_TELEMETRY = "0"\n`],
    ["a delete of an opt-out", `delete env.DO_NOT_TRACK\n`],
    ["an element assignment of an opt-out", `env["DO_NOT_TRACK"] = ""\n`],
    ["an element assignment with a computed key", `const key = "DO_NOT_TRACK"\nenv[key] = ""\n`],
    ["an Object.assign over an opt-out", `Object.assign(env, { DO_NOT_TRACK: "" })\n`],
  ]) {
    test(`#given a helper env mutated by ${label} #when it is spawned #then the site is unrouted`, () => {
      expect(unrouted(`${HELPER_IMPORT}${SPAWN_IMPORT}${routedEnv}${mutation}${launch}`)).toEqual([`spawn("senpi")`])
    })
  }

  test("#given a helper env whose unrelated key is set #when it is spawned #then the site stays routed", () => {
    expect(unrouted(`${HELPER_IMPORT}${SPAWN_IMPORT}${routedEnv}env.HOME = "/tmp/h"\n${launch}`)).toEqual([])
  })

  test("#given a parameter env mutated inside the launcher #when every caller passes the helper result #then the site is unrouted", () => {
    const source = `${HELPER_IMPORT}${SPAWN_IMPORT}function boot(env) { delete env.OMO_DISABLE_TELEMETRY\n  return spawn("senpi", [], { env }) }\n`
      + `boot(withTelemetryOptOut(process.env))\n`
    expect(unrouted(source)).toEqual([`spawn("senpi")`])
  })

  for (const [label, literal] of [
    ["an explicit opt-out override", `{ ...withTelemetryOptOut(process.env), DO_NOT_TRACK: "" }`],
    ["a computed-key override", `{ ...withTelemetryOptOut(process.env), ["DO_NOT_TRACK"]: "" }`],
    ["a later spread of the caller's env", `{ ...withTelemetryOptOut({}), ...process.env }`],
  ]) {
    test(`#given a spread of the helper result followed by ${label} #when it is spawned #then the site is unrouted`, () => {
      expect(unrouted(`${HELPER_IMPORT}${SPAWN_IMPORT}spawn("senpi", [], { env: ${literal} })\n`)).toEqual([`spawn("senpi")`])
    })
  }

  test("#given the helper spread followed by the loopback sink helper and a plain key #when it is spawned #then the site stays routed", () => {
    const imports = `import { telemetryLocalSinkEnv, withTelemetryOptOut } from "./telemetry-opt-out-env.mjs"\n${SPAWN_IMPORT}`
    const env = `{ ...withTelemetryOptOut(process.env), ...telemetryLocalSinkEnv("http://127.0.0.1:1"), HOME: "/tmp/h" }`
    expect(unrouted(`${imports}spawn("senpi", [], { env: ${env} })\n`)).toEqual([])
  })

  for (const [label, source] of [
    ["process.execPath on the root CLI bundle", `import { execFileSync } from "node:child_process"\nexecFileSync(process.execPath, ["dist/cli/index.js"], { env: process.env })\n`],
    ["process.argv0 on the root launcher", `import { spawnSync } from "node:child_process"\nspawnSync(process.argv0, ["bin/oh-my-opencode.js", "run"], { env: process.env })\n`],
    ["node on the native launcher entry", `import { spawn } from "node:child_process"\nspawn("node", ["bin/omo.js"], { env: process.env })\n`],
  ]) {
    test(`#given a file that never names the runtime #when it spawns ${label} with the caller's env #then the site is unrouted`, () => {
      expect(findUnroutedSpawns([{ path: "script/qa/entry-driver.mjs", source }])).toHaveLength(1)
    })
  }
})
