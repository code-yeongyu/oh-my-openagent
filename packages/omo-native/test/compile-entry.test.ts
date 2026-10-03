import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  compiledBannerLines,
  answerCompiledFastPath,
  buildSenpiArgs,
  remapSenpiEnvironment,
  reexecProvisionedRuntime,
  runCompiledLauncher,
  shouldPrintCompiledBanner,
  updateHint,
  versionLine,
} from "../compile-entry"
import { compiledUpdate, pickUpdateVersion, releaseAssetName, releaseVersionOf, replaceCommand } from "../compiled-update"
import { engineDependencyDir } from "../bin/lib/engine-dependency.js"
import { registerEngineRuntimeModules } from "../engine-runtime-modules"
import {
  isProvisionedExecutable,
  materializeProvisionedExecutable,
  provisionEmbeddedRuntime,
  runningExecutablePath,
  selectRuntimeManifest,
  type EmbeddedManifest,
} from "../compile-runtime"

const senpiRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))))
const piAiRoot = engineDependencyDir(senpiRoot, "@earendil-works/pi-ai")
if (piAiRoot === undefined) throw new Error(`@earendil-works/pi-ai is not resolvable from ${senpiRoot}`)
const importPiAi = (relative: string) => import(pathToFileURL(join(piAiRoot, "dist", relative)).href)
const { loadChatGptSubscriptionOAuth } = await importPiAi("auth/oauth/load.js")
const { chatgptSubscriptionOAuth } = await importPiAi("auth/oauth/chatgpt-subscription.js")
const { chatgptSubscriptionProvider } = await importPiAi("providers/chatgpt-subscription.js")

const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(homedir(), "omo-compile-entry-test-")); roots.push(root); return root }
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe("provisioned executable handoff", () => {
  for (const platform of ["darwin", "linux"] as const) {
    test(`execve on ${platform} keeps argv[0] and the exact environment without a child`, async () => {
      // given
      const env = { PRESERVED: "compiled-fixture" }
      const execs: unknown[][] = []
      const spawns: unknown[][] = []
      const propagated: unknown[] = []
      // when
      await reexecProvisionedRuntime("/runtime/omo", {
        argv: ["--mode", "rpc"], env, platform,
        execve: (...args) => { execs.push(args) },
        run: async (...args) => { spawns.push(args); return { status: 37, signal: null } },
        propagate: (result: unknown) => { propagated.push(result) },
      })
      // then
      expect(execs).toEqual([["/runtime/omo", ["/runtime/omo", "--mode", "rpc"], env]])
      expect(spawns).toEqual([])
      expect(propagated).toEqual([])
    })
  }

  for (const mode of ["win32", "absent", "throw"] as const) {
    test(`preserves the async child result when execve is ${mode}`, async () => {
      // given
      const env = { PRESERVED: "fallback-fixture" }
      const spawns: unknown[][] = []
      const propagated: unknown[] = []
      let execs = 0
      // when
      await reexecProvisionedRuntime("/runtime/omo", {
        argv: ["--mode", "rpc"], env, platform: mode === "win32" ? "win32" : "linux",
        execve: mode === "absent" ? null : () => { execs += 1; throw new Error("injected unavailable") },
        run: async (...args) => { spawns.push(args); return { status: 37, signal: null } },
        propagate: (result: unknown) => { propagated.push(result) },
      })
      // then
      expect(execs).toBe(mode === "throw" ? 1 : 0)
      expect(spawns).toEqual([["/runtime/omo", ["--mode", "rpc"], { env }]])
      expect(propagated).toEqual([{ status: 37, signal: null }])
    })
  }
})

describe("compiled OMO OAuth module identity", () => {
  test("registers the loader in the same pi-ai graph senpi resolves for the provider", async () => {
    await registerEngineRuntimeModules()
    const loadedFlow = await loadChatGptSubscriptionOAuth()

    expect(loadedFlow).toBe(chatgptSubscriptionOAuth)
    expect(chatgptSubscriptionProvider().id).toBe("chatgpt-subscription")
  })

  test("derives OpenAI Codex request auth from a stored OAuth credential", async () => {
    const secret = "review-secret-must-not-be-printed"
    const credential = { type: "oauth" as const, access: secret, refresh: "discarded", expires: Date.now() + 60_000 }

    const auth = await chatgptSubscriptionProvider().auth.oauth?.toAuth(credential)

    expect(auth).toEqual({ apiKey: secret })
  })
})

