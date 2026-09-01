import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  answerCompiledFastPath,
  buildSenpiArgs,
  remapSenpiEnvironment,
  runCompiledLauncher,
  shouldPrintCompiledBanner,
  updateLine,
  versionLine,
} from "../compile-entry"
import { loadOpenAICodexOAuth } from "../../../node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist/auth/oauth/load.js"
import { openaiCodexOAuth } from "../../../node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js"
import { openaiCodexProvider } from "../../../node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist/providers/openai-codex.js"
import {
  isProvisionedExecutable,
  materializeProvisionedExecutable,
  provisionEmbeddedRuntime,
  runningExecutablePath,
  selectRuntimeManifest,
  shouldReexecAfterProvisioning,
  type EmbeddedManifest,
} from "../compile-runtime"

const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(homedir(), "omo-compile-entry-test-")); roots.push(root); return root }
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe("compiled OMO OAuth module identity", () => {
  test("registers the loader in the same nested pi-ai graph used by the provider", async () => {
    const loadedFlow = await loadOpenAICodexOAuth()

    expect(loadedFlow).toBe(openaiCodexOAuth)
    expect(openaiCodexProvider().id).toBe("openai-codex")
  })

  test("derives OpenAI Codex request auth from a stored OAuth credential", async () => {
    const secret = "review-secret-must-not-be-printed"
    const credential = { type: "oauth" as const, access: secret, refresh: "discarded", expires: Date.now() + 60_000 }

    const auth = await openaiCodexProvider().auth.oauth?.toAuth(credential)

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
    expect(shouldReexecAfterProvisioning("win32")).toBe(false)
    expect(shouldReexecAfterProvisioning("darwin")).toBe(true)
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

  test("main commands prepend the provisioned plugin extension", () => {
    expect(buildSenpiArgs(["chat"], "/provisioned")).toEqual(["--extension", join("/provisioned", "plugin"), "chat"])
  })

  test("version line reads the sibling package version and pinned engine", () => {
    expect(versionLine({ version: "9.2.1" }, "2026.8.28")).toBe("omo 9.2.1 (engine: senpi 2026.8.28)")
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

  test("self-update prints the curl reinstall command", () => {
    expect(updateLine("darwin", "arm64")).toContain("curl")
    expect(updateLine("darwin", "arm64")).toContain("omo-darwin-arm64")
  })

  test("package-root environment values point into the provisioned runtime", () => {
    const env = remapSenpiEnvironment({ OMO_BIN: "/old", SENPI_BIN: "/old-senpi", PATH: "/bin" }, "/provisioned")
    expect(env.OMO_AGENT_TOOLKIT_BIN).toBe(join("/provisioned", "plugin", "runtime", "agent-toolkit", process.platform === "win32" ? "omo-agent-toolkit.cmd" : "omo-agent-toolkit"))
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
    expect(output).toEqual(["omo 9.9.9 (engine: senpi 2026.1.1)"])
  })

  test("-v answers while --version with extra arguments falls through", () => {
    expect(captureLog(() => answerCompiledFastPath(["-v"], manifest)).handled).toBe(true)
    const extra = captureLog(() => answerCompiledFastPath(["--version", "--json"], manifest))
    expect(extra.handled).toBe(false)
    expect(extra.output).toEqual([])
  })

  test("self-update spellings answer with the curl line while engine updates fall through", () => {
    const selfUpdate = captureLog(() => answerCompiledFastPath(["update"], manifest))
    expect(selfUpdate.handled).toBe(true)
    expect(selfUpdate.output[0]).toContain("curl")
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

  test("selects the omo manifest when senpi also embeds an unrelated manifest", async () => {
    const senpiManifest = { name: "runtime/lsp-daemon/dist/.omo-runtime-manifest.json", text: async () => JSON.stringify({ files: [] }) }
    const omoManifest = { name: "omo-runtime/runtime-manifest.json", text: async () => JSON.stringify({ omoAiVersion: "9.2.1", enginePin: "2026.8.28" }) }
    await expect(selectRuntimeManifest([senpiManifest, omoManifest] as any[])).resolves.toBe(omoManifest as any)
  })

  test("compiled doctor resolves package artifacts from the provided execDir", async () => {
    const root = temp()
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.2.1" }))
    for (const artifact of ["plugin/package.json", "plugin/extensions/omo.js", "plugin/runtime/lsp-daemon/dist/cli.js", "plugin/runtime/agent-toolkit/cli.js"]) {
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
    expect(output.join("\n")).toContain("INFO omo 9.2.1 (engine: senpi 2026.8.28)")
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
    expect(output).toEqual(["omo 9.2.1 (engine: senpi 2026.8.28)"])
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
