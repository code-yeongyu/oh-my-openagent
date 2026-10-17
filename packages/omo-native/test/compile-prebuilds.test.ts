import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  buildRuntimeManifest,
  reportEmbeddedPayload,
  RUNTIME_MANIFEST_REL_PATH,
  stageNativePrebuild,
} from "../../../script/build-omo-binary"
import { provisionEmbeddedRuntime, type EmbeddedFile } from "../compile-runtime"
import { remapSenpiEnvironment } from "../compile-entry"

test("native prebuilds: both addons are embedded and extracted beside the engine package with executable mode", async () => {
  const root = mkdtempSync(join(tmpdir(), "omo-native-extraction-"))
  try {
    const host = `${process.platform}-${process.arch}`
    const packageDir = join(root, "source")
    const stageDir = join(root, "omo-runtime")
    const runtimeDir = join(root, "extracted")
    const staged = new Set<string>()
    const relPaths = ["senpi_pty", "senpi_grep"].map((stem) => `native/prebuilds/${host}/${stem}.${host}.node`)
    for (const [index, fileStem] of (["senpi_pty", "senpi_grep"] as const).entries()) {
      const source = join(packageDir, relPaths[index]!)
      mkdirSync(dirname(source), { recursive: true })
      writeFileSync(source, `fake ${fileStem}\n`)
      chmodSync(source, 0o644)
      stageNativePrebuild({ fileStem, host, packageName: "@code-yeongyu/senpi", pin: "0.0.0-test" }, stageDir, staged, {
        resolvePackageDir: () => packageDir,
        runCommand: () => { throw new Error("local prebuild must not contact the registry") },
      })
    }
    writeFileSync(join(stageDir, "package.json"), JSON.stringify({ version: "0.0.0-test" }))
    const manifest = await buildRuntimeManifest(stageDir, { omoAiVersion: "0.0.0-test", enginePin: "0.0.0-test" })
    expect([...staged].sort()).toEqual([...relPaths].sort())
    expect(manifest.entries.find((entry) => entry.relPath === "package.json")?.mode)
      .toBe(statSync(join(stageDir, "package.json")).mode & 0o777)
    expect(manifest.entries.filter((entry) => entry.relPath.startsWith("native/prebuilds/")))
      .toEqual([...relPaths].sort().map((relPath) => expect.objectContaining({ relPath, mode: 0o755 })))
    writeFileSync(join(stageDir, RUNTIME_MANIFEST_REL_PATH), JSON.stringify(manifest))
    const report = reportEmbeddedPayload(stageDir)
    expect(report.manifest).toEqual(manifest)
    for (const relPath of relPaths) expect(report.relPaths).toContain(relPath)
    const embedded = report.names.map((name) => Object.assign(
      new Blob([readFileSync(join(root, name))]), { name },
    ) as EmbeddedFile)
    await provisionEmbeddedRuntime({ ...report.manifest, entries: [...report.manifest.entries] }, embedded, runtimeDir)
    const env = remapSenpiEnvironment({ OMO_CODING_AGENT_DIR: join(root, "agent") }, runtimeDir)
    expect(env.SENPI_PACKAGE_DIR).toBe(runtimeDir)
    expect(JSON.parse(readFileSync(join(env.SENPI_PACKAGE_DIR!, "package.json"), "utf8")).version).toBe("0.0.0-test")
    for (const relPath of relPaths) {
      const extracted = join(env.SENPI_PACKAGE_DIR!, relPath)
      expect(readFileSync(extracted)).toEqual(readFileSync(join(packageDir, relPath)))
      // Windows applies writable/read-only permissions, not POSIX executable bits.
      // The embedded manifest above must still carry 0755 on every build host.
      if (process.platform !== "win32") expect(statSync(extracted).mode & 0o777).toBe(0o755)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 120_000)