describe("compiled omo entry launcher parity", () => {
  test("uses the launched Windows executable path for self-provisioning identity", () => {
    expect(runningExecutablePath("C:\\runtime\\omo.exe", "B:\\~BUN\\root\\omo.exe", "win32")).toBe(
      "C:\\runtime\\omo.exe",
    )
    expect(runningExecutablePath("bun", "/usr/local/bin/bun", "win32")).toBe("/usr/local/bin/bun")
    expect(runningExecutablePath("/runtime/omo", "/usr/local/bin/bun", "darwin")).toBe("/usr/local/bin/bun")
  })

  test("strips Linux procfs deleted suffix but preserves it on other platforms", () => {
    const deletedPath = "/runtime/omo (deleted)"
    expect(runningExecutablePath("/runtime/omo", deletedPath, "linux")).toBe("/runtime/omo")
    // Only Linux procfs produces this exact suffix; other platforms leave it untouched.
    expect(runningExecutablePath("/runtime/omo", deletedPath, "darwin")).toBe(deletedPath)
    expect(runningExecutablePath("/runtime/omo", deletedPath, "win32")).toBe(deletedPath)
  })

  test("recognizes a deleted Linux executable as the provisioned path", () => {
    const root = temp()
    const expected = join(root, "omo")
    writeFileSync(expected, "binary")

    expect(isProvisionedExecutable(runningExecutablePath(expected, `${expected} (deleted)`, "linux"), expected)).toBe(true)
  })

  test("re-exec without an injected runner runs the provisioned child through the default runner", async () => {
    // given: no run override and no execve, the path Windows always takes
    const propagated: unknown[] = []

    // when: the provisioned "runtime" is this bun binary told to exit with a distinctive code
    await reexecProvisionedRuntime(process.execPath, {
      argv: ["-e", "process.exit(7)"],
      execve: null,
      propagate: (result) => { propagated.push(result) },
    })

    // then: the real child ran and its exit status reached propagation
    expect(propagated).toHaveLength(1)
    expect(propagated[0]).toMatchObject({ status: 7, signal: null })
  })

  test("pins the engine package dir to the provisioned root", () => {
    // Defence in depth alongside the re-exec: PACKAGE_DIR is consulted by
    // getPackageDir() ahead of dirname(process.execPath), so the engine stays
    // correct on any path that reaches it without having been re-executed.
    const env = remapSenpiEnvironment({}, "/provisioned/root")
    expect(env.OMO_PACKAGE_DIR ?? env.SENPI_PACKAGE_DIR).toBe("/provisioned/root")
  })

  test("early commands pass through without an extension", () => {
    expect(buildSenpiArgs(["install", "x"], "/provisioned")).toEqual(["install", "x"])
  })

  test("app-server appends the provisioned plugin after its subcommand", () => {
    expect(buildSenpiArgs(["app-server", "daemon", "start"], "/provisioned")).toEqual([
      "app-server", "daemon", "start", "--extension", join("/provisioned", "plugin"),
    ])
  })

  test("main commands prepend the provisioned plugin extension", () => {
    expect(buildSenpiArgs(["chat"], "/provisioned")).toEqual(["--extension", join("/provisioned", "plugin"), "chat"])
  })

  test("--no-extensions leaves the caller's extension list untouched", () => {
    // A memory child lists no extensions and an RPC child lists the plugin itself; injecting the
    // plugin on top would either load it into a bare child or load it twice.
    const bare = ["-p", "--no-extensions", "--tools", "bash,edit", "@/tmp/task.md"]
    const rpc = ["--mode", "rpc", "--no-extensions", "--extension", join("/provisioned", "plugin")]
    expect(buildSenpiArgs(bare, "/provisioned")).toEqual(bare)
    expect(buildSenpiArgs(rpc, "/provisioned")).toEqual(rpc)
  })

  test("version line reads the sibling package version and pinned engine", () => {
    expect(versionLine({ version: "9.2.1" }, "2026.8.28")).toBe(
      "omo 9.2.1 (engine: senpi 2026.8.28; scheme nodef)",
    )
  })

  test("version line records the senpi-package epoch path when engineBuild is stamped", () => {
    expect(versionLine({
      version: "9.2.1",
      engineBuild: {
        scheme: "epoch",
        epoch: 1788486552,
        sha7: "7fd18df",
        source: "senpi-package",
      },
    }, "2026.9.17")).toBe(
      "omo 9.2.1 (engine: senpi 2026.9.17+1788486552.7fd18df; scheme epoch)",
    )
  })

  test("realpath-equivalent executable and expected paths skip re-exec", () => {
    const root = temp()
    const executable = join(root, "omo")
    const expected = join(root, "runtime", "omo")
    writeFileSync(executable, "binary")
    mkdirSync(join(root, "runtime"), { recursive: true })
    symlinkSync(executable, expected)
    expect(isProvisionedExecutable(expected, executable)).toBe(true)
  })

  test("a release build's update notice points at omo update instead of a fixed download", () => {
    const env = remapSenpiEnvironment({ PATH: "/bin" }, temp())
    const brand = JSON.parse(env.SENPI_BRAND ?? "{}") as { update?: { command?: string } }
    expect(brand.update?.command).toBe("omo update")
  })

  test("package-root environment values point into the provisioned runtime", () => {
    const env = remapSenpiEnvironment({ OMO_BIN: "/old", SENPI_BIN: "/old-senpi", PATH: "/bin" }, "/provisioned")
    expect(env.OMO_AGENT_TOOLKIT_BIN).toBeUndefined()
    expect(env.OMO_BIN).toBe(join("/provisioned", process.platform === "win32" ? "omo.exe" : "omo"))
    expect(env.OMO_CODING_AGENT_DIR).toBeDefined()
  })
})

