import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { isEngineCommand } from "../bin/lib/engine-commands.js"
import { buildSenpiArgs, shouldPrintCompiledBanner } from "../compile-args"

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ENGINE_ROOT = dirname(dirname(Bun.resolveSync("@code-yeongyu/senpi", SOURCE_ROOT)))
const engineModule = async (relative: string): Promise<Record<string, unknown>> =>
  import(pathToFileURL(join(ENGINE_ROOT, "dist", relative)).href)

type Predicate = (args: readonly string[]) => boolean

async function engineDispatch() {
  const deferred = await engineModule("cli/deferred-commands.js")
  const models = await engineModule("cli/models-command.js")
  const auth = await engineModule("cli/auth-command.js")
  const argvConstants = Object.entries(deferred)
    .filter(([name, value]) => name.endsWith("_COMMAND_ARGV") && typeof value === "string")
    .map(([name, value]) => ({ name, command: value as string }))
  const packageVerbs = [
    ...readFileSync(join(ENGINE_ROOT, "dist", "package-manager-cli.d.ts"), "utf8").matchAll(
      /export type PackageCommand = ([^;]+);/g,
    ),
  ].flatMap((match) => [...match[1].matchAll(/"([a-z-]+)"/g)].map((verb) => verb[1]))
  return {
    argvConstants,
    packageVerbs,
    isPackageCommandArgv: deferred.isPackageCommandArgv as Predicate,
    isModelsDiscoverCommand: models.isModelsDiscoverCommand as Predicate,
    isAuthCommandHelp: auth.isAuthCommandHelp as Predicate,
  }
}

describe("every one-shot engine command reaches the engine with the command first (#9572)", () => {
  test("#given the installed engine's argv[0] dispatch #when each command it routes is checked #then omo hands it over unchanged", async () => {
    // given
    const engine = await engineDispatch()
    expect(engine.argvConstants.map((entry) => entry.name)).toContain("SCHEDULE_COMMAND_ARGV")
    expect(engine.packageVerbs.length).toBeGreaterThan(0)
    // when
    const routed = [
      // app-server is retired here: omo refuses it itself (bin/lib/retired-command.js) even while an
      // installed engine still declares it.
      ...engine.argvConstants
        .filter((entry) => entry.name !== "APP_SERVER_COMMAND_ARGV")
        .map((entry) => [entry.command]),
      ...engine.packageVerbs.map((verb) => [verb]),
      ...["uninstall"].filter((alias) => engine.isPackageCommandArgv([alias])).map((alias) => [alias]),
      ["auth"],
      ["models", "discover", "custom"],
    ]
    // then: the engine claims each one, and so does omo; a new engine command fails here until omo routes it
    for (const args of routed) {
      const claimedByEngine =
        engine.argvConstants.some((entry) => entry.command === args[0]) ||
        engine.isPackageCommandArgv(args) ||
        engine.isAuthCommandHelp(args) ||
        engine.isModelsDiscoverCommand(args)
      expect({ args, claimedByEngine, routedByOmo: isEngineCommand(args) }).toEqual({
        args,
        claimedByEngine: true,
        routedByOmo: true,
      })
    }
  })

  test("#given argv the engine does not dispatch #when checked #then omo keeps it a launch with the plugin", async () => {
    // given
    const engine = await engineDispatch()
    // when / then: the retired app-server is never handed to the engine, and a prompt is a chat launch
    for (const args of [["app-server"], ["models"], ["models", "are", "great"], ["say", "hi"], []]) {
      expect({ args, routedByOmo: isEngineCommand(args) }).toEqual({ args, routedByOmo: false })
    }
    expect(engine.isModelsDiscoverCommand(["models", "are", "great"])).toBe(false)
  })
})

