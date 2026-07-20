import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"
import { checkCodexComponents, type CodexComponentsDoctorDeps } from "./codex-components"

const PLUGIN_VERSION = "4.9.2"
const TEST_PLATFORM: NodeJS.Platform = "linux"
const TEST_ARCH = "x64"
const VALID_BINARY_BYTES = 16_000

const HOOK_TARGETS = [
  "components/telemetry/dist/cli.js",
  "components/ultrawork/dist/cli.js",
  "scripts/auto-update.mjs",
] as const
const WINDOWS_HOOK_TARGET = "components/bootstrap/scripts/bootstrap.ps1"
const MCP_TARGETS = ["components/codegraph/dist/serve.js", "components/context7/dist/cli.js", "components/lsp-daemon/dist/cli.js"] as const

interface BootstrapStateFixture {
  readonly completedForVersion?: string
  readonly lastAttemptAt?: number
  readonly lastStatus?: string
  readonly degraded?: ReadonlyArray<Record<string, unknown>>
}

interface FixtureOptions {
  readonly bootstrapState?: BootstrapStateFixture | null
  readonly omitTargets?: readonly string[]
  readonly zeroByteTargets?: readonly string[]
  readonly provisionSg?: boolean
}

interface Fixture {
  readonly root: string
  readonly codexHome: string
  readonly binDir: string
  readonly pluginRoot: string
  readonly runtimeSgPath: string
}

async function writeBundleFile(pluginRoot: string, relativePath: string, content: string | Buffer): Promise<void> {
  const target = join(pluginRoot, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content)
}

async function createInstalledFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "omo-codex-components-doctor-"))
  const codexHome = join(root, ".codex")
  const binDir = join(root, "bin")
  const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", PLUGIN_VERSION)
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(binDir, { recursive: true })
  await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo", version: PLUGIN_VERSION }))
  await writeFile(join(codexHome, "config.toml"), ['[plugins."omo@sisyphuslabs"]', "enabled = true", ""].join("\n"))

  await writeBundleFile(
    pluginRoot,
    "hooks/hooks.json",
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "${PLUGIN_ROOT}/components/telemetry/dist/cli.js" hook',
                commandWindows: 'powershell.exe -File "${PLUGIN_ROOT}\\components\\bootstrap\\scripts\\bootstrap.ps1"',
              },
              { type: "command", command: 'node "${PLUGIN_ROOT}/components/ultrawork/dist/cli.js" hook' },
              { type: "command", command: 'node "${PLUGIN_ROOT}/scripts/auto-update.mjs"' },
            ],
          },
        ],
      },
    }),
  )
  await writeBundleFile(
    pluginRoot,
    ".mcp.json",
    JSON.stringify({
      mcpServers: {
        codegraph: { command: "node", args: [join(pluginRoot, "components", "codegraph", "dist", "serve.js")] },
        context7: { command: "node", args: ["./components/context7/dist/cli.js", "mcp"] },
        lsp: { command: "node", args: ["./components/lsp-daemon/dist/cli.js", "mcp"] },
        grep_app: { url: "https://mcp.grep.app" },
      },
    }),
  )

  const omitted = new Set(options.omitTargets ?? [])
  const zeroed = new Set(options.zeroByteTargets ?? [])
  for (const target of [...HOOK_TARGETS, WINDOWS_HOOK_TARGET, ...MCP_TARGETS]) {
    if (omitted.has(target)) continue
    await writeBundleFile(pluginRoot, target, zeroed.has(target) ? "" : "// installed component payload\n")
  }

  const runtimeSgPath = join(codexHome, "runtime", "ast-grep", `${TEST_PLATFORM}-${TEST_ARCH}`, "sg")
  if (options.provisionSg ?? true) {
    await mkdir(dirname(runtimeSgPath), { recursive: true })
    await writeFile(runtimeSgPath, Buffer.alloc(VALID_BINARY_BYTES, 120))
  }

  const bootstrapState = options.bootstrapState === undefined
    ? { completedForVersion: PLUGIN_VERSION, lastAttemptAt: 1_770_000_000_000, lastStatus: "success", degraded: [] }
    : options.bootstrapState
  if (bootstrapState !== null) {
    const statePath = join(codexHome, "plugins", "data", "omo-sisyphuslabs", "bootstrap", "state.json")
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, JSON.stringify(bootstrapState))
  }

  return { root, codexHome, binDir, pluginRoot, runtimeSgPath }
}