describe("pre-provisioning fast paths", () => {
  const manifest: EmbeddedManifest = { omoAiVersion: "9.9.9", enginePin: "2026.1.1", manifestSha: "m", entries: [] }

  const captureLog = (run: () => boolean): { handled: boolean; output: string[] } => {
    const output: string[] = []
    const originalLog = console.log
    console.log = (value?: unknown) => { output.push(String(value)) }
    try {
      return { handled: run(), output }
    } finally {
      console.log = originalLog
    }
  }

  test("answers --version from the embedded manifest before provisioning", () => {
    const { handled, output } = captureLog(() => answerCompiledFastPath(["--version"], manifest))
    expect(handled).toBe(true)
    expect(output).toEqual(["omo 9.9.9 (engine: senpi 2026.1.1; scheme nodef)"])
  })

  test("-v answers while --version with extra arguments falls through", () => {
    expect(captureLog(() => answerCompiledFastPath(["-v"], manifest)).handled).toBe(true)
    const extra = captureLog(() => answerCompiledFastPath(["--version", "--json"], manifest))
    expect(extra.handled).toBe(false)
    expect(extra.output).toEqual([])
  })

  test("self-update spellings are answered while engine updates fall through", () => {
    const selfUpdate = captureLog(() => answerCompiledFastPath(["update"], manifest))
    expect(selfUpdate.handled).toBe(true)
    expect(selfUpdate.output[0]).toContain("omo-")
    expect(captureLog(() => answerCompiledFastPath(["update", "self"], manifest)).handled).toBe(true)
    expect(captureLog(() => answerCompiledFastPath(["update", "--extensions"], manifest)).handled).toBe(false)
  })

  test("ordinary commands never fast-path", () => {
    const result = captureLog(() => answerCompiledFastPath(["chat"], manifest))
    expect(result.handled).toBe(false)
    expect(result.output).toEqual([])
  })

  test("fast-path version line matches the provisioned launcher's line for the same stamp", async () => {
    const root = temp()
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: manifest.omoAiVersion }))
    const fast = captureLog(() => answerCompiledFastPath(["--version"], manifest))
    const provisionedOutput: string[] = []
    const originalLog = console.log
    console.log = (value?: unknown) => { provisionedOutput.push(String(value)) }
    try {
      await runCompiledLauncher(["--version"], root, manifest.enginePin)
    } finally {
      console.log = originalLog
    }
    expect(fast.output).toEqual(provisionedOutput)
  })

  test("banner gate requires a tty and an interactive-default launch", () => {
    expect(shouldPrintCompiledBanner(["chat"], true)).toBe(true)
    expect(shouldPrintCompiledBanner([], true)).toBe(true)
    expect(shouldPrintCompiledBanner(["chat"], false)).toBe(false)
    expect(shouldPrintCompiledBanner(["-p", "hi"], true)).toBe(false)
    expect(shouldPrintCompiledBanner(["--print", "hi"], true)).toBe(false)
    expect(shouldPrintCompiledBanner(["--mode", "rpc"], true)).toBe(false)
    expect(shouldPrintCompiledBanner(["install", "x"], true)).toBe(false)
    expect(shouldPrintCompiledBanner(["--version"], true)).toBe(false)
    expect(shouldPrintCompiledBanner(["update"], true)).toBe(false)
  })
})

