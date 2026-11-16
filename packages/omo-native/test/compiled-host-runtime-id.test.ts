import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { buildSenpiArgs } from "../compile-args"

// `omo host ensure` reports the runtime id a host started from its launch spec
// would have (`clientRuntimeBuildId`), and the host it starts reports the id of what its own argv loads
// (`runtimeBuildId`). The host child re-enters this binary, so whatever the compiled wrapper adds to that argv must
// be something the CLI predicted too, or one binary reports two ids and every handover is refused.

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ENGINE_ROOT = dirname(dirname(Bun.resolveSync("@code-yeongyu/senpi", SOURCE_ROOT)))
const engineModule = async (relative: string): Promise<Record<string, unknown>> =>
  import(pathToFileURL(join(ENGINE_ROOT, "dist", relative)).href)

type LaunchProfile = { core: { extensions: string[]; multi_session: boolean; session_runtime: string } }
type ResolvedSpec = { hostArgs: readonly string[] }

async function engine() {
  const spec = await engineModule("modes/rpc/host-launch-spec.js")
  const identity = await engineModule("modes/rpc/protocol-identity.js")
  const buildId = await engineModule("modes/rpc/runtime-build-id.js")
  const lifecycle = await engineModule("modes/rpc/host-lifecycle-launch.js")
  return {
    loadHostLaunchSpec: spec.loadHostLaunchSpec as (path: string) => Promise<ResolvedSpec>,
    defaultSpec: spec.DEFAULT_HOST_LAUNCH_SPEC as ResolvedSpec,
    hostLaunchProfile: identity.hostLaunchProfile as (argv: readonly string[], cwd: string) => LaunchProfile,
    socketHostLaunchProfile: identity.socketHostLaunchProfile as (
      hostArgs: readonly string[],
      cwd: string,
    ) => LaunchProfile,
    computeRuntimeBuildId: buildId.computeRuntimeBuildId as (input: unknown) => Promise<string>,
    resolveHostChildLaunch: lifecycle.resolveHostChildLaunch as (
      launch: { hostArgs: readonly string[] },
      internalSocket: string,
      compiled: boolean,
    ) => { command: string; args: string[] },
  }
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function compiledRuntime() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-host-runtime-id-")))
  roots.push(root)
  const execDir = join(root, "binary-runtime", "1.2.3")
  const plugin = join(execDir, "plugin")
  mkdirSync(join(plugin, "extensions"), { recursive: true })
  writeFileSync(join(execDir, "omo"), "compiled executable bytes\n")
  writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "omo-senpi-plugin", version: "1.2.3" }))
  writeFileSync(join(plugin, "extensions", "omo-member.js"), "export default () => {}\n")
  writeFileSync(
    join(plugin, "daemon-launch-spec.json"),
    JSON.stringify({
      spec_version: 1,
      core: { session_runtime: "in-process", multi_session: true, extensions: [".", "./extensions/omo-member.js"] },
    }),
  )
  // The engine acts on a spec only when group and world cannot write it.
  for (const dir of [root, join(root, "binary-runtime"), execDir, plugin, join(plugin, "extensions")])
    chmodSync(dir, 0o755)
  chmodSync(join(plugin, "daemon-launch-spec.json"), 0o644)
  const copiedSpec = () => {
    const copy = join(root, "agent", "desktop-launch-profiles", "copy")
    mkdirSync(dirname(copy), { recursive: true, mode: 0o755 })
    chmodSync(join(root, "agent"), 0o755)
    cpSync(plugin, copy, { recursive: true })
    return join(copy, "daemon-launch-spec.json")
  }
  return { root, execDir, plugin, copiedSpec }
}