describe("the compiled entry hands engine commands over unchanged (#9572)", () => {
  for (const args of [
    ["models", "discover", "custom"],
    ["schedule", "list"],
    ["uninstall", "source"],
  ]) {
    test(`#given ${args.join(" ")} #when the compiled binary builds the engine argv #then it is unchanged and prints no banner`, () => {
      expect(buildSenpiArgs([...args], "/provisioned")).toEqual(args)
      expect(shouldPrintCompiledBanner([...args], true)).toBe(false)
    })
  }

  test("#given a chat prompt starting with models #when built #then the plugin still comes first", () => {
    expect(buildSenpiArgs(["models", "are", "great"], "/provisioned")).toEqual([
      "--extension",
      join("/provisioned", "plugin"),
      "models",
      "are",
      "great",
    ])
  })
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function launcherWithFakeEngine() {
  // The long-name form: tmpdir() is an 8.3 short path (RUNNER~1) on Windows runners, and the launcher reports the long one.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-engine-commands-")))
  roots.push(root)
  const packageRoot = join(root, "app")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  const write = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  write(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "omo-ai",
      version: "1.2.3-test.0",
      type: "module",
      dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
    }),
  )
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  write(
    join(senpiRoot, "package.json"),
    JSON.stringify({
      name: "@code-yeongyu/senpi",
      version: "2026.8.9",
      type: "module",
      exports: { ".": "./dist/index.js" },
    }),
  )
  write(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  write(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  write(
    join(senpiRoot, "dist", "cli.js"),
    `import { writeFileSync } from "node:fs"\nwriteFileSync(process.env.CAPTURE_FILE, JSON.stringify(process.argv.slice(2)))\n`,
  )
  const captureFile = join(root, "capture.json")
  const launch = (args: string[]) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      CAPTURE_FILE: captureFile,
      OMO_CODING_AGENT_DIR: join(root, "agent"),
    }
    const result = spawnSync(process.execPath, [join(packageRoot, "bin", "omo.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      env,
    })
    return {
      status: result.status,
      stderr: result.stderr,
      argv: JSON.parse(readFileSync(captureFile, "utf8")) as string[],
    }
  }
  return { packageRoot, launch }
}

describe("the npm launcher hands engine commands over unchanged (#9572)", () => {
  for (const args of [
    ["models", "discover", "custom"],
    ["schedule", "list"],
    ["uninstall", "source"],
  ]) {
    test(`#given omo ${args.join(" ")} #when launched #then the engine receives exactly those arguments`, () => {
      // given
      const fixture = launcherWithFakeEngine()
      // when
      const launched = fixture.launch([...args])
      // then
      expect({ status: launched.status, argv: launched.argv }).toEqual({ status: 0, argv: args })
    })
  }

  test("#given a chat prompt #when launched #then the plugin is still loaded first", () => {
    // given
    const fixture = launcherWithFakeEngine()
    // when
    const launched = fixture.launch(["models", "are", "great"])
    // then
    expect(launched.argv).toEqual(["--extension", join(fixture.packageRoot, "plugin"), "models", "are", "great"])
  })
})

// omo#14253: the engine's entry (dist/cli.js) also dispatches one-shot verbs of its own before any session starts
// (`dispatch<Name>Command(argv)`). Each one must reach it with the verb first; one that omo rewrote (a leading
// `--extension`) silently became a chat launch, as session-of-pid did in 5.1.78. The verbs are read from the engine
// itself, and the scan fails closed: finding fewer than the verbs known today means it could no longer read them.
describe("every verb the engine entry dispatches reaches it with the verb first (omo#14253)", () => {
  test("#given the installed engine's dist/cli.js dispatch calls #when each dispatched verb is routed #then omo hands it over unchanged or answers it before boot", () => {
    // given
    const entry = readFileSync(join(ENGINE_ROOT, "dist", "cli.js"), "utf8")
    const modules = [...entry.matchAll(/import \{ (dispatch[A-Za-z]+Command) \} from "\.\/(cli\/[a-z-]+)\.js";/g)]
      .filter((match) => new RegExp(`await ${match[1]}\\(`).test(entry))
      .map((match) => match[2] ?? "")
    const verbs = modules.map((module) => {
      const source = readFileSync(join(ENGINE_ROOT, "dist", `${module}.js`), "utf8")
      const first = /args\[0\] !== "([^"]+)"/.exec(source)?.[1]
      const second = /args\[1\] !== "([^"]+)"/.exec(source)?.[1]
      if (first === undefined) throw new Error(`cannot read the verb ${module} dispatches`)
      return second === undefined ? [first] : [first, second]
    })
    // then: fail closed on a scan that reads less than today's verbs
    expect(verbs).toEqual(expect.arrayContaining([["__kill-guard"], ["config", "agent-dir"], ["session-of-pid"]]))
    for (const argv of verbs) {
      // __kill-guard is answered by compile-entry.ts before any boot step (#13449), never by the engine entry
      if (argv[0] === "__kill-guard") continue
      expect({ argv, routed: buildSenpiArgs([...argv, "x"], "/omo").slice(0, argv.length) }).toEqual({
        argv,
        routed: argv,
      })
    }
  })
})