describe("embedded runtime provisioning", () => {
  test("materializes the executable directly on Windows", () => {
    const root = temp()
    const source = join(root, "source.exe")
    const destination = join(root, "runtime", "omo.exe")
    mkdirSync(join(root, "runtime"), { recursive: true })
    writeFileSync(source, "compiled binary")

    materializeProvisionedExecutable(source, destination, "win32")

    expect(readFileSync(destination, "utf8")).toBe("compiled binary")
  })

  test("does not overwrite an existing Windows provisioned executable", () => {
    const root = temp()
    const source = join(root, "source.exe")
    const destination = join(root, "runtime", "omo.exe")
    mkdirSync(join(root, "runtime"), { recursive: true })
    writeFileSync(source, "new binary")
    writeFileSync(destination, "existing binary")

    materializeProvisionedExecutable(source, destination, "win32")

    expect(readFileSync(destination, "utf8")).toBe("existing binary")
  })

  test("skips re-copying an identical provisioned executable on POSIX", () => {
    const root = temp()
    const source = join(root, "source.exe")
    const destination = join(root, "runtime", "omo.exe")
    mkdirSync(join(root, "runtime"), { recursive: true })
    writeFileSync(source, "compiled binary")

    materializeProvisionedExecutable(source, destination, "darwin")
    const first = statSync(destination).mtimeMs

    materializeProvisionedExecutable(source, destination, "darwin")

    // Copying ~114MB on every launch was the dominant cold-start cost; an
    // unchanged destination must not be rewritten.
    expect(statSync(destination).mtimeMs).toBe(first)
    expect(readFileSync(destination, "utf8")).toBe("compiled binary")
  })

  test("still replaces a provisioned executable whose contents differ on POSIX", () => {
    const root = temp()
    const source = join(root, "source.exe")
    const destination = join(root, "runtime", "omo.exe")
    mkdirSync(join(root, "runtime"), { recursive: true })
    writeFileSync(source, "new binary")
    writeFileSync(destination, "stale binary of different length")

    materializeProvisionedExecutable(source, destination, "darwin")

    expect(readFileSync(destination, "utf8")).toBe("new binary")
  })

  test("materializes the executable through a temporary non-executable path on POSIX", () => {
    const root = temp()
    const source = join(root, "source.exe")
    const destination = join(root, "runtime", "omo.exe")
    mkdirSync(join(root, "runtime"), { recursive: true })
    writeFileSync(source, "compiled binary")

    materializeProvisionedExecutable(source, destination, "darwin")

    expect(readFileSync(destination, "utf8")).toBe("compiled binary")
    expect(existsSync(`${destination}.tmp-${process.pid}`)).toBe(false)
  })

  test("keeps an existing destination when the deleted Linux source cannot be read", () => {
    const root = temp()
    const source = join(root, "missing-source (deleted)")
    const destination = join(root, "runtime", "omo")
    mkdirSync(join(root, "runtime"), { recursive: true })
    writeFileSync(destination, "already-provisioned")

    expect(() => materializeProvisionedExecutable(source, destination, "linux")).not.toThrow()
    expect(readFileSync(destination, "utf8")).toBe("already-provisioned")
  })

  test("still throws when the deleted Linux source and destination are both absent", () => {
    const root = temp()
    const source = join(root, "missing-source (deleted)")
    const destination = join(root, "runtime", "omo")
    mkdirSync(join(root, "runtime"), { recursive: true })

    expect(() => materializeProvisionedExecutable(source, destination, "linux")).toThrow()
  })

  test("selects the omo manifest when senpi also embeds an unrelated manifest", async () => {
    const senpiManifest = { name: "runtime/lsp-daemon/dist/.omo-runtime-manifest.json", text: async () => JSON.stringify({ files: [] }) }
    const omoManifest = { name: "omo-runtime/runtime-manifest.json", text: async () => JSON.stringify({ omoAiVersion: "9.2.1", enginePin: "2026.8.28" }) }
    await expect(selectRuntimeManifest([senpiManifest, omoManifest] as any[])).resolves.toBe(omoManifest as any)
  })

  test("compiled doctor resolves package artifacts from the provided execDir", async () => {
    const root = temp()
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.2.1" }))
    for (const artifact of ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js"]) {
      const path = join(root, artifact)
      mkdirSync(join(path, ".."), { recursive: true })
      writeFileSync(path, "fixture\n")
    }
    const output: string[] = []
    const originalLog = console.log
    const originalExitCode = process.exitCode
    console.log = (value?: unknown) => { output.push(String(value)) }
    process.exitCode = undefined
    try {
      await runCompiledLauncher(["doctor"], root, "2026.8.28", root)
    } finally {
      console.log = originalLog
      process.exitCode = originalExitCode
    }
    expect(output.join("\n")).toContain("PASS plugin manifest: plugin/package.json")
    expect(output.join("\n")).toContain("INFO omo 9.2.1 (engine: senpi 2026.8.28; scheme nodef)")
  })

  test("compiled doctor reports an npm omo-ai that the standalone binary shadows on PATH", async () => {
    const root = temp()
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.2.1" }))
    const home = join(root, "home")
    const binary = Buffer.concat([Buffer.from("omo-binary"), Buffer.alloc(4096, 1)])
    mkdirSync(join(home, ".omo", "binary-runtime", "9.2.1"), { recursive: true })
    writeFileSync(join(home, ".omo", "binary-runtime", "9.2.1", "omo"), binary)
    mkdirSync(join(root, "local-bin"), { recursive: true })
    writeFileSync(join(root, "local-bin", "omo"), binary)
    const bunRoot = join(root, "bun")
    const pkg = join(bunRoot, "install", "global", "node_modules", "omo-ai")
    mkdirSync(join(pkg, "bin"), { recursive: true })
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "omo-ai", version: "9.2.0" }))
    writeFileSync(join(pkg, "bin", "omo.js"), "#!/usr/bin/env node\n")
    mkdirSync(join(bunRoot, "bin"), { recursive: true })
    symlinkSync(join(pkg, "bin", "omo.js"), join(bunRoot, "bin", "omo"))
    const output: string[] = []
    const originalLog = console.log
    const originalExitCode = process.exitCode
    console.log = (value?: unknown) => { output.push(String(value)) }
    try {
      await runCompiledLauncher(["doctor"], root, "2026.8.28", root, {
        env: { PATH: [join(root, "local-bin"), join(bunRoot, "bin")].join(delimiter), BUN_INSTALL: bunRoot },
        homeDir: home,
        platform: "linux",
      })
    } finally {
      console.log = originalLog
      process.exitCode = originalExitCode
    }
    const warning = output.join("\n").split("\n").find((line) => line.startsWith("WARN more than one OmO install is on PATH:"))
    expect(warning).toContain("(standalone omo binary 9.2.1) runs when you type omo")
    expect(warning).toContain("omo-ai@9.2.0")
  })

  test("version uses the manifest engine pin without a provisioned senpi package", async () => {
    const root = temp()
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.2.1" }))
    const output: string[] = []
    const originalLog = console.log
    console.log = (value?: unknown) => { output.push(String(value)) }
    try {
      await runCompiledLauncher(["--version"], root, "2026.8.28")
    } finally {
      console.log = originalLog
    }
    expect(output).toEqual(["omo 9.2.1 (engine: senpi 2026.8.28; scheme nodef)"])
  })

  test("materializes files whose embedded names carry the omo-runtime prefix", async () => {
    const root = temp()
    const content = "hello changelog\n"
    const manifest: EmbeddedManifest = {
      omoAiVersion: "9.2.1",
      enginePin: "2026.8.28",
      manifestSha: "prefixed-manifest",
      entries: [{ relPath: "CHANGELOG.md", sha256: sha(content), mode: 0o644, size: Buffer.byteLength(content) }],
    }
    const runtime = join(root, "runtime")
    await provisionEmbeddedRuntime(manifest, [{ name: "omo-runtime/CHANGELOG.md", arrayBuffer: async () => new TextEncoder().encode(content).buffer }] as any[], runtime)
    expect(readFileSync(join(runtime, "CHANGELOG.md"), "utf8")).toBe(content)
  })

  test("materializes non-utf8 embedded bytes without a text round-trip", async () => {
    const root = temp()
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0xc3])
    const manifest: EmbeddedManifest = {
      omoAiVersion: "9.2.1",
      enginePin: "2026.8.28",
      manifestSha: "binary-manifest",
      entries: [{ relPath: "assets/clankolas.png", sha256: createHash("sha256").update(bytes).digest("hex"), mode: 0o644, size: bytes.byteLength }],
    }
    const runtime = join(root, "runtime")
    await provisionEmbeddedRuntime(manifest, [{ name: "omo-runtime/assets/clankolas.png", arrayBuffer: async () => bytes.buffer }] as any[], runtime)
    expect(new Uint8Array(readFileSync(join(runtime, "assets/clankolas.png")))).toEqual(bytes)
  })

  test("materializes files with sha256 and mode, then skips on matching marker", async () => {
    const root = temp()
    const content = "hello runtime\n"
    const manifest: EmbeddedManifest = {
      omoAiVersion: "9.2.1",
      enginePin: "2026.8.28",
      manifestSha: "manifest-sha",
      entries: [{ relPath: "package.json", sha256: sha(content), mode: 0o644, size: Buffer.byteLength(content) }],
    }
    const embedded = [{ name: "package.json", arrayBuffer: async () => new TextEncoder().encode(content).buffer }] as any[]
    const runtime = join(root, "runtime")
    await provisionEmbeddedRuntime(manifest, embedded, runtime)
    expect(readFileSync(join(runtime, "package.json"), "utf8")).toBe(content)
    if (process.platform !== "win32") {
      expect(statSync(join(runtime, "package.json")).mode & 0o777).toBe(0o644)
    }
    expect(readFileSync(join(runtime, ".provisioned"), "utf8")).toBe("manifest-sha\n")
    writeFileSync(join(runtime, "package.json"), "changed\n")
    await provisionEmbeddedRuntime(manifest, embedded, runtime)
    expect(readFileSync(join(runtime, "package.json"), "utf8")).toBe("changed\n")
  })
})

