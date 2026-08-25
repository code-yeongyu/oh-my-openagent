import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  buildSenpiArgs,
  isProvisionedExecutable,
  provisionEmbeddedRuntime,
  remapSenpiEnvironment,
  runCompiledLauncher,
  selectRuntimeManifest,
  versionLine,
  updateLine,
  type EmbeddedManifest,
} from "../compile-entry"

const roots: string[] = []
const temp = () => { const root = mkdtempSync(join(homedir(), "omo-compile-entry-test-")); roots.push(root); return root }
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe("compiled omo entry launcher parity", () => {
  test("early commands pass through without an extension", () => {
    expect(buildSenpiArgs(["install", "x"], "/provisioned")).toEqual(["install", "x"])
  })

  test("main commands prepend the provisioned plugin extension", () => {
    expect(buildSenpiArgs(["chat"], "/provisioned")).toEqual(["--extension", join("/provisioned", "plugin"), "chat"])
  })

  test("version line reads the sibling package version and pinned engine", () => {
    expect(versionLine({ version: "9.2.1" }, "2026.8.25")).toBe("omo 9.2.1 (engine: senpi 2026.8.25)")
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

describe("embedded runtime provisioning", () => {
  test("selects the omo manifest when senpi also embeds an unrelated manifest", async () => {
    const senpiManifest = { name: "runtime/lsp-daemon/dist/.omo-runtime-manifest.json", text: async () => JSON.stringify({ files: [] }) }
    const omoManifest = { name: "omo-runtime/runtime-manifest.json", text: async () => JSON.stringify({ omoAiVersion: "9.2.1", enginePin: "2026.8.25" }) }
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
      await runCompiledLauncher(["doctor"], root, "2026.8.25", root)
    } finally {
      console.log = originalLog
      process.exitCode = originalExitCode
    }
    expect(output.join("\n")).toContain("PASS plugin manifest: plugin/package.json")
    expect(output.join("\n")).toContain("INFO omo 9.2.1 (engine: senpi 2026.8.25)")
  })

  test("version uses the manifest engine pin without a provisioned senpi package", async () => {
    const root = temp()
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.2.1" }))
    const output: string[] = []
    const originalLog = console.log
    console.log = (value?: unknown) => { output.push(String(value)) }
    try {
      await runCompiledLauncher(["--version"], root, "2026.8.25")
    } finally {
      console.log = originalLog
    }
    expect(output).toEqual(["omo 9.2.1 (engine: senpi 2026.8.25)"])
  })

  test("materializes files whose embedded names carry the omo-runtime prefix", async () => {
    const root = temp()
    const content = "hello changelog\n"
    const manifest: EmbeddedManifest = {
      omoAiVersion: "9.2.1",
      enginePin: "2026.8.25",
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
      enginePin: "2026.8.25",
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
      enginePin: "2026.8.25",
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