async function bothIds(runtime: ReturnType<typeof compiledRuntime>, ensureArgs: string[]) {
  const senpi = await engine()
  const source = { flavour: "compiled", root: join(runtime.execDir, "omo") }
  const idOf = (profile: LaunchProfile) =>
    senpi.computeRuntimeBuildId({ profile: profile.core, source, platform: "linux", arch: "x64", engine: "test" })
  // The CLI: the wrapper builds the engine argv, the engine reads `--launch-spec` and predicts the host.
  const cliArgs = buildSenpiArgs(["host", "ensure", "--json", ...ensureArgs], runtime.execDir)
  const specFlag = cliArgs.indexOf("--launch-spec")
  const specPath = specFlag === -1 ? undefined : cliArgs[specFlag + 1]
  if (specFlag !== -1 && specPath === undefined) throw new Error(`--launch-spec has no value in ${cliArgs.join(" ")}`)
  const spec = specPath === undefined ? senpi.defaultSpec : await senpi.loadHostLaunchSpec(specPath)
  const client = await idOf(senpi.socketHostLaunchProfile(spec.hostArgs, runtime.root))
  // The host: the supervisor spawns this executable again, and the wrapper builds that argv too.
  const child = senpi.resolveHostChildLaunch({ hostArgs: spec.hostArgs }, join(runtime.root, "host.sock"), true)
  const hostProfile = senpi.hostLaunchProfile(buildSenpiArgs(child.args, runtime.execDir), runtime.root)
  return { client, host: await idOf(hostProfile), hostExtensions: hostProfile.core.extensions }
}

describe("one compiled binary reports one runtime id for the host it starts", () => {
  test("#given host ensure with no launch spec #when the host starts #then its id is the CLI's and it loads the plugin", async () => {
    // given
    const runtime = compiledRuntime()
    // when
    const ids = await bothIds(runtime, [])
    // then
    expect(ids.host).toBe(ids.client)
    expect(ids.hostExtensions).toContain(runtime.plugin)
  })

  test("#given the runtime's own launch spec #when the host starts #then its id is the CLI's", async () => {
    // given
    const runtime = compiledRuntime()
    // when
    const ids = await bothIds(runtime, ["--launch-spec", join(runtime.plugin, "daemon-launch-spec.json")])
    // then
    expect(ids.host).toBe(ids.client)
  })

  test("#given a user-owned copy of the launch spec #when the host starts #then its id is the CLI's and the plugin loads once", async () => {
    // given
    const runtime = compiledRuntime()
    const spec = runtime.copiedSpec()
    // when
    const ids = await bothIds(runtime, ["--launch-spec", spec])
    // then
    expect(ids.host).toBe(ids.client)
    expect(ids.hostExtensions).not.toContain(runtime.plugin)
  })
})

describe("a spec with no extensions, and every host command the wrapper gives this runtime's spec", () => {
  test("#given a launch spec that lists no extensions #when the host starts #then its id is the CLI's and no plugin is added", async () => {
    // given
    const runtime = compiledRuntime()
    const bare = join(runtime.root, "bare-spec")
    mkdirSync(bare, { recursive: true, mode: 0o755 })
    chmodSync(bare, 0o755)
    const spec = join(bare, "daemon-launch-spec.json")
    writeFileSync(
      spec,
      JSON.stringify({ spec_version: 1, core: { session_runtime: "in-process", multi_session: true, extensions: [] } }),
    )
    chmodSync(spec, 0o644)
    // when
    const ids = await bothIds(runtime, ["--launch-spec", spec])
    // then
    expect(ids.host).toBe(ids.client)
    expect(ids.hostExtensions).toEqual([])
  })

  test("#given host handoff and host session open without a spec #when the wrapper builds their argv #then each gets this runtime's spec", () => {
    // given
    const runtime = compiledRuntime()
    const own = join(runtime.plugin, "daemon-launch-spec.json")
    // when
    const handoff = buildSenpiArgs(["host", "handoff", "--json"], runtime.execDir)
    const open = buildSenpiArgs(["host", "session", "open", "--json"], runtime.execDir)
    // then
    expect({ handoff, open }).toEqual({
      handoff: ["host", "handoff", "--json", "--launch-spec", own],
      open: ["host", "session", "open", "--json", "--launch-spec", own],
    })
  })

  test("#given --launch-spec=<path> or a -- tail #when the wrapper builds the argv #then the caller's spec is kept and the tail stays last", () => {
    // given
    const runtime = compiledRuntime()
    const own = join(runtime.plugin, "daemon-launch-spec.json")
    // when
    const inline = buildSenpiArgs(["host", "ensure", "--launch-spec=/elsewhere/spec.json"], runtime.execDir)
    const tail = buildSenpiArgs(["host", "ensure", "--json", "--", "--launch-spec", "literal"], runtime.execDir)
    // then
    expect({ inline, tail }).toEqual({
      inline: ["host", "ensure", "--launch-spec=/elsewhere/spec.json"],
      tail: ["host", "ensure", "--json", "--launch-spec", own, "--", "--launch-spec", "literal"],
    })
  })
})