describe("omob branded build labels", () => {
  const buildInfo = {
    command: "omob",
    omo: { commit: "c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc", committedAt: "2026-09-04T10:17:49+09:00", branch: "dev" },
    engine: { commit: "7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7", committedAt: "2026-09-04T10:49:12+09:00", branch: "main" },
  }

  test("versionLine prints full shas and commit dates for dev builds", () => {
    const line = versionLine({ version: "0.0.0-omob.c6e7dd7.7fd18df", omoBuild: buildInfo }, "2026.8.26-2")
    expect(line).toContain("c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc")
    expect(line).toContain("2026-09-04T10:17:49+09:00")
    expect(line).toContain("7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7")
    expect(line).toContain("(dev)")
    expect(line).toContain("(main)")
    expect(line).toContain("+1788486552.7fd18df")
    expect(line).toContain("scheme epoch")
  })

  test("remapSenpiEnvironment brands dev builds with the label and command", () => {
    const root = temp()
    const execDir = join(root, "runtime")
    mkdirSync(execDir, { recursive: true })
    writeFileSync(
      join(execDir, "package.json"),
      JSON.stringify({ name: "omo", version: "0.0.0-omob.c6e7dd7.7fd18df", omoBuild: buildInfo }),
    )
    const env = remapSenpiEnvironment({}, execDir)
    const brand = JSON.parse(env.SENPI_BRAND ?? "{}") as { command?: string; displayVersion?: string; update?: { command?: string } }
    expect(brand.command).toBe("omob")
    expect(brand.displayVersion).toBe("omo@c6e7dd7 2026-09-04 10:17 +09:00 · senpi@7fd18df 2026-09-04 10:49 +09:00")
    expect(brand.update?.command).toContain("omob")
  })
})

