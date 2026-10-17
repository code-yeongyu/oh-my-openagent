import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computerUseDoctorReport } from "../../../../omo-native/computer-use-doctor-runtime"
import { describeEngineSource } from "./engine-source"

// Mode bits only mean "not executable" where the host filesystem has them; Windows has no exec bit.
const modeBitHost = process.platform !== "win32"
test.each([
  "missing",
  ...(modeBitHost ? ["not executable"] : []),
  "windows non-exe",
  ...(process.platform === "darwin" ? ["quarantined"] : []),
])("explicit %s status agrees with doctor without spawning", async (kind) => {
  const root = mkdtempSync(join(tmpdir(), "cu-source-parity-"))
  const engine = join(root, "engine")
  try {
    if (kind !== "missing") {
      writeFileSync(engine, "not executable")
      chmodSync(engine, kind === "not executable" ? 0o644 : 0o755)
      if (kind === "quarantined") {
        const result = spawnSync("/usr/bin/xattr", ["-w", "com.apple.quarantine", "0081;test;fixture;", engine])
        expect(result.status).toBe(0)
      }
    }
    mkdirSync(join(root, ".omo"))
    writeFileSync(join(root, ".omo", "omo.jsonc"), JSON.stringify({
      "[native]": { computer: { enabled: true, engine_path: engine } },
    }))
    const platform = kind === "quarantined" ? "darwin" : kind === "windows non-exe" ? "win32" : "linux"
    const report = await computerUseDoctorReport({
      cwd: root, env: { HOME: root }, version: "5.1.7",
      packageRoot: join(root, "packages", "omo-native"), platform, arch: "x64",
      launchEngine: () => { throw new Error("invalid explicit path must not spawn") },
    })
    expect(report.kind).toBe("unavailable")
    if (report.kind !== "unavailable") throw new Error("expected unavailable")
    expect(describeEngineSource(engine, { HOME: root }, { platform, arch: "x64" }))
      .toContain(report.diagnostic.cause)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test.each(["linux-arm64", "win32-arm64", "linux-x64"])("absent %s status agrees with doctor", async (host) => {
  const root = mkdtempSync(join(tmpdir(), "cu-absence-parity-"))
  const [platform, arch] = host.split("-")
  const stamped = join(root, "runtime")
  const version = "5.1.7"
  try {
    mkdirSync(stamped)
    writeFileSync(join(stamped, "package.json"), JSON.stringify({ name: "omo", version }))
    const env = { HOME: root, OMO_PACKAGE_DIR: stamped }
    const report = await computerUseDoctorReport({
      cwd: root, env, version, packageRoot: join(root, "packages", "omo-native"),
      platform, arch, launchEngine: () => { throw new Error("absence must not spawn") },
    })
    const status = describeEngineSource(undefined, env, {
      platform, arch, execDir: root, packageDir: join(root, "packages", "senpi-desktop-engine"), repoRoot: root,
    })
    if (arch === "arm64") {
      expect(report.kind).toBe("unavailable")
      if (report.kind !== "unavailable") throw new Error("expected unsupported host")
      expect(status).toBe(report.diagnostic.message)
    } else {
      expect(report.kind).toBe("not-installed")
      expect(status).toBe(`would download senpi-desktop-engine-${host} from omo v${version} on first use`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