function buildDeps(fixture: Fixture, overrides: Partial<CodexComponentsDoctorDeps> = {}): CodexComponentsDoctorDeps {
  return {
    codexHome: fixture.codexHome,
    binDir: fixture.binDir,
    detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    env: {},
    platform: TEST_PLATFORM,
    arch: TEST_ARCH,
    sgWhich: () => null,
    ...overrides,
  }
}

describe("codex components doctor check", () => {
  test("#given a complete installed plugin #when checking components #then passes with sg source and completed bootstrap", async () => {
    // given
    const fixture = await createInstalledFixture()

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("pass")
    expect(result.name).toBe("codex-components")
    expect(result.message).toBe("Codex component checks passed")
    expect(result.issues).toEqual([])
    expect(result.details).toContain(`ast_grep: ok (runtime dir: ${fixture.runtimeSgPath})`)
    expect(result.details).toContain(`bootstrap: completed@${PLUGIN_VERSION} (lastStatus=success)`)
    expect(result.details?.some((detail) => detail.startsWith("dist targets: ok"))).toBe(true)
  })

  test("#given a missing hook dist target #when checking components #then fails naming the relative path", async () => {
    // given
    const fixture = await createInstalledFixture({ omitTargets: ["components/telemetry/dist/cli.js"] })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("fail")
    const issue = result.issues.find((entry) => entry.title.includes("components/telemetry/dist/cli.js"))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe("error")
    expect(issue?.description).toContain("hooks/hooks.json")
    expect(issue?.fix).toContain("npx lazycodex-ai install")
  })

  test("#given a zero-byte mcp dist target #when checking components #then fails and reports the zero-byte state", async () => {
    // given
    const fixture = await createInstalledFixture({ zeroByteTargets: ["components/context7/dist/cli.js"] })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("fail")
    const issue = result.issues.find((entry) => entry.title.includes("components/context7/dist/cli.js"))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe("error")
    expect(issue?.description).toContain(".mcp.json")
    expect(issue?.description).toContain("zero bytes")
  })

  test("#given an absolute installed mcp dist target is missing #when checking components #then fails instead of treating the rewrite as drift", async () => {
    // given
    const fixture = await createInstalledFixture({ omitTargets: ["components/codegraph/dist/serve.js"] })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("fail")
    const issue = result.issues.find((entry) => entry.title.includes("components/codegraph/dist/serve.js"))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe("error")
    expect(issue?.description).toContain(".mcp.json")
  })

  test("#given a missing commandWindows target #when checking components #then the windows hook path is validated too", async () => {
    // given
    const fixture = await createInstalledFixture({ omitTargets: [WINDOWS_HOOK_TARGET] })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("fail")
    expect(result.issues.some((entry) => entry.title.includes(WINDOWS_HOOK_TARGET))).toBe(true)
  })

  test("#given sg resolvable nowhere in the chain #when checking components #then warns with a bootstrap hint", async () => {
    // given
    const fixture = await createInstalledFixture({ provisionSg: false })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("warn")
    expect(result.details).toContain("ast_grep: missing")
    const issue = result.issues.find((entry) => entry.title.includes("ast_grep"))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe("warning")
    expect(issue?.description).toContain("ast-grep skill")
    expect(issue?.fix).toContain("ast-grep skill")
    expect(issue?.fix).toContain("npx lazycodex-ai doctor")
    expect(issue?.fix).toContain("omo doctor")
    expect(issue?.affects).toEqual(["ast-grep skill"])
  })

  test("#given an OMO_AST_GREP_SG_PATH override #when checking components #then reports the env override source", async () => {
    // given
    const fixture = await createInstalledFixture({ provisionSg: false })
    const overridePath = join(fixture.root, "custom-sg")
    await writeFile(overridePath, Buffer.alloc(VALID_BINARY_BYTES, 121))

    // when
    const result = await checkCodexComponents(
      buildDeps(fixture, { env: { OMO_AST_GREP_SG_PATH: overridePath } }),
    )

    // then
    expect(result.status).toBe("pass")
    expect(result.details).toContain(`ast_grep: ok (env override OMO_AST_GREP_SG_PATH: ${overridePath})`)
  })

  test("#given sg only resolvable through PATH #when checking components #then reports the PATH source", async () => {
    // given
    const fixture = await createInstalledFixture({ provisionSg: false })
    const pathSg = join(fixture.root, "bin", "sg")
    await writeFile(pathSg, Buffer.alloc(VALID_BINARY_BYTES, 122))

    // when
    const result = await checkCodexComponents(
      buildDeps(fixture, {
        sgRunVersionProbeSync: () => "ast-grep 0.43.0",
        sgWhich: (commandName) => (commandName === "sg" ? pathSg : null),
      }),
    )

    // then
    expect(result.status).toBe("pass")
    expect(result.details).toContain(`ast_grep: ok (PATH: ${pathSg})`)
  })

  test("#given no bootstrap state file #when checking components #then surfaces bootstrap pending as info detail without issues", async () => {
    // given
    const fixture = await createInstalledFixture({ bootstrapState: null })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("pass")
    expect(result.issues).toEqual([])
    expect(
      result.details?.some((detail) => detail.includes("bootstrap pending — start a Codex session")),
    ).toBe(true)
    expect(result.details?.some((detail) => detail.includes("state none"))).toBe(true)
  })

  test("#given completedForVersion behind the installed version #when checking components #then reports bootstrap pending with both versions", async () => {
    // given
    const fixture = await createInstalledFixture({
      bootstrapState: { completedForVersion: "4.0.0", lastStatus: "success", degraded: [] },
    })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("pass")
    const pending = result.details?.find((detail) => detail.includes("bootstrap pending — start a Codex session"))
    expect(pending).toBeDefined()
    expect(pending).toContain(`installed ${PLUGIN_VERSION}`)
    expect(pending).toContain("state 4.0.0")
  })

  test("#given a degraded bootstrap ledger #when checking components #then surfaces every degraded entry verbatim", async () => {
    // given
    const fixture = await createInstalledFixture({
      bootstrapState: {
        completedForVersion: PLUGIN_VERSION,
        lastStatus: "degraded",
        degraded: [
          { component: "ast_grep", reason: "download failed: checksum mismatch", hint: "npx lazycodex-ai doctor" },
          { component: "omo-cli", reason: "payload has no dist/cli" },
        ],
      },
    })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.details).toContain(`bootstrap: degraded@${PLUGIN_VERSION} (lastStatus=degraded)`)
    expect(result.details).toContain(
      "degraded component=ast_grep reason=download failed: checksum mismatch hint=npx lazycodex-ai doctor",
    )
    expect(result.details).toContain("degraded component=omo-cli reason=payload has no dist/cli")
  })

  test("#given malformed bootstrap state json #when checking components #then treats bootstrap as pending without crashing", async () => {
    // given
    const fixture = await createInstalledFixture({ bootstrapState: null })
    const statePath = join(fixture.codexHome, "plugins", "data", "omo-sisyphuslabs", "bootstrap", "state.json")
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, "{not-json")

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("pass")
    expect(
      result.details?.some((detail) => detail.includes("bootstrap pending — start a Codex session")),
    ).toBe(true)
  })

  test("#given a nested dev manifest pointing outside the bundle #when checking components #then out-of-bundle dev refs are tolerated", async () => {
    // given
    const fixture = await createInstalledFixture()
    await writeBundleFile(
      fixture.pluginRoot,
      "components/local-dev/.mcp.json",
      JSON.stringify({ mcpServers: { local_dev: { command: "node", args: ["../../../../dev-packages/custom-mcp/dist/cli.js", "mcp"] } } }),
    )

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("pass")
    expect(result.issues).toEqual([])
  })

  test("#given no installed plugin #when checking components #then skips instead of duplicating the codex check error", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-components-missing-"))

    // when
    const result = await checkCodexComponents(
      buildDeps({ root, codexHome: join(root, ".codex"), binDir: join(root, "bin"), pluginRoot: "", runtimeSgPath: "" }),
    )

    // then
    expect(result.status).toBe("skip")
    expect(result.message).toContain("not installed")
    expect(result.issues).toEqual([])

    await rm(root, { recursive: true, force: true })
  })

  test("#given both a missing dist and missing sg #when checking components #then fail status wins and both surfaces report", async () => {
    // given
    const fixture = await createInstalledFixture({
      omitTargets: ["components/telemetry/dist/cli.js"],
      provisionSg: false,
    })

    // when
    const result = await checkCodexComponents(buildDeps(fixture))

    // then
    expect(result.status).toBe("fail")
    expect(result.message).toBe("2 Codex component issue(s) detected")
    expect(result.issues.map((issue) => issue.severity).sort()).toEqual(["error", "warning"])
  })
})