describe("omob provenance degrades sanely", () => {
  const malformed = { command: "omob", omo: { commit: "not-a-sha", committedAt: "nope", branch: "" }, engine: {} }

  test("remapSenpiEnvironment falls back to the plain version and omo command for malformed build info", () => {
    const root = temp()
    const execDir = join(root, "runtime")
    mkdirSync(execDir, { recursive: true })
    writeFileSync(join(execDir, "package.json"), JSON.stringify({ name: "omo", version: "5.0.0-beta.40", omoBuild: malformed }))

    const env = remapSenpiEnvironment({}, execDir)
    const brand = JSON.parse(env.SENPI_BRAND ?? "{}") as { command?: string; displayVersion?: string }

    expect(brand.displayVersion).toBe("5.0.0-beta.40")
    expect(brand.command).toBe("omo")
  })

  test("versionLine falls back to the release one-liner for malformed build info", () => {
    expect(versionLine({ version: "5.0.0-beta.40", omoBuild: malformed }, "2026.9.4")).toBe(
      "omo 5.0.0-beta.40 (engine: senpi 2026.9.4; scheme nodef)",
    )
  })

  test("updateHint tells dev builds to rebuild and names the release asset otherwise", () => {
    const info = {
      command: "omob",
      omo: { commit: "c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc", committedAt: "2026-09-04T10:17:49+09:00", branch: "dev" },
      engine: { commit: "7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7", committedAt: "2026-09-04T10:49:12+09:00", branch: "main" },
    }

    expect(updateHint(info)).toBe("rebuild with: bun run omob")
    expect(updateHint(malformed, "darwin", "arm64")).toContain("omo-darwin-arm64 from https://github.com/code-yeongyu/oh-my-openagent/releases")
    expect(updateHint(undefined, "win32", "x64")).toContain("omo-windows-x64.exe")
  })
})

