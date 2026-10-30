import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { handOffToProvisionedRuntime, planProvisionedLaunch, PROVISIONED_HANDOFF_ENV } from "../provisioned-handoff"
import { removeTree } from "../../../test-support/remove-tree"

const exe = process.platform === "win32" ? ".exe" : ""
const root = mkdtempSync(join(tmpdir(), "omo-provisioned-handoff-"))
const home = join(root, "home")
const download = join(root, "Downloads", `omo-${process.platform}-${process.arch}${exe}`)
const provisioned = join(home, ".omo", "binary-runtime", "handoff-fixture", `omo${exe}`)

// The long-name form: tmpdir() is an 8.3 short path (RUNNER~1) on Windows runners, process.execPath is not.
const canonical = (path: string) => realpathSync.native(path)

type Run = { code: number; stdout: string; stderr: string }
type Report = { version: string; execPath: string; args: string[]; launch: { provision: boolean; handOff: boolean } }

async function run(command: string[]): Promise<Run> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home }
  delete env.OMO_PROVISIONED_HANDOFF
  const child = Bun.spawn(command, { cwd: root, env, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { code, stdout, stderr }
}

function report(result: Run): Report {
  const line = result.stdout.trim().split(/\r?\n/).at(-1) ?? ""
  if (!line.startsWith("{")) throw new Error(`fixture printed no report (exit ${result.code}):\n${result.stdout}\n${result.stderr}`)
  return JSON.parse(line) as Report
}

beforeAll(async () => {
  mkdirSync(home, { recursive: true })
  mkdirSync(dirname(download), { recursive: true })
  const built = join(root, "build", `omo${exe}`)
  const entry = join(import.meta.dir, "fixtures", "provisioned-handoff", "entry.ts")
  const build = await run([process.execPath, "build", "--compile", entry, "--outfile", built])
  if (build.code !== 0) throw new Error(`bun build --compile failed:\n${build.stdout}\n${build.stderr}`)
  copyFileSync(built, download)
}, 120_000)

afterAll(() => removeTree(root))

describe("provisioned launch plan", () => {
  const expected = join(root, "runtime", `omo${exe}`)

  test("#given a raw download on any platform #when it plans its launch #then it provisions and hands off", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(planProvisionedLaunch(join(root, "Downloads", "omo-windows-x64.exe"), expected, { env })).toEqual(
      expect.objectContaining({ provision: true, handOff: true }),
    )
  })

  test("#given the child a launch handed off to #when its own identity is misreported #then it runs from the provisioned runtime without another handoff", () => {
    // given: the executable identity Bun reported on Windows in #7445, not the provisioned path
    const env: NodeJS.ProcessEnv = { [PROVISIONED_HANDOFF_ENV]: expected }
    // when
    const launch = planProvisionedLaunch("B:\\~BUN\\root\\omo-windows-x64.exe", expected, { env })
    // then: no loop, and the marker never reaches the engine or its children
    expect(launch).toEqual({ provision: false, handOff: false, execDir: dirname(expected) })
    expect(env[PROVISIONED_HANDOFF_ENV]).toBeUndefined()
  })

  test("#given a marker naming another runtime #when a download plans its launch #then the marker is dropped and the download still hands off", () => {
    const env: NodeJS.ProcessEnv = { [PROVISIONED_HANDOFF_ENV]: join(root, "other-version", `omo${exe}`) }
    expect(planProvisionedLaunch(join(root, "Downloads", `omo${exe}`), expected, { env }).handOff).toBe(true)
    expect(env[PROVISIONED_HANDOFF_ENV]).toBeUndefined()
  })

  test("#given a Windows handoff #when the child runs #then it gets the marker and the parent outlives Ctrl+C until the child exits", async () => {
    // given
    const before = process.listenerCount("SIGINT")
    const seen: { env?: NodeJS.ProcessEnv; sigintListeners?: number } = {}
    const propagated: unknown[] = []
    // when
    await handOffToProvisionedRuntime(expected, {
      argv: ["-p", "hi"], env: { KEEP: "1" }, platform: "win32",
      run: async (_file, _argv, options) => {
        seen.env = (options as { env?: NodeJS.ProcessEnv } | undefined)?.env
        seen.sigintListeners = process.listenerCount("SIGINT")
        return { status: 5, signal: null }
      },
      propagate: (result: unknown) => { propagated.push(result) },
    })
    // then
    expect(seen.env).toEqual({ KEEP: "1", [PROVISIONED_HANDOFF_ENV]: expected })
    expect(seen.sigintListeners).toBe(before + 1)
    expect(process.listenerCount("SIGINT")).toBe(before)
    expect(propagated).toEqual([{ status: 5, signal: null }])
  })
})

describe("a compiled omo launched from an empty download directory (#7485)", () => {
  test("#given a bare download #when it runs first, again, and from the provisioned runtime #then the engine always resolves package.json beside the provisioned runtime", async () => {
    // when: first launch provisions, then the engine runs
    const first = await run([download, "7", "two words"])
    // then
    const firstBody = report(first)
    expect(firstBody.version).toBe("0.0.0-handoff-fixture")
    expect(canonical(dirname(firstBody.execPath))).toBe(canonical(dirname(provisioned)))
    expect(firstBody.args).toEqual(["7", "two words"])
    expect(first.code).toBe(7)

    // when: the same download runs against an already provisioned runtime
    const again = await run([download, "3"])
    // then
    expect(report(again).version).toBe("0.0.0-handoff-fixture")
    expect(canonical(dirname(report(again).execPath))).toBe(canonical(dirname(provisioned)))
    expect(again.code).toBe(3)

    // when: the provisioned executable itself runs
    const direct = await run([provisioned, "0"])
    // then: it runs in place, with nothing to provision or hand off
    expect(report(direct).launch).toEqual(expect.objectContaining({ provision: false, handOff: false }))
    expect(canonical(dirname(report(direct).execPath))).toBe(canonical(dirname(provisioned)))
    expect(direct.code).toBe(0)
  }, 180_000)
})