describe("compiled release self-update", () => {
  const release = (tag: string, assets: readonly string[], draft = false) => ({ tag_name: tag, draft, assets: assets.map((name) => ({ name })) })
  const ALL = ["omo-linux-x64", "omo-linux-x64-musl", "omo-linux-x64-baseline", "omo-windows-x64.exe", "omo-darwin-arm64"]
  const releases = [
    release("next", []),
    release("v5.1.0-beta.2", ALL),
    release("v5.0.1", ALL),
    release("v5.0.0", ALL),
    release("v5.2.0", ALL, true),
  ]

  test("the asset follows the stamped build flavor, not only the OS and CPU", () => {
    expect(releaseAssetName("linux-x64-musl", "linux", "x64")).toBe("omo-linux-x64-musl")
    expect(releaseAssetName("linux-x64-musl-baseline", "linux", "x64")).toBe("omo-linux-x64-musl-baseline")
    expect(releaseAssetName("windows-x64-baseline", "win32", "x64")).toBe("omo-windows-x64-baseline.exe")
    expect(releaseAssetName(undefined, "darwin", "arm64")).toBe("omo-darwin-arm64")
    expect(releaseAssetName("../evil", "linux", "x64")).toBe("omo-linux-x64")
  })

  test("a stable build only moves to stable releases and a beta build follows betas", () => {
    expect(pickUpdateVersion("5.0.0", releases, "omo-linux-x64")).toBe("5.0.1")
    expect(pickUpdateVersion("5.0.0-beta.90", releases, "omo-linux-x64")).toBe("5.1.0-beta.2")
    expect(pickUpdateVersion("5.0.1", releases, "omo-linux-x64")).toBeUndefined()
    expect(releaseVersionOf("5.0.0-0.beta.90")).toBe("5.0.0-beta.90")
  })

  test("a release that does not ship this flavor is skipped", () => {
    const partial = [release("v5.0.2", ["omo-linux-x64"]), release("v5.0.1", ALL)]
    expect(pickUpdateVersion("5.0.0", partial, "omo-linux-x64-musl")).toBe("5.0.1")
  })

  test("the POSIX command swaps the running binary through a sibling file and survives spaces", () => {
    const command = replaceCommand("https://x/omo-linux-x64", "/home/me/my tools/omo", "linux")
    expect(command).toBe("curl -fsSL 'https://x/omo-linux-x64' -o '/home/me/my tools/omo.new' && chmod +x '/home/me/my tools/omo.new' && mv -f '/home/me/my tools/omo.new' '/home/me/my tools/omo'")
  })

  test("the Windows command moves the running exe aside and never calls chmod", () => {
    const command = replaceCommand("https://x/omo-windows-x64.exe", "C:\\Users\\me\\bin\\omo.exe", "win32")
    expect(command).not.toContain("chmod")
    expect(command).toContain("curl.exe -fsSL 'https://x/omo-windows-x64.exe' -o 'C:\\Users\\me\\bin\\omo.exe.new'")
    expect(command).toContain("Move-Item -Force -LiteralPath 'C:\\Users\\me\\bin\\omo.exe' -Destination 'C:\\Users\\me\\bin\\omo.exe.old'")
  })

  test("omo update pins the version and replaces the binary the user ran", async () => {
    const result = await compiledUpdate({
      omoAiVersion: "5.0.0",
      releaseTarget: "linux-x64-musl",
      destination: "/opt/omo/omo",
      platform: "linux",
      arch: "x64",
      fetchReleases: async () => releases,
    })
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("https://github.com/code-yeongyu/oh-my-openagent/releases/download/v5.0.1/omo-linux-x64-musl")
    expect(result.output).toContain("mv -f '/opt/omo/omo.new' '/opt/omo/omo'")
    expect(result.output).not.toContain("releases/latest")
  })

  test("an up-to-date binary says so and a failed lookup exits non-zero with the releases page", async () => {
    const base = { releaseTarget: "darwin-arm64", destination: "/omo", platform: "darwin" as const, arch: "arm64" }
    const current = await compiledUpdate({ ...base, omoAiVersion: "5.0.1", fetchReleases: async () => releases })
    expect(current).toEqual({ output: "omo 5.0.1 is the newest stable release", exitCode: 0 })
    const failed = await compiledUpdate({ ...base, omoAiVersion: "5.0.0", fetchReleases: async () => { throw new Error("GitHub answered 503") } })
    expect(failed.exitCode).toBe(1)
    expect(failed.output).toContain("https://github.com/code-yeongyu/oh-my-openagent/releases")
  })
})

describe("compiledBannerLines", () => {
  const stampedInfo = {
    command: "omob",
    omo: { commit: "c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc", committedAt: "2026-09-04T10:17:49+09:00", branch: "dev" },
    engine: { commit: "7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7", committedAt: "2026-09-04T10:49:12+09:00", branch: "main" },
  }

  test("#given a stamped dev build #when the banner renders #then it prints the same provenance as --version", () => {
    const lines = compiledBannerLines({ omoAiVersion: "0.0.0-omob.c6e7dd7.7fd18df", buildInfo: stampedInfo })

    // The requirement: banner, --version and doctor all show full SHAs, ISO dates and branches.
    expect(lines).toEqual([
      "omob dev build",
      "omo   c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc 2026-09-04T10:17:49+09:00 (dev)",
      "senpi 7fd18dfeec7a7db89a983b2c3cb90835b8c3c5f7 2026-09-04T10:49:12+09:00 (main)",
      "engine-build +1788486552.7fd18df (scheme epoch)",
    ])
    // guards against a regression to short SHAs / a missing date or branch
    expect(lines.join("\n")).toContain("c6e7dd7fb0f993336ed61c62acc5d55c6ada8bfc")
    expect(lines.some((line) => line.includes("c6e7dd7 "))).toBe(false)
  })

  test("#given a release build with no build info #when the banner renders #then it keeps the release one-liner", () => {
    expect(compiledBannerLines({ omoAiVersion: "5.0.0-beta.40", buildInfo: undefined })).toEqual([
      "omo (omo-ai beta 5.0.0-beta.40)",
    ])
  })

  test("#given a stable release build #when the banner renders #then it does not call itself beta", () => {
    expect(compiledBannerLines({ omoAiVersion: "5.0.0", buildInfo: undefined })).toEqual(["omo (omo-ai 5.0.0)"])
  })

  test("#given malformed build info #when the banner renders #then it degrades to the release one-liner", () => {
    const malformed = { command: "omob", omo: { commit: "nope", committedAt: "", branch: "" }, engine: {} }

    expect(compiledBannerLines({ omoAiVersion: "5.0.0-beta.40", buildInfo: malformed })).toEqual([
      "omo (omo-ai beta 5.0.0-beta.40)",
    ])
  })

  test("#given a build stamped with another command name #when the banner renders #then it uses that name", () => {
    const lines = compiledBannerLines({
      omoAiVersion: "0.0.0-omob.c6e7dd7.7fd18df",
      buildInfo: { ...stampedInfo, command: "omoq" },
    })

    expect(lines[0]).toBe("omoq dev build")
  })
})
